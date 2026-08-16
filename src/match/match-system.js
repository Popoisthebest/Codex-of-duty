const TEAM_IDS = ['alpha', 'bravo'];

const TEAM_META = {
  alpha: { id: 'alpha', name: 'ALPHA', color: '#83e6e4' },
  bravo: { id: 'bravo', name: 'BRAVO', color: '#ff8b5a' },
};

const ALPHA_BOT_NAMES = ['VOSS', 'KERR', 'IDRIS', 'MALIK', 'RENN'];
const BRAVO_BOT_NAMES = ['SAHIR', 'DRAKO', 'OSEI', 'NAVID', 'TULLY', 'REYES'];

const SCORE_LIMIT = 100;
const TIME_LIMIT = 600;
const PREMATCH_SECONDS = 3;
const RESPAWN_SECONDS = 4.5;
const SPAWN_PROTECTION = 1.4;
const SPAWN_DEATH_WINDOW = 5;
const KILL_FEED_LIMIT = 6;
// Metres to the nearest live enemy: below MIN it is a spawn trap, around IDEAL
// the player walks a few seconds and finds a fight. MIN sits outside bot sight
// range (42 m is the acquisition limit, but a spawn at 22 m was inside it often
// enough to push spawn deaths to 20% of all deaths), while IDEAL keeps re-entry
// to a handful of seconds.
const MIN_SPAWN_DISTANCE = 30;
const IDEAL_SPAWN_DISTANCE = 40;

// Authoritative team-deathmatch state. Everything the HUD, the harness report
// and the scenario runner read comes from here; no system keeps a private score.
export class MatchSystem {
  static id = 'match';
  static deps = ['world'];

  async init(ctx) {
    this.ctx = ctx;
    this.world = ctx.get('world');
    this.scoreLimit = SCORE_LIMIT;
    this.timeLimitSeconds = TIME_LIMIT;
    this.respawnSeconds = RESPAWN_SECONDS;
    this.participants = [];
    this.byId = new Map();
    this.teams = new Map();
    for (const id of TEAM_IDS) this.teams.set(id, { ...TEAM_META[id], score: 0, roster: [] });
    this.addParticipant({ id: 'player', team: 'alpha', kind: 'human', name: 'OPERATOR' });
    for (let i = 0; i < ALPHA_BOT_NAMES.length; i += 1) this.addParticipant({ id: `alpha-${i}`, team: 'alpha', kind: 'bot', name: ALPHA_BOT_NAMES[i] });
    for (let i = 0; i < BRAVO_BOT_NAMES.length; i += 1) this.addParticipant({ id: `bravo-${i}`, team: 'bravo', kind: 'bot', name: BRAVO_BOT_NAMES[i] });
    this.deathOff = ctx.events.on('actor:died', (event) => this.onActorDied(event));
    this.contactOff = ctx.events.on('combat:contact', (event) => this.onContact(event));
    await this.reset(ctx);
  }

  addParticipant({ id, team, kind, name }) {
    const participant = {
      id, team, kind, name,
      alive: true, kills: 0, deaths: 0, score: 0,
      respawnTimer: 0, awaitingSpawn: false, spawnedAt: 0, protectedUntil: 0,
      lastKiller: null, lastZone: 'market', spawnIndex: -1, contactedSinceSpawn: false,
    };
    this.participants.push(participant);
    this.byId.set(id, participant);
    this.teams.get(team).roster.push(id);
    return participant;
  }

