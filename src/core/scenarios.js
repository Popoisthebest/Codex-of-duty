// Deterministic gameplay scenarios for the v3 harness.
//
// Truthfulness rule: these runners may seed RNG, fix the timestep, inject
// deterministic inputs and shorten match rules so a full match fits in a test.
// They may not write a score, a death, a winner or a respawn directly. Every
// piece of evidence below is observed from production events and production
// state after the real systems produced it.

const FIXED = 1 / 60;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

function collectNonFinite(engine) {
  const problems = [];
  const player = engine.ctx.peek('player');
  const match = engine.ctx.peek('match');
  const ai = engine.ctx.peek('ai');
  if (player) {
    if (!finite(player.position.x) || !finite(player.position.y) || !finite(player.position.z)) problems.push('player.position');
    if (!finite(player.health)) problems.push('player.health');
  }
  if (match) {
    if (!finite(match.clock)) problems.push('match.clock');
    for (const team of match.teams.values()) if (!finite(team.score)) problems.push(`team.${team.id}.score`);
  }
  if (ai) {
    for (const bot of ai.bots) {
      if (!finite(bot.root.position.x) || !finite(bot.root.position.y) || !finite(bot.root.position.z)) problems.push(`${bot.id}.position`);
      if (!finite(bot.health)) problems.push(`${bot.id}.health`);
    }
  }
  return problems;
}

// Watches production events so the scenario can prove which systems produced
// each outcome instead of asserting it.
class EvidenceRecorder {
  constructor(ctx) {
    this.ctx = ctx;
    this.damageByTarget = new Map();
    this.damageEventsByTarget = new Map();
    this.totalDamage = 0;
    this.deaths = [];
    this.kills = [];
    this.respawnRequests = [];
    this.spawnConfirmations = [];
    this.errors = [];
    this.previousScores = { alpha: 0, bravo: 0 };
    this.scoringDeltas = [];
    this.playerDeaths = 0;
    this.playerRespawns = 0;
    this.offs = [
      ctx.events.on('combat:damage', (event) => {
        const key = String(event.targetId);
        this.damageByTarget.set(key, (this.damageByTarget.get(key) ?? 0) + (event.amount ?? 0));
        this.damageEventsByTarget.set(key, (this.damageEventsByTarget.get(key) ?? 0) + 1);
        this.totalDamage += event.amount ?? 0;
      }),
      ctx.events.on('actor:died', (event) => {
        const key = String(event.actorId);
        // A death is emitted from inside the fatal combat:damage dispatch, so
        // the killing blow has not reached this listener yet. Evidence is taken
        // from state the damage system already wrote instead of from ordering.
        this.deaths.push({
          actorId: event.actorId,
          source: event.source ?? null,
          damageEvents: this.damageEventsByTarget.get(key) ?? 0,
          healthAtDeath: this.readHealth(event.actorId),
        });
        this.damageByTarget.set(key, 0);
        this.damageEventsByTarget.set(key, 0);
        if (event.actorId === 'player') this.playerDeaths += 1;
      }),
      ctx.events.on('match:kill', (entry) => {
        const match = ctx.peek('match');
        const scores = match.getScores();
        this.kills.push({
          killer: entry.killer,
          killerTeam: entry.killerTeam,
          victim: entry.victim,
          alphaDelta: scores.alpha - this.previousScores.alpha,
          bravoDelta: scores.bravo - this.previousScores.bravo,
        });
      }),
      ctx.events.on('match:respawn', (event) => this.respawnRequests.push(event.actorId)),
      ctx.events.on('match:spawned', (event) => {
        this.spawnConfirmations.push(event.actorId);
        if (event.actorId === 'player') this.playerRespawns += 1;
      }),
    ];
  }

  pollScores(match) {
    const scores = match.getScores();
    this.previousScores.alpha = scores.alpha;
    this.previousScores.bravo = scores.bravo;
  }

  // A kill counts as production scoring only when the shooter's team score rose
  // by exactly one in the same step the match announced the kill.
  scoringLooksProduction() {
    if (!this.kills.length) return false;
    return this.kills.every((kill) => {
      if (!kill.killerTeam) return true;
      const delta = kill.killerTeam === 'alpha' ? kill.alphaDelta : kill.bravoDelta;
      return delta === 1;
    });
  }

  readHealth(actorId) {
    if (actorId === 'player') return this.ctx.peek('player')?.health ?? null;
    return this.ctx.peek('ai')?.byId?.get(actorId)?.health ?? null;
  }

  // Every death must have been driven to zero health by the damage pipeline, and
  // the run as a whole must have moved at least a full health bar per kill.
  damageLooksProduction() {
    if (!this.deaths.length) return false;
    const everyDeathFromDamage = this.deaths.every((death) => death.damageEvents > 0 && death.healthAtDeath === 0);
    return everyDeathFromDamage && this.totalDamage >= this.deaths.length * 100;
  }

