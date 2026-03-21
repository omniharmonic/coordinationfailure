# Coordination Failure

AI-native coordination simulation suite. Two modules from a unified retro-futuristic terminal interface:
- **The AI Dilemma** — Real-time streaming simulation of the race to AGI
- **The Classics** — Iterated simulations of canonical coordination failures

## Architecture

Monorepo with npm workspaces:
- `packages/engine` — Pure game logic, no I/O, fully deterministic. Core tick function: `(state, actions) → state`
- `packages/server` — Express server with MCP-like JSON-RPC tool interface, SSE events, WebSocket spectator feed
- `packages/web` — React + Vite frontend with WarGames CRT aesthetic

## Development

```bash
# Install deps
npm install

# Start server
npm run dev                  # packages/server on :3000

# Start web frontend
npm run dev:web              # packages/web on :5173 (proxies to :3000)

# Run engine tests
npm run test:engine

# Run a test game with bots
node scripts/test-game.mjs --speed=sprint --agents=4
```

## Key Design Decisions

- Engine is a **pure function** — no I/O, seeded PRNG for determinism. Same seed + actions = same game.
- **In-memory stores** for v1 (no Redis/Postgres required). Production would swap to Redis for game state + Postgres for persistence.
- **Simplified MCP interface** — JSON-RPC style POST `/mcp/tool` + SSE GET `/mcp/events`. Full MCP SDK can be integrated later.
- **Session keys** bind agent identity to game role. 256-bit cryptographic tokens survive disconnection.

## Game Roles (AI Dilemma)

6 companies (4 US, 2 China): openbrain, prometheus, nexus, titan, deepcent, qianneng
2 governments: us_gov, china_gov

## Engine Tuning Parameters

See `packages/engine/src/config.ts` — `createDefaultConfig()` for all tunable values.
Key ones: `safety_cost_coefficient`, `alignment_decay_rate`, `alignment_growth_rate`, `event_frequency_base`.
