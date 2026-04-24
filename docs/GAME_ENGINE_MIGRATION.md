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

## Server wiring: pluggable classics backends

The MCP surface in `packages/server` now dispatches classics calls through
a `ClassicsBackend` abstraction with two implementations:

| Backend | Game types | Source |
|---|---|---|
| `legacy` | PD, Stag Hunt, Tragedy of the Commons, **Schelling Point** | `legacy-classics-backend.ts` — the original in-memory engine, unchanged |
| `plugin` | PD, Stag Hunt, Tragedy of the Commons | `plugin-classics-backend.ts` — drives the new CoordinationGame plugins via `GameRoom` |

The top-level `ClassicsManager` routes per game type. Schelling Point
always falls back to `legacy` because no plugin has been written for it.
Games keep their backend for their entire lifetime; flipping the env var
only affects games created after the flip.

### Selecting a backend

```bash
# default — every game type uses legacy (no behavior change)
CLASSICS_BACKEND=legacy

# flip everything to the plugin engine (Schelling still legacy)
CLASSICS_BACKEND=plugin

# per-type: migrate one classic at a time
CLASSICS_BACKEND='{"prisoners_dilemma":"plugin","stag_hunt":"legacy","tragedy_of_commons":"legacy"}'
```

The AI Dilemma flows through `GameManager`, not `ClassicsManager`, and is
untouched by any setting here.

### Semantic differences between backends

The MCP **contract** (tool names, argument shapes, return shapes, phase
transitions) is preserved across backends. The **payoff math** may differ
because the plugins were designed for Lucian's framework and use their own
matrices/growth models:

| Game | Legacy payoffs | Plugin payoffs |
|---|---|---|
| Prisoner's Dilemma | R=3, P=1, T=5, S=0 | **Same** (same matrix) |
| Stag Hunt | stag/stag (4,4), hare/hare (2,2), stag/hare (0,3) | `stagPayoff / N` when all stag, `harePayoff` otherwise |
| Tragedy of the Commons | `resource + growthRate*r*(1-r/cap) - totalExtraction` (additive) | `afterExtraction * growthRate * (1 - after/cap)` (multiplicative logistic) |

Only Prisoner's Dilemma is payoff-identical today. If exact parity for
Stag Hunt or Tragedy of the Commons matters later, we can parameterize
the plugins (e.g. an optional `legacyCompat: true` flag on their configs)
without touching this abstraction.

### Other semantic notes

- **Late joins**: the plugin backend rejects `joinGame` after `game_start`
  has fired, because the plugins bind `playerIds` at `createInitialState`.
  Legacy accepts late joins mid-round. For PD (min=max=2) there is no
  late-join window, so it's unaffected. For SH and TC, all players must
  join before the game auto-starts at `min_players`.
- **Chat**: both backends route `allow_communication=true` messages through
  a simple out-of-band log, so `classic_send_message`/`classic_get_messages`
  behave identically regardless of the backend.
- **Reasoning**: optional chain-of-thought attached to `submitChoice` is
  preserved by both backends and surfaces on `ClassicRoundResult.reasoning`.

### Files

```
packages/server/src/game/
  classics-shared.ts               Shared types + GAME_DEFS used by both backends
  classics-backend.ts              ClassicsBackend interface (the abstraction)
  legacy-classics-backend.ts       Renamed original ClassicsManager (no behavior change)
  plugin-classics-backend.ts       New backend driving GameRoom per game
  classics-manager.ts              Orchestrator that routes per game type

packages/server/src/mcp/
  classics-tool-dispatcher.ts      Pure tool → ClassicsManager method dispatcher
                                   (single code path for HTTP/MCP SDK/tests)

packages/server/src/__tests__/
  classics-backends.test.ts        24 parity + routing tests
  e2e/
    mcp-dispatch.test.ts           28 tests: every classics tool through the
                                   real dispatcher, against both backends
    lifecycle.test.ts              17 tests: full game lifecycles via dispatcher
    strategies.test.ts             12 tests: well-known strategy outcomes
    errors.test.ts                 30 tests: adversarial/error path coverage
    shape-parity.test.ts           6 tests: legacy vs plugin return-shape parity
    concurrency.test.ts            4 tests: multi-game, multi-backend isolation
    callbacks-cleanup.test.ts      10 tests: callback uniqueness + heartbeat
    cleanup-timers.test.ts         5 tests: stale-game cleanup under fake timers
    invariants.test.ts             6 tests × 30 random games each (180 runs):
                                   property-based invariants on both backends

scripts/
  smoke-server-classics.ts         End-to-end round-trip in all routing modes
  e2e-classics-agents.ts           Agent-loop harness: 4 scenarios through
                                   the MCP dispatcher (legacy, plugin, mixed,
                                   and 10-way concurrent PD)
```

### E2E test verification

Running `npm test --workspace=@cf/server` executes 142 tests across 10 suites
in under a second, covering:

- **MCP dispatch contract** — every classics tool name resolves to the
  correct method with the correct argument validation and error messages.
- **Full lifecycle playability** — every game type × both backends plays
  from join to complete via the real dispatcher.
- **Strategy correctness** — tit-for-tat, grim-trigger, always-cooperate,
  and always-defect produce their expected Axelrod-style outcomes.
- **Error paths** — 30 enumerated error branches (invalid game_id, invalid
  choice, out-of-range TC rate, double submit, non-participant action,
  chat-when-disabled, full-game join, post-complete submit, etc.).
- **Shape parity** — legacy and plugin backends return structurally
  equivalent responses from every public method, so agents don't care
  which one answers.
- **Concurrency** — 5 mixed-backend games and 10-way parallel PD prove no
  state leakage between games.
- **Callbacks + heartbeat** — `onGameComplete` fires exactly once per
  game, even with throwing callbacks; polling updates `last_activity`.
- **Cleanup** — fake-timer tests drive the 10/30/60-minute stale cleanup
  logic on both backends.
- **Invariants (property-based)** — 30 random games × 3 game types × 2
  backends = 180 generated scenarios asserting phase monotonicity, score
  finiteness, resource bounds, history-keys-match-players, and
  termination-within-rounds-bound.

Plus `scripts/e2e-classics-agents.ts` drives 4 real-agent scenarios (legacy
everywhere, plugin everywhere, per-type mixed routing, and 10-game
concurrency) through the same dispatcher the production HTTP handler uses.

Shipping criteria met: every tool, every game type, every backend, every
documented error path, every lifecycle transition, plus 180 random-game
invariant scenarios — all green in a single second of wall-clock.

## What was intentionally left out

- Upstream `@coordination-games/engine` carries a server framework with
  auth, on-chain settlement, and lobby Durable Objects. That is **not**
  used by this branch — we only consume the game-plugin surface
  (`GameRoom`, `CoordinationGame`, `OpenQueuePhase`, `registerGame`).
  Wiring into Lucian's `workers-server` can happen once the plugins land.

- The legacy server MCP tools and endpoints in `packages/server` now sit
  behind the backend abstraction. Their public tool names (`list_classics`,
  `join_classic`, `submit_choice`, etc.) are unchanged; only the runtime
  that answers them can now be swapped per game type.

- The AI Dilemma is out of scope for this migration and stays on the
  legacy engine for now.