  dispose() { for (const off of this.offs) off(); }
}

// Drives the human slot with deterministic aim-and-fire so the player is a real
// participant in the scenario rather than a spectator.
function drivePlayer(engine, frame) {
  const ctx = engine.ctx;
  const player = ctx.get('player');
  const weapon = ctx.get('weapons');
  const input = ctx.input;
  if (player.dead) {
    input.setVirtual('fire', false);
    input.setVirtual('ads', false);
    return;
  }
  if (weapon.ammo === 0 && !weapon.reloading) {
    input.setVirtual('fire', false);
    input.setVirtual('reload', frame % 2 === 0);
    return;
  }
  input.setVirtual('reload', false);
  const aim = ctx.get('ai').getAimPoint();
  if (!aim) {
    input.setVirtual('fire', false);
    input.setVirtual('ads', false);
    input.setVirtual('forward', true);
    input.setVirtual('sprint', true);
    return;
  }
  input.setVirtual('forward', false);
  input.setVirtual('sprint', false);
  player.aimAtPoint(aim);
  input.setVirtual('ads', true);
  input.setVirtual('fire', true);
}

async function runTdmCore(engine, options = {}) {
  const seed = Number(options.seed ?? 1337);
  const scoreLimit = Math.max(4, Math.floor(Number(options.scoreLimit ?? 12)));
  const maxSeconds = Math.max(30, Number(options.maxSeconds ?? 240));
  const ctx = engine.ctx;

  await engine.reset({ seed, scenario: 'tdm-core', render: false });
  const match = ctx.get('match');
  const ai = ctx.get('ai');
  ai.enterMatchMode();
  // Rules are scenario parameters, not results: the match still ends through
  // its own score-limit rule, just at a limit a test can reach.
  const restoreRules = match.configureRules({ scoreLimit, timeLimitSeconds: 600, respawnSeconds: 1.6 });

  const recorder = new EvidenceRecorder(ctx);
  const errors = [];
  const phaseBefore = match.phase;
  const participantsBefore = match.getReport().participants;

  let matchStarted = false;
  let framesRun = 0;
  try {
    // Pre-match must actually elapse; the scenario does not skip the phase.
    engine.simulateFrames(Math.ceil((match.prematchTimer + 0.2) / FIXED), 12);
    matchStarted = match.phase === 'active';

    const maxFrames = Math.ceil(maxSeconds / FIXED);
    framesRun = engine.simulateFrames(maxFrames, 15, (index) => {
      recorder.pollScores(match);
      drivePlayer(engine, index);
      return match.phase !== 'ended';
    });
  } catch (error) {
    errors.push(String(error?.message ?? error));
  }
  ctx.input.clearVirtual();

  const scores = match.getScores();
  const scoreboard = match.getScoreboard();
  const scoreboardConsistent = scoreboard.every((team) => {
    const summed = team.players.reduce((total, entry) => total + entry.kills, 0);
    return summed === team.score;
  });
  const winnerDeclared = Boolean(match.winner) && ['alpha', 'bravo', 'draw'].includes(match.winner);
  const matchEndedByScoreLimit = match.phase === 'ended' && match.endReason === 'score-limit';
  const nonFiniteDuring = collectNonFinite(engine);

  // Restart through the same reset the rematch button drives.
  restoreRules();
  await engine.reset({ seed, scenario: 'tdm-core', render: false });
  ai.enterMatchMode();
  const after = match.getReport();
  const restartReturnedToCleanMatch = after.phase === 'prematch'
    && after.teams.every((team) => team.score === 0 && team.alive === 6)
    && after.telemetry.matchTimeSeconds === 0
    && after.telemetry.kills === 0
    && match.winner === null
    && !ctx.get('player').dead
    && ctx.get('player').health === 100;

  const nonFiniteAfter = collectNonFinite(engine);
  const evidence = {
    kills: recorder.kills.length,
    deaths: recorder.deaths.length,
    respawnRequests: recorder.respawnRequests.length,
    spawnConfirmations: recorder.spawnConfirmations.length,
    playerDeaths: recorder.playerDeaths,
    playerRespawns: recorder.playerRespawns,
    finalScores: scores,
    scoreLimitUsed: scoreLimit,
    simulatedSeconds: Number((framesRun * FIXED).toFixed(2)),
  };
  recorder.dispose();

  const result = {
    ok: false,
    matchStarted,
    participantsReady: participantsBefore.total === 12 && participantsBefore.human === 1
      && participantsBefore.alliedBots === 5 && participantsBefore.enemyBots === 6,
    scoreChangedFromKill: recorder.kills.length > 0 && (scores.alpha + scores.bravo) === recorder.kills.filter((kill) => kill.killerTeam).length,
    deathObserved: recorder.deaths.length > 0,
    respawnObserved: recorder.spawnConfirmations.length > 0 && recorder.respawnRequests.length > 0,
    scoreboardConsistent,
    matchEndedByScoreLimit,
    winnerDeclared,
    restartReturnedToCleanMatch,
    usedProductionDamage: recorder.damageLooksProduction(),
    usedProductionScoring: recorder.scoringLooksProduction(),
    usedProductionRespawn: recorder.respawnRequests.length > 0
      && recorder.spawnConfirmations.length >= recorder.respawnRequests.length,
    runtimeErrors: errors.length,
    nonFiniteState: nonFiniteDuring.length > 0 || nonFiniteAfter.length > 0,
    phaseBefore,
    errors,
    nonFiniteFields: [...new Set([...nonFiniteDuring, ...nonFiniteAfter])],
    evidence,
  };
  result.ok = result.matchStarted && result.participantsReady && result.scoreChangedFromKill
    && result.deathObserved && result.respawnObserved && result.scoreboardConsistent
    && result.matchEndedByScoreLimit && result.winnerDeclared && result.restartReturnedToCleanMatch
    && result.usedProductionDamage && result.usedProductionScoring && result.usedProductionRespawn
    && result.runtimeErrors === 0 && result.nonFiniteState === false;
  return result;
}