  reset(ctx) {
    this.rng = ctx.rng.fork('match');
    this.phase = 'prematch';
    this.clock = 0;
    this.prematchTimer = PREMATCH_SECONDS;
    this.winner = null;
    this.endReason = null;
    this.killFeed = [];
    this.killSequence = 0;
    this.recentSpawnIndices = [];
    this.telemetry = {
      kills: 0, deaths: 0, respawns: 0, spawnDeaths: 0, stuckRecoveries: 0,
      shotsFired: 0, firstContactSeconds: null, contacts: 0,
      respawnToContactTotal: 0, respawnToContactSamples: 0,
      killsByZone: {}, killsByTeam: { alpha: 0, bravo: 0 },
      stuckByZone: {}, stuckSamples: [], spawnDeathDetail: [],
      lifetimes: [], killerDistances: [], pathAdvances: 0,
    };
    for (const team of this.teams.values()) team.score = 0;
    for (const participant of this.participants) {
      participant.alive = true;
      participant.kills = 0;
      participant.deaths = 0;
      participant.score = 0;
      participant.respawnTimer = 0;
      participant.awaitingSpawn = false;
      participant.spawnedAt = 0;
      participant.protectedUntil = 0;
      participant.lastKiller = null;
      participant.contactedSinceSpawn = false;
      participant.spawnIndex = -1;
    }
    this.spawnPoints = this.world.getSpawnPoints();
  }

  // ------------------------------------------------------------------ phases

  forceStart() {
    if (this.phase !== 'prematch') return;
    this.prematchTimer = 0;
    this.startMatch();
  }

  startMatch() {
    if (this.phase !== 'prematch') return;
    this.phase = 'active';
    this.ctx.events.emit('match:phase', { phase: 'active', mode: 'tdm' });
  }

