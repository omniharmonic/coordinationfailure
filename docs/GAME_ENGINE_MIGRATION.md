# The Classics → Coordination Games engine migration

This branch (`game-engine`) ports **The Classics** off the legacy monolithic
tick function in `packages/engine` and onto the plugin-based
[Coordination Games](https://github.com/coordination-games/coordination-games)
framework authored by Lucian. Every classic is now a
`CoordinationGame<TConfig, TState, TAction, TOutcome>` plugin that can run
unchanged inside Lucian's engine.

> The AI Dilemma is untouched on this branch — we deliberately feature only
> The Classics first, per project priority.

## Layout

```
packages/
  coordination-engine/                # Vendored @coordination-games/engine
  engine/                             # Legacy monolithic engine (AI Dilemma, v1 classics)
  games/
    prisoners-dilemma/                # @coordination-failure/game-prisoners-dilemma
    stag-hunt/                        # @coordination-failure/game-stag-hunt
    tragedy-commons/                  # @coordination-failure/game-tragedy-commons
  server/                             # Legacy API server (untouched)
  web/                                # Legacy frontend (untouched)
scripts/
  run-classics.mjs                    # Full bot-driven game runs per classic
  classics-drift.test.mjs             # System-action isolation + determinism checks
```

## What each plugin provides

Every classic implements the six required methods (`createInitialState`,
`validateAction`, `applyAction`, `getVisibleState`, `isOver`, `getOutcome`)
plus `buildSpectatorView`, `entryCost`, `computePayouts`, `lobby` config,
`gameTools` JSON-Schema tool definitions, a `guide` (rules markdown), and
`createConfig`.

| Plugin | Players | System actions | Player tools |
|---|---|---|---|
| `prisoners-dilemma` | 2 | `game_start`, `round_timeout` | `submit_choice` |
| `stag-hunt` | 3–8 | `game_start`, `end_communication`, `round_timeout` | `send_message`, `submit_choice` |
| `tragedy-commons` | 3–8 | `game_start`, `round_timeout` | `set_extraction` |

Each plugin exports a frozen `*_SYSTEM_ACTION_TYPES` list so the
release-blocking drift tests can enforce the system-action isolation
invariant described in `docs/building-a-game.md` of the upstream engine.

## Zero-sum payouts

All three classics share one payout helper,
`computeZeroSumPayouts(rankings, playerIds, entryCost)`, which splits the
entry pool proportionally to final score. The sum of deltas is always
exactly 0 (with a rounding-correction pass), and no player can ever lose
more than their `entryCost`. Zero-sum is a hard precondition of the
framework because every game result is eventually Merkle-anchored
on-chain.

## Commands

```bash
# Install workspaces (includes vendored engine + 3 game packages)
npm install

# Build everything
npm run build

# Run all tests across workspaces
npm test

# Run the full bot harness (9 scenarios across 3 classics)
npm run classics:run

# Run the drift + determinism harness
node scripts/classics-drift.test.mjs
```

## Verification summary

Running `npm test` produces **114 passing tests** across 5 packages:

| Package | Tests |
|---|---|
| `packages/coordination-engine` (vendored Lucian engine) | 48 |
| `packages/engine` (legacy AI Dilemma + v1 classics) | 41 |
| `packages/games/prisoners-dilemma` | 11 |
| `packages/games/stag-hunt` | 8 |
| `packages/games/tragedy-commons` | 6 |

Running `node scripts/run-classics.mjs` plays **9 complete bot-driven
scenarios** (3 per classic) to finished state via `GameRoom` and asserts
that every computed payout is zero-sum to machine precision.

Running `node scripts/classics-drift.test.mjs` asserts for every classic:

- every `gameTools` entry is rejected when `playerId === null`
  (privilege-escalation guard),
- every system action is rejected when `playerId !== null`
  (system-action-spoofing guard),
- action types never appear in both lists,
- two identical scenarios produce byte-identical outcomes
  (determinism guard).

## What was intentionally left out

- Upstream `@coordination-games/engine` carries a server framework with
  auth, on-chain settlement, and lobby Durable Objects. That is **not**
  used by this branch — we only consume the game-plugin surface
  (`GameRoom`, `CoordinationGame`, `OpenQueuePhase`, `registerGame`).
  Wiring into Lucian's `workers-server` can happen once the plugins land.

- The legacy server (`packages/server`) still hosts the MCP interface for
  the old classics engine. It's untouched. Porting the server endpoints
  to drive the new plugins is the next step after this branch merges.

- The AI Dilemma is out of scope for this migration and stays on the
  legacy engine for now.