async function runCombatSoak(engine, options = {}) {
  const seed = Number(options.seed ?? 4242);
  const simulatedSeconds = Math.max(20, Number(options.seconds ?? 120));
  const ctx = engine.ctx;

  await engine.reset({ seed, scenario: 'combat-soak', render: false });
  const match = ctx.get('match');
  const ai = ctx.get('ai');
  ai.enterMatchMode();
  // A soak must not end early, so the score limit is raised out of the way.
  const restoreRules = match.configureRules({ scoreLimit: 100000, timeLimitSeconds: simulatedSeconds * 4, respawnSeconds: 3 });
  const recorder = new EvidenceRecorder(ctx);
  const errors = [];

  let maxStuckSeconds = 0;
  const zoneOccupancy = new Map();
  let framesRun = 0;
  try {
    framesRun = engine.simulateFrames(Math.ceil(simulatedSeconds / FIXED), 15, (index) => {
      drivePlayer(engine, index);
      for (const bot of ai.bots) if (bot.stuckTimer > maxStuckSeconds) maxStuckSeconds = bot.stuckTimer;
      if (index % 120 === 0) {
        for (const bot of ai.bots) {
          if (!bot.alive) continue;
          const zone = ctx.get('world').zoneAt(bot.root.position.x, bot.root.position.z, bot.root.position.y);
          zoneOccupancy.set(zone, (zoneOccupancy.get(zone) ?? 0) + 1);
        }
      }
      return true;
    });
  } catch (error) {
    errors.push(String(error?.message ?? error));
  }
  ctx.input.clearVirtual();

  const report = match.getReport();
  const activeParticipants = report.teams.reduce((total, team) => total + team.rosterSize, 0);
  const nonFinite = collectNonFinite(engine);
  const result = {
    ok: false,
    simulatedSeconds: Number((framesRun * FIXED).toFixed(2)),
    kills: report.telemetry.kills,
    deaths: report.telemetry.deaths,
    respawns: report.telemetry.respawns,
    activeParticipants,
    maxStuckSeconds: Number(maxStuckSeconds.toFixed(2)),
    stuckRecoveries: report.telemetry.stuckRecoveries,
    spawnDeaths: report.telemetry.spawnDeaths,
    firstContactSeconds: report.telemetry.firstContactSeconds,
    averageRespawnToContactSeconds: report.telemetry.averageRespawnToContactSeconds,
    killsByZone: report.telemetry.killsByZone,
    killsByTeam: report.telemetry.killsByTeam,
    stuckByZone: report.telemetry.stuckByZone,
    stuckSamples: report.telemetry.stuckSamples,
    zoneOccupancy: Object.fromEntries(zoneOccupancy),
    playerDeaths: recorder.playerDeaths,
    playerRespawns: recorder.playerRespawns,
    nonFiniteState: nonFinite.length > 0,
    nonFiniteFields: nonFinite,
    runtimeErrors: errors.length,
    errors,
  };
  result.ok = result.runtimeErrors === 0 && result.nonFiniteState === false
    && result.kills > 0 && result.deaths > 0 && result.respawns > 0
    && result.activeParticipants === 12 && result.maxStuckSeconds < 8;

  recorder.dispose();
  restoreRules();
  await engine.reset({ seed, scenario: 'combat-soak', render: false });
  ai.enterMatchMode();
  return result;
}

export async function runScenario(engine, name, options = {}) {
  if (name === 'tdm-core') return runTdmCore(engine, options);
  if (name === 'combat-soak') return runCombatSoak(engine, options);
  throw new Error(`Unknown gameplay scenario: ${name}`);
}