  endMatch(reason) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.endReason = reason;
    const alpha = this.teams.get('alpha'); const bravo = this.teams.get('bravo');
    this.winner = alpha.score === bravo.score ? 'draw' : alpha.score > bravo.score ? 'alpha' : 'bravo';
    this.ctx.events.emit('match:phase', { phase: 'ended', winner: this.winner, reason });
    this.ctx.events.emit('match:ended', {
      winner: this.winner, reason,
      scores: { alpha: alpha.score, bravo: bravo.score },
    });
  }

  requestRestart() {
    this.reset(this.ctx);
    this.ctx.events.emit('match:restart', {});
    this.ctx.events.emit('match:phase', { phase: 'prematch' });
  }

  // Scenario runners shorten a match so a full loop fits in a test. The rules
  // themselves still decide the outcome; only their values are parameters.
  // Returns a restore function so the default ruleset always comes back.
  configureRules({ scoreLimit, timeLimitSeconds, respawnSeconds } = {}) {
    const previous = { scoreLimit: this.scoreLimit, timeLimitSeconds: this.timeLimitSeconds, respawnSeconds: this.respawnSeconds };
    if (Number.isFinite(scoreLimit)) this.scoreLimit = scoreLimit;
    if (Number.isFinite(timeLimitSeconds)) this.timeLimitSeconds = timeLimitSeconds;
    if (Number.isFinite(respawnSeconds)) this.respawnSeconds = respawnSeconds;
    return () => {
      this.scoreLimit = previous.scoreLimit;
      this.timeLimitSeconds = previous.timeLimitSeconds;
      this.respawnSeconds = previous.respawnSeconds;
    };
  }

  fixedUpdate(step) {
    if (this.phase === 'prematch') {
      this.prematchTimer -= step;
      if (this.prematchTimer <= 0) this.startMatch();
      return;
    }
    if (this.phase !== 'active') return;
    this.clock += step;
    for (const participant of this.participants) {
      if (participant.alive || participant.awaitingSpawn) continue;
      participant.respawnTimer -= step;
      if (participant.respawnTimer > 0) continue;
      participant.awaitingSpawn = true;
      const spawn = this.selectSpawn(participant);
      this.ctx.events.emit('match:respawn', { actorId: participant.id, team: participant.team, spawn });
    }
    if (this.clock >= this.timeLimitSeconds) this.endMatch('time-limit');
  }

  // ------------------------------------------------------------- kill / death

  onActorDied(event) {
    const victim = this.byId.get(event.actorId === 'player' ? 'player' : event.actorId);
    if (!victim || !victim.alive) return;
    victim.alive = false;
    victim.deaths += 1;
    victim.respawnTimer = this.respawnSeconds;
    victim.awaitingSpawn = false;
    victim.lastZone = event.position ? this.world.zoneAt(event.position.x, event.position.z, event.position.y ?? 0) : victim.lastZone;
    this.telemetry.deaths += 1;
    // Only a death shortly after a *respawn* is a spawn death. The opening
    // deployment happens at clock zero in a friendly staging yard, so counting
    // it would inflate the metric that spawn quality is judged by.
    const sinceSpawn = this.clock - victim.spawnedAt;
    if (this.phase === 'active' && victim.spawnedAt > 0 && sinceSpawn < SPAWN_DEATH_WINDOW) {
      this.telemetry.spawnDeaths += 1;
      if (this.telemetry.spawnDeathDetail.length < 40) {
        const spawn = victim.spawnPosition;
        const travelled = spawn && event.position
          ? Math.hypot(event.position.x - spawn.x, event.position.z - spawn.z)
          : null;
        this.telemetry.spawnDeathDetail.push({
          actor: victim.id,
          secondsAlive: Number(sinceSpawn.toFixed(2)),
          travelledM: travelled == null ? null : Number(travelled.toFixed(1)),
          killer: this.byId.get(event.source)?.id ?? event.source ?? null,
          spawnZone: victim.spawnContext?.zone ?? null,
          deathZone: victim.lastZone,
          spawnNearestEnemyM: victim.spawnContext?.nearestEnemyM ?? null,
          spawnScore: victim.spawnContext?.score ?? null,
        });
      }
    }

    if (this.phase === 'active' && victim.spawnedAt > 0) {
      this.telemetry.lifetimes.push(Number(sinceSpawn.toFixed(2)));
    }
    const killer = this.byId.get(event.source);
    if (killer && event.position) {
      const shooter = this.getActorStates().find((actor) => actor.id === killer.id);
      if (shooter) {
        this.telemetry.killerDistances.push(Number(
          Math.hypot(shooter.x - event.position.x, shooter.y - (event.position.y ?? 0), shooter.z - event.position.z).toFixed(1),
        ));
      }
    }
    const suicide = !killer || killer.id === victim.id;
    const friendly = killer && killer.team === victim.team;
    if (this.phase === 'active') {
      if (suicide || friendly) {
        // A team kill still costs the victim's side; it never rewards the shooter.
        const team = this.teams.get(victim.team);
        team.score = Math.max(0, team.score - (friendly ? 1 : 0));
      } else {
        killer.kills += 1;
        killer.score += event.hitZone === 'head' ? 125 : 100;
        const team = this.teams.get(killer.team);
        team.score += 1;
        this.telemetry.kills += 1;
        this.telemetry.killsByTeam[killer.team] += 1;
        const zone = victim.lastZone;
        this.telemetry.killsByZone[zone] = (this.telemetry.killsByZone[zone] ?? 0) + 1;
      }
    }
    victim.lastKiller = killer?.id ?? null;
    this.killSequence += 1;
    this.killFeed.unshift({
      sequence: this.killSequence,
      killer: suicide ? null : killer.name,
      killerTeam: suicide ? null : killer.team,
      victim: victim.name,
      victimTeam: victim.team,
      hitZone: event.hitZone ?? null,
      headshot: event.hitZone === 'head',
      friendly: Boolean(friendly),
      time: this.clock,
    });
    if (this.killFeed.length > KILL_FEED_LIMIT) this.killFeed.length = KILL_FEED_LIMIT;
    this.ctx.events.emit('match:kill', this.killFeed[0]);
    this.ctx.events.emit('match:score', this.getScores());

    const alpha = this.teams.get('alpha'); const bravo = this.teams.get('bravo');
    if (this.phase === 'active' && (alpha.score >= this.scoreLimit || bravo.score >= this.scoreLimit)) this.endMatch('score-limit');
  }

  // An actor's system reports back once it has actually respawned, so the match
  // never marks something alive that the simulation has not placed.
  confirmSpawn(actorId, position) {
    const participant = this.byId.get(actorId);
    if (!participant) return;
    participant.alive = true;
    participant.awaitingSpawn = false;
    participant.respawnTimer = 0;
    participant.spawnedAt = this.clock;
    participant.protectedUntil = this.clock + SPAWN_PROTECTION;
    participant.contactedSinceSpawn = false;
    if (position) participant.spawnPosition = { x: position.x, y: position.y ?? 0, z: position.z };
    if (position) participant.lastZone = this.world.zoneAt(position.x, position.z, position.y ?? 0);
    // The opening deployment is not a respawn; only re-entry after a death is.
    if (participant.deaths > 0) this.telemetry.respawns += 1;
    this.ctx.events.emit('match:spawned', { actorId, team: participant.team });
  }

  isProtected(actorId) {
    const participant = this.byId.get(actorId);
    return Boolean(participant && this.clock < participant.protectedUntil);
  }

  // Harness staging drops spawn protection so a deterministic damage probe is
  // not silently absorbed by the anti-spawn-kill window.
  clearProtection(actorId = null) {
    if (actorId) {
      const participant = this.byId.get(actorId);
      if (participant) participant.protectedUntil = 0;
      return;
    }
    for (const participant of this.participants) participant.protectedUntil = 0;
  }

  onContact(event) {
    if (this.phase !== 'active') return;
    this.telemetry.contacts += 1;
    if (this.telemetry.firstContactSeconds == null) this.telemetry.firstContactSeconds = this.clock;
    const participant = this.byId.get(event.actorId);
    if (!participant || participant.contactedSinceSpawn) return;
    // Only the first acquisition of a life measures re-entry time. Counting every
    // later acquisition would fold long survivals into the average and make a
    // healthy map look like a long walk.
    participant.contactedSinceSpawn = true;
    const since = this.clock - participant.spawnedAt;
    if (since > 0.05 && since < 120) {
      this.telemetry.respawnToContactTotal += since;
      this.telemetry.respawnToContactSamples += 1;
    }
  }

  // Recording where bots stall is what makes a navigation defect findable; a
  // bare counter only says something is wrong somewhere.
  // Stuck count alone is meaningless without knowing how much pathing happened.
  reportPathAdvance() { this.telemetry.pathAdvances += 1; }

  reportStuckRecovery(position = null) {
    this.telemetry.stuckRecoveries += 1;
    if (!position) return;
    const zone = this.world.zoneAt(position.x, position.z, position.y ?? 0);
    this.telemetry.stuckByZone[zone] = (this.telemetry.stuckByZone[zone] ?? 0) + 1;
    if (this.telemetry.stuckSamples.length < 40) {
      this.telemetry.stuckSamples.push({
        zone,
        x: Number(position.x.toFixed(1)),
        y: Number(position.y.toFixed(1)),
        z: Number(position.z.toFixed(1)),
      });
    }
  }
  reportShot() { this.telemetry.shotsFired += 1; }

  // ------------------------------------------------------------------- spawns

  // Spawn scoring balances two failures that pull in opposite directions:
  // spawning into fire, and spawning so far from the fight that re-entry is a
  // long empty walk. A monotonic "farther is better" score always picks the back
  // of the staging yard, which is safe and boring, so distance is scored as a
  // band that peaks at IDEAL_SPAWN_DISTANCE instead.
  scoreSpawn(point, index, participant, enemies, allies, physics) {
    let nearest = Infinity;
    let visible = 0;
    for (const enemy of enemies) {
      const distance = Math.hypot(enemy.x - point.x, enemy.z - point.z);
      if (distance < nearest) nearest = distance;
      if (distance < 50 && physics) {
        const dx = enemy.x - point.x; const dy = (enemy.y + 1.5) - (point.y + 1.5); const dz = enemy.z - point.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        this.rayOrigin ??= { x: 0, y: 0, z: 0 };
        this.rayDirection ??= { x: 0, y: 0, z: 0 };
        this.rayOrigin.x = point.x; this.rayOrigin.y = point.y + 1.5; this.rayOrigin.z = point.z;
        this.rayDirection.x = dx / length; this.rayDirection.y = dy / length; this.rayDirection.z = dz / length;
        const blocked = physics.raycastWorldDistance(this.rayOrigin, this.rayDirection, length);
        if (blocked == null || blocked >= length - 0.3) visible += 1;
      }
    }
    if (nearest === Infinity) nearest = IDEAL_SPAWN_DISTANCE;

    let score;
    if (nearest < MIN_SPAWN_DISTANCE) score = -140 + nearest * 4;
    else if (nearest <= 52) score = 70 - Math.abs(nearest - IDEAL_SPAWN_DISTANCE) * 0.9;
    else score = 70 - Math.abs(52 - IDEAL_SPAWN_DISTANCE) * 0.9 - (nearest - 52) * 1.6;
    // Direct sight from a live enemy is the one thing that must dominate.
    score -= visible * 90;
    // Re-entering beside a squadmate keeps a team fighting together instead of
    // trickling in one at a time.
    let nearestAlly = Infinity;
    for (const ally of allies) {
      const distance = Math.hypot(ally.x - point.x, ally.z - point.z);
      if (distance < nearestAlly) nearestAlly = distance;
    }
    if (nearestAlly < 34) score += 16 - Math.abs(nearestAlly - 16) * 0.4;
    if (this.recentSpawnIndices.includes(index)) score -= 40;
    if (participant.spawnIndex === index) score -= 28;
    score += this.rng.range(0, 12);
    return score;
  }

  selectSpawn(participant) {
    const candidates = this.spawnPoints.filter((point) => point.team === participant.team);
    if (!candidates.length) return { x: 0, y: 0, z: participant.team === 'alpha' ? 30 : -50, yaw: 0 };
    const states = this.getActorStates();
    const enemies = states.filter((actor) => actor.team !== participant.team && actor.alive);
    const allies = states.filter((actor) => actor.team === participant.team && actor.alive && actor.id !== participant.id);
    const physics = this.ctx.peek('physics');
    let best = null; let bestScore = -Infinity;
    for (let i = 0; i < candidates.length; i += 1) {
      const score = this.scoreSpawn(candidates[i], i, participant, enemies, allies, physics);
      if (score > bestScore) { bestScore = score; best = { point: candidates[i], index: i }; }
    }
    participant.spawnIndex = best.index;
    this.recentSpawnIndices.unshift(best.index);
    if (this.recentSpawnIndices.length > 6) this.recentSpawnIndices.length = 6;
    // Keep the situation this spawn was chosen in. When the actor dies moments
    // later this is what distinguishes "spawned into a fight" from "walked into
    // one", which need opposite fixes.
    let nearestEnemy = Infinity;
    for (const enemy of enemies) {
      const distance = Math.hypot(enemy.x - best.point.x, enemy.z - best.point.z);
      if (distance < nearestEnemy) nearestEnemy = distance;
    }
    participant.spawnContext = {
      index: best.index,
      score: Number(bestScore.toFixed(1)),
      nearestEnemyM: Number.isFinite(nearestEnemy) ? Number(nearestEnemy.toFixed(1)) : null,
      zone: this.world.zoneAt(best.point.x, best.point.z, best.point.y ?? 0),
      enemiesAlive: enemies.length,
    };
    return { ...best.point, spawnScore: Number(bestScore.toFixed(1)) };
  }

  initialSpawn(participant) {
    const point = this.selectSpawn(typeof participant === 'string' ? this.byId.get(participant) : participant);
    return point;
  }

  getActorStates() {
    const states = [];
    const player = this.ctx.peek('player');
    if (player) states.push({ id: 'player', team: 'alpha', alive: !player.dead, x: player.position.x, y: player.position.y, z: player.position.z });
    const ai = this.ctx.peek('ai');
    if (ai?.getActorStates) states.push(...ai.getActorStates());
    return states;
  }

  // -------------------------------------------------------------- read models

  getScores() {
    const alpha = this.teams.get('alpha'); const bravo = this.teams.get('bravo');
    return { alpha: alpha.score, bravo: bravo.score, limit: this.scoreLimit };
  }

  getTeam(id) { return this.teams.get(id); }
  getParticipant(id) { return this.byId.get(id); }
  isAlive(id) { return Boolean(this.byId.get(id)?.alive); }
  getKillFeed() { return this.killFeed; }
  getTimeRemaining() { return Math.max(0, this.timeLimitSeconds - this.clock); }

  getScoreboard() {
    return TEAM_IDS.map((id) => {
      const team = this.teams.get(id);
      return {
        id, name: team.name, color: team.color, score: team.score,
        players: team.roster
          .map((memberId) => this.byId.get(memberId))
          .map((member) => ({ id: member.id, name: member.name, kind: member.kind, kills: member.kills, deaths: member.deaths, score: member.score, alive: member.alive }))
          .sort((a, b) => b.score - a.score || b.kills - a.kills),
      };
    });
  }

  static describe(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
    return {
      n: sorted.length,
      mean: Number((sorted.reduce((total, value) => total + value, 0) / sorted.length).toFixed(2)),
      p50: at(0.5), p90: at(0.9), min: sorted[0], max: sorted[sorted.length - 1],
    };
  }

  getReport() {
    const counts = { total: this.participants.length, human: 0, alliedBots: 0, enemyBots: 0 };
    for (const participant of this.participants) {
      if (participant.kind === 'human') counts.human += 1;
      else if (participant.team === 'alpha') counts.alliedBots += 1;
      else counts.enemyBots += 1;
    }
    const world = this.world.getMapReport();
    const telemetry = this.telemetry;
    return {
      version: 3,
      mode: 'tdm',
      phase: this.phase,
      scoreLimit: this.scoreLimit,
      timeLimitSeconds: this.timeLimitSeconds,
      winner: this.winner,
      endReason: this.endReason,
      participants: counts,
      teams: TEAM_IDS.map((id) => {
        const team = this.teams.get(id);
        return {
          id,
          score: team.score,
          rosterSize: team.roster.length,
          alive: team.roster.filter((memberId) => this.byId.get(memberId).alive).length,
        };
      }),
      world,
      telemetry: {
        matchTimeSeconds: Number(this.clock.toFixed(3)),
        kills: telemetry.kills,
        deaths: telemetry.deaths,
        respawns: telemetry.respawns,
        spawnDeaths: telemetry.spawnDeaths,
        stuckRecoveries: telemetry.stuckRecoveries,
        shotsFired: telemetry.shotsFired,
        contacts: telemetry.contacts,
        firstContactSeconds: telemetry.firstContactSeconds,
        averageRespawnToContactSeconds: telemetry.respawnToContactSamples
          ? Number((telemetry.respawnToContactTotal / telemetry.respawnToContactSamples).toFixed(2))
          : null,
        killsByZone: { ...telemetry.killsByZone },
        lifetimeSeconds: MatchSystem.describe(telemetry.lifetimes),
        killerDistanceM: MatchSystem.describe(telemetry.killerDistances),
        pathAdvances: telemetry.pathAdvances,
        stuckPerThousandPathAdvances: telemetry.pathAdvances
          ? Number((telemetry.stuckRecoveries * 1000 / telemetry.pathAdvances).toFixed(2))
          : null,
        stuckByZone: { ...telemetry.stuckByZone },
        stuckSamples: telemetry.stuckSamples.slice(0, 20),
        spawnDeathDetail: telemetry.spawnDeathDetail.slice(0, 20),
        killsByTeam: { ...telemetry.killsByTeam },
      },
    };
  }

  snapshot() {
    return {
      phase: this.phase,
      clock: Number(this.clock.toFixed(3)),
      timeRemaining: Number(this.getTimeRemaining().toFixed(3)),
      winner: this.winner,
      endReason: this.endReason,
      scores: this.getScores(),
      alive: {
        alpha: this.teams.get('alpha').roster.filter((id) => this.byId.get(id).alive).length,
        bravo: this.teams.get('bravo').roster.filter((id) => this.byId.get(id).alive).length,
      },
      killFeed: this.killFeed.slice(0, 3),
      telemetry: {
        kills: this.telemetry.kills,
        deaths: this.telemetry.deaths,
        respawns: this.telemetry.respawns,
        spawnDeaths: this.telemetry.spawnDeaths,
        stuckRecoveries: this.telemetry.stuckRecoveries,
      },
    };
  }

  dispose() { this.deathOff?.(); this.contactOff?.(); }
}
