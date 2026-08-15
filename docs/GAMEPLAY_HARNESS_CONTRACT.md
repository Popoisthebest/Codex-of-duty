# Gameplay Harness Contract v3

## Existing bridge

Keep the existing:

```js
window.__COD_HARNESS__
```

Do not remove existing v2 methods.

v3 adds two methods:

```ts
getGameplayReport(): GameplayReport
runScenario(name: string, options?: object): Promise<ScenarioResult>
```

## GameplayReport

Expected shape:

```js
{
  version: 3,
  mode: "tdm",
  phase: "prematch" | "active" | "ended",
  scoreLimit: 100,
  timeLimitSeconds: 600,

  participants: {
    total: 12,
    human: 1,
    alliedBots: 5,
    enemyBots: 6
  },

  teams: [
    {
      id: "alpha",
      score: 0,
      rosterSize: 6,
      alive: 6
    },
    {
      id: "bravo",
      score: 0,
      rosterSize: 6,
      alive: 6
    }
  ],

  world: {
    playableWidthM: 100,
    playableDepthM: 100,
    playableAreaM2: 10000,
    zones: 6,
    primaryRoutes: 3,
    routeLoops: 2,
    verticalLevels: 2,
    spawnPoints: 16,
    landmarks: 5,
    indoorZones: 2,
    outdoorZones: 4,
    indoorOutdoorTransitions: 3
  },

  telemetry: {
    matchTimeSeconds: 0,
    kills: 0,
    deaths: 0,
    respawns: 0,
    spawnDeaths: 0,
    stuckRecoveries: 0
  }
}
```

Values must reflect production state.

Do not hard-code report values merely to satisfy tests.

## Scenario: `tdm-core`

The deterministic scenario must exercise production systems.

Expected result:

```js
{
  ok: true,
  matchStarted: true,
  participantsReady: true,
  scoreChangedFromKill: true,
  deathObserved: true,
  respawnObserved: true,
  scoreboardConsistent: true,
  matchEndedByScoreLimit: true,
  winnerDeclared: true,
  restartReturnedToCleanMatch: true,
  usedProductionDamage: true,
  usedProductionScoring: true,
  usedProductionRespawn: true,
  runtimeErrors: 0,
  nonFiniteState: false
}
```

### Critical truthfulness rule

The scenario runner may:
- seed RNG
- fix timestep
- inject deterministic player/bot inputs
- choose deterministic target/spawn candidates
- accelerate simulation time
- select a test loadout

It may not:
- directly increment team score instead of producing a real kill
- directly set an actor dead instead of using damage/death
- directly set a winner instead of using the match rules
- directly restore alive state instead of using respawn
- return hard-coded `true` values without evidence

The scenario must go through the same authoritative systems as normal gameplay.

## Scenario: `combat-soak`

Recommended result:

```js
{
  ok: true,
  simulatedSeconds: 120,
  kills: 1,
  deaths: 1,
  respawns: 1,
  activeParticipants: 12,
  maxStuckSeconds: 0,
  nonFiniteState: false,
  runtimeErrors: 0
}
```

Exact kill count is not the gate. The purpose is to prove the game stays alive and combat-capable over time.

## Map report

`gameplay:map-audit` reads `getGameplayReport().world`.

The numeric thresholds exist to reject tiny/simple arenas.

They do not prove map quality.

A map that lies in metadata or contains empty padding is still a failed map.

## Versioning

Keep:
- `window.__COD_HARNESS__.version >= 2`

Add:
- `getGameplayReport().version >= 3`

Do not unnecessarily break old harness tools.
