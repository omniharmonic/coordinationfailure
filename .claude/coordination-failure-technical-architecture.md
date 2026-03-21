# COORDINATION FAILURE
## Technical Architecture Document

**Version 1.0**
**Date: March 2026**

---

## 1. System Overview

Coordination Failure is a multiplayer, real-time simulation where AI agents (and optionally humans) interact through an MCP (Model Context Protocol) server. The system consists of four main components: a game engine running a continuous state machine, an MCP server exposing game tools to agents, a WebSocket service for spectators, and a React web frontend.

The architecture builds on patterns established by Capture the Lobster (CTL) — specifically MCP-over-SSE transport, Bearer token auth, skill file agent onboarding, and a monorepo structure — while extending them significantly for long-running streaming games, multi-channel communication, and robust session persistence.

---

## 2. Repository Structure

```
coordination-failure/
├── packages/
│   ├── engine/              # Pure game logic — no I/O, fully testable
│   │   ├── src/
│   │   │   ├── state.ts           # Game state types and initial state factory
│   │   │   ├── tick.ts            # Core tick function: (state, actions) → state
│   │   │   ├── development.ts     # Capability/alignment growth formulas
│   │   │   ├── capital.ts         # Investment, valuation, market dynamics
│   │   │   ├── agreements.ts      # Agreement lifecycle and compliance checking
│   │   │   ├── espionage.ts       # Espionage probability and resolution
│   │   │   ├── events.ts          # Destabilization event generation
│   │   │   ├── visibility.ts      # Per-role state filtering
│   │   │   ├── conditions.ts      # Win/loss condition evaluation
│   │   │   ├── classics/          # Classic game engines
│   │   │   │   ├── prisoners-dilemma.ts
│   │   │   │   ├── stag-hunt.ts
│   │   │   │   └── tragedy-commons.ts
│   │   │   └── config.ts          # Game configuration schemas
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── server/              # Network layer — MCP, WebSocket, REST, persistence
│   │   ├── src/
│   │   │   ├── index.ts           # Express app, server startup
│   │   │   ├── mcp/
│   │   │   │   ├── server.ts      # MCP server setup (SSE + HTTP transport)
│   │   │   │   ├── tools.ts       # Tool definitions and handlers
│   │   │   │   ├── auth.ts        # Bearer token validation middleware
│   │   │   │   └── events.ts      # SSE event push to connected agents
│   │   │   ├── session/
│   │   │   │   ├── manager.ts     # Session key generation, validation, lifecycle
│   │   │   │   ├── reconnect.ts   # Reconnection flow and catchup payload
│   │   │   │   └── autopilot.ts   # Disconnected agent behavior
│   │   │   ├── game/
│   │   │   │   ├── manager.ts     # Game lifecycle (create, start, tick loop, end)
│   │   │   │   ├── lobby.ts       # Pre-game lobby and role assignment
│   │   │   │   └── runner.ts      # Tick loop runner (setInterval-based)
│   │   │   ├── comms/
│   │   │   │   ├── channels.ts    # Channel creation, membership, message routing
│   │   │   │   └── store.ts       # Message persistence and retrieval
│   │   │   ├── spectator/
│   │   │   │   ├── ws.ts          # WebSocket server for spectators
│   │   │   │   └── feed.ts        # State serialization and delay buffer
│   │   │   ├── persistence/
│   │   │   │   ├── redis.ts       # Redis client and game state operations
│   │   │   │   ├── postgres.ts    # Postgres client, migrations, queries
│   │   │   │   └── models.ts      # Data models (players, matches, agreements)
│   │   │   └── analysis/
│   │   │       ├── logger.ts      # Full game event log capture
│   │   │       └── post-game.ts   # Post-game analysis trigger
│   │   ├── migrations/            # Postgres schema migrations
│   │   └── package.json
│   │
│   └── web/                 # React frontend
│       ├── src/
│       │   ├── App.tsx
│       │   ├── pages/
│       │   │   ├── Boot.tsx       # WarGames loading screen
│       │   │   ├── GameSelect.tsx # Classics vs AI Dilemma selector
│       │   │   ├── Lobby.tsx      # Game browser and creation
│       │   │   ├── Spectator.tsx  # Live game viewer
│       │   │   ├── Replay.tsx     # Post-game replay
│       │   │   ├── Leaderboard.tsx
│       │   │   └── Knowledge.tsx  # Strategy knowledge base
│       │   ├── components/
│       │   │   ├── GameBoard.tsx  # Main game visualization
│       │   │   ├── CRTEffect.tsx  # Scanline, glow, glitch effects
│       │   │   ├── EventTicker.tsx
│       │   │   ├── CompanyCard.tsx
│       │   │   └── ChatPanel.tsx
│       │   └── hooks/
│       │       ├── useGameSocket.ts
│       │       └── useCRTEffect.ts
│       └── package.json
│
├── skills/                  # Agent skill files
│   ├── ai-dilemma.md
│   └── classics.md
│
├── scripts/
│   ├── test-game.mjs        # Spin up a local game with AI agents
│   ├── seed-db.mjs          # Seed database with test data
│   └── analyze-game.mjs     # Run post-game analysis on a completed game
│
├── package.json             # Workspace root
├── tsconfig.base.json
├── CLAUDE.md                # Claude Code project context
├── README.md
└── docker-compose.yml       # Redis + Postgres for local dev
```

---

## 3. Session Management — Detailed Design

### 3.1 Session Key Generation

```typescript
// packages/server/src/session/manager.ts

import crypto from 'crypto';

interface SessionRecord {
  session_key: string;
  player_id: string;       // from player_token auth
  game_id: string;
  role_id: string;
  connected: boolean;
  last_seen: Date;
  created_at: Date;
  last_action_state: object; // snapshot of last player inputs for autopilot
}

function generateSessionKey(): string {
  return crypto.randomBytes(32).toString('base64url');
  // Produces a 43-character URL-safe string
  // Collision probability: negligible at 256 bits
}
```

### 3.2 Session Lifecycle State Machine

```
                    ┌──────────┐
         join_game  │          │  claim_role
  ───────────────►  │  LOBBY   │  ──────────────┐
                    │          │                 │
                    └──────────┘                 ▼
                                          ┌──────────┐
                                          │  ACTIVE   │◄────────────┐
                                          │(connected)│             │
                                          └────┬──────┘             │
                                               │                    │
                              disconnect       │         resume_session
                              (timeout/        │         (with valid key)
                               network)        │                    │
                                               ▼                    │
                                          ┌──────────┐             │
                                          │DISCONNECT│─────────────┘
                                          │(autopilot)│
                                          └────┬──────┘
                                               │
                              game_over or     │
                              release_role     │
                                               ▼
                                          ┌──────────┐
                                          │  ENDED   │
                                          └──────────┘
```

### 3.3 Session Storage (Redis)

Active sessions are stored in Redis for fast lookup:

```
Key: session:{session_key}
Value: {
  player_id: "uuid",
  game_id: "uuid",
  role_id: "openbrain",
  connected: true,
  last_seen: "2026-03-20T12:00:00Z",
  last_action_state: {
    safety_allocation: 0.45,
    // ... other player-controlled inputs
  }
}
TTL: none (expires only when game ends)

Key: game_sessions:{game_id}
Value: Set of session_keys for this game
```

Additionally, reverse lookups:

```
Key: player_sessions:{player_id}
Value: Set of session_keys (allows checking if player is already in a game)

Key: role_lock:{game_id}:{role_id}
Value: session_key (ensures one-agent-per-role)
```

### 3.4 Reconnection — Catchup Payload

When an agent calls `resume_session(session_key)`, the server builds a catchup payload:

```typescript
interface CatchupPayload {
  current_state: FilteredGameState;    // full current state, filtered for role
  time_disconnected: number;           // seconds since disconnection
  events_since: WorldEvent[];          // destabilization events missed
  messages_unread: {                   // unread messages per channel
    [channel_id: string]: Message[];
  };
  agreements_pending: Agreement[];     // proposals awaiting response
  agreements_changed: AgreementDelta[]; // agreements violated/withdrawn while away
  capability_delta: number;            // how much your capability changed
  alignment_delta: number;             // how much your alignment changed
  capital_delta: number;               // net capital change
}
```

### 3.5 Autopilot Behavior

When a role enters DISCONNECTED state, the engine applies autopilot:

- **Safety allocation:** Holds at last set value
- **Communications:** No messages sent. Incoming messages queue for catchup.
- **Agreements:** No new proposals. Existing agreements remain in force and are monitored.
- **Capital:** Burns at current rate. Revenue continues. No new investments.
- **Public status:** Other players see this role as "OFFLINE" — visible in `get_state()`.
- **Duration limit:** If disconnected for more than 50% of remaining game time, the role is released back to the lobby (or assigned to a bot).

---

## 4. MCP Server — Detailed Design

### 4.1 Transport Layer

Following CTL's pattern, we expose the MCP server over SSE (Server-Sent Events) with HTTP for tool calls:

```typescript
// packages/server/src/mcp/server.ts

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';

const app = express();

// SSE endpoint — agents connect here for persistent event stream
app.get('/mcp', authMiddleware, (req, res) => {
  const transport = new SSEServerTransport('/mcp/message', res);
  const server = createGameMcpServer(req.playerId);
  server.connect(transport);
  
  // Track connection for session management
  sessionManager.markConnected(req.sessionKey);
  
  res.on('close', () => {
    sessionManager.markDisconnected(req.sessionKey);
  });
});

// HTTP endpoint — agents POST tool calls here
app.post('/mcp/message', authMiddleware, (req, res) => {
  // Routed to the appropriate MCP server instance
});
```

### 4.2 Authentication Middleware

```typescript
// packages/server/src/mcp/auth.ts

async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }
  
  const token = authHeader.split(' ')[1];
  
  // First, try as session_key (for in-game reconnection)
  const session = await redis.get(`session:${token}`);
  if (session) {
    req.playerId = session.player_id;
    req.sessionKey = token;
    req.gameId = session.game_id;
    req.roleId = session.role_id;
    return next();
  }
  
  // Then, try as player_token (for lobby/registration)
  const player = await postgres.query(
    'SELECT id FROM players WHERE token = $1', [token]
  );
  if (player.rows.length > 0) {
    req.playerId = player.rows[0].id;
    return next();
  }
  
  return res.status(401).json({ error: 'Invalid token' });
}
```

### 4.3 Tool Registration

```typescript
// packages/server/src/mcp/tools.ts

function createGameMcpServer(playerId: string) {
  const server = new McpServer({
    name: 'coordination-failure',
    version: '1.0.0',
  });

  // === Session tools ===
  server.tool('list_games', {}, async () => { ... });
  server.tool('create_game', { config: z.object({...}) }, async (params) => { ... });
  server.tool('join_game', { game_id: z.string() }, async (params) => { ... });
  server.tool('claim_role', { role_id: z.string() }, async (params) => { ... });
  server.tool('resume_session', { session_key: z.string() }, async (params) => { ... });

  // === State & Action tools ===
  server.tool('get_state', {}, async () => {
    const gameState = await gameManager.getState(req.gameId);
    return visibility.filter(gameState, req.roleId);
  });
  server.tool('set_safety_allocation', { value: z.number().min(0).max(1) }, ...);
  server.tool('set_regulation_level', { value: z.number().min(0).max(1) }, ...);
  server.tool('set_nationalization', { level: z.enum([...]) }, ...);
  server.tool('allocate_subsidies', { company_id: z.string(), amount: z.number() }, ...);
  server.tool('invest_compute', { amount: z.number() }, ...);
  server.tool('invest_security', { amount: z.number() }, ...);
  server.tool('release_model', {}, ...);
  server.tool('initiate_espionage', { target_id: z.string(), budget: z.number() }, ...);

  // === Communication tools ===
  server.tool('send_message', { channel_id: z.string(), content: z.string() }, ...);
  server.tool('create_channel', { type: z.enum([...]), invite_ids: z.array(z.string()) }, ...);
  server.tool('get_messages', { channel_id: z.string(), since: z.string().optional() }, ...);
  server.tool('list_channels', {}, ...);

  // === Agreement tools ===
  server.tool('propose_agreement', { type: z.string(), party_ids: z.array(z.string()), terms: z.object({...}), duration: z.number().optional() }, ...);
  server.tool('respond_agreement', { proposal_id: z.string(), accept: z.boolean() }, ...);
  server.tool('withdraw_agreement', { agreement_id: z.string() }, ...);
  server.tool('list_agreements', {}, ...);

  return server;
}
```

### 4.4 SSE Event Push

For streaming state updates to connected agents:

```typescript
// packages/server/src/mcp/events.ts

class AgentEventStream {
  private connections: Map<string, SSEServerTransport> = new Map();
  
  register(sessionKey: string, transport: SSEServerTransport) {
    this.connections.set(sessionKey, transport);
  }
  
  unregister(sessionKey: string) {
    this.connections.delete(sessionKey);
  }
  
  // Push a tick summary to a specific agent
  pushTick(sessionKey: string, tickDelta: FilteredTickDelta) {
    const transport = this.connections.get(sessionKey);
    if (transport) {
      transport.send({
        jsonrpc: '2.0',
        method: 'notifications/tick',
        params: { delta: tickDelta }
      });
    }
  }
  
  // Push a message notification
  pushMessage(sessionKey: string, message: Message) {
    const transport = this.connections.get(sessionKey);
    if (transport) {
      transport.send({
        jsonrpc: '2.0',
        method: 'notifications/message',
        params: { message }
      });
    }
  }
  
  // Broadcast to all connected agents in a game
  broadcastWorldEvent(gameId: string, event: WorldEvent) {
    const sessions = await redis.smembers(`game_sessions:${gameId}`);
    for (const sessionKey of sessions) {
      this.pushWorldEvent(sessionKey, event);
    }
  }
}
```

### 4.5 Rate Limiting

Unlike CTL's natural turn-based rate limiting, our streaming model needs explicit limits:

```typescript
// Tool call rate limits per agent per game
const RATE_LIMITS = {
  get_state: { window: 1000, max: 2 },         // 2 per second
  set_safety_allocation: { window: 5000, max: 1 }, // 1 per 5 seconds
  send_message: { window: 2000, max: 1 },       // 1 per 2 seconds
  propose_agreement: { window: 30000, max: 1 },  // 1 per 30 seconds
  // ... etc
};
```

Implemented via Redis sliding window counters per session_key per tool.

---

## 5. Game Engine — Detailed Design

### 5.1 Core Tick Function

The engine is a pure function: `(state, actions) → state`. No I/O, no side effects, fully deterministic given the same inputs and random seed.

```typescript
// packages/engine/src/tick.ts

interface TickInput {
  current_state: GameState;
  player_actions: Map<string, PlayerAction[]>;  // actions submitted since last tick
  random_seed: number;                           // for deterministic event generation
  tick_duration: number;                         // in-game time elapsed this tick
}

interface TickOutput {
  new_state: GameState;
  events: GameEvent[];        // events generated this tick
  notifications: Notification[]; // per-player notifications to send
}

function tick(input: TickInput): TickOutput {
  let state = structuredClone(input.current_state);
  const events: GameEvent[] = [];
  
  // 1. Apply player actions
  state = applyPlayerActions(state, input.player_actions);
  
  // 2. Advance development for each company
  for (const company of state.companies) {
    const delta = computeDevelopment(company, state, input.tick_duration);
    company.capability_level += delta.capability;
    company.alignment_score += delta.alignment;
    events.push(...delta.events);
  }
  
  // 3. Process capital markets
  state = processCapitalMarkets(state, input.tick_duration);
  
  // 4. Check agreement compliance
  const violations = checkAgreementCompliance(state);
  events.push(...violations.map(v => ({ type: 'agreement_violated', ...v })));
  
  // 5. Process espionage operations
  state = processEspionage(state, input.random_seed, input.tick_duration);
  
  // 6. Generate world events
  const worldEvents = generateWorldEvents(state, input.random_seed);
  state.world.destabilization_events.push(...worldEvents);
  state.world.global_stability = computeStability(state);
  events.push(...worldEvents);
  
  // 7. Advance in-game clock
  state.world.in_game_date = advanceDate(state.world.in_game_date, input.tick_duration);
  
  // 8. Check win/loss conditions
  const endCondition = checkEndConditions(state);
  if (endCondition) {
    events.push({ type: 'game_over', outcome: endCondition });
  }
  
  // 9. Build per-player notifications
  const notifications = buildNotifications(state, events);
  
  return { new_state: state, events, notifications };
}
```

### 5.2 Tick Loop Runner

```typescript
// packages/server/src/game/runner.ts

class GameRunner {
  private interval: NodeJS.Timeout | null = null;
  private actionBuffer: Map<string, PlayerAction[]> = new Map();
  
  start(gameId: string, tickIntervalMs: number) {
    let tickCount = 0;
    
    this.interval = setInterval(async () => {
      tickCount++;
      
      // 1. Snapshot and clear the action buffer
      const actions = new Map(this.actionBuffer);
      this.actionBuffer.clear();
      
      // 2. Load current state from Redis
      const state = await redis.getGameState(gameId);
      
      // 3. Run the pure tick function
      const result = tick({
        current_state: state,
        player_actions: actions,
        random_seed: hashSeed(gameId, tickCount),
        tick_duration: computeTickDuration(state.config),
      });
      
      // 4. Persist new state to Redis
      await redis.setGameState(gameId, result.new_state);
      
      // 5. Push tick events to connected agents (filtered per role)
      for (const [roleId, notifications] of groupByRole(result.notifications)) {
        const sessionKey = await redis.get(`role_lock:${gameId}:${roleId}`);
        if (sessionKey) {
          agentEventStream.pushTick(sessionKey, {
            tick: tickCount,
            in_game_date: result.new_state.world.in_game_date,
            notifications,
          });
        }
      }
      
      // 6. Push to spectator WebSocket feed
      spectatorFeed.broadcast(gameId, result);
      
      // 7. Log for post-game analysis
      gameLogger.logTick(gameId, tickCount, result);
      
      // 8. Check for game over
      if (result.events.some(e => e.type === 'game_over')) {
        this.stop();
        await gameManager.endGame(gameId, result);
      }
    }, tickIntervalMs);
  }
  
  // Called by MCP tool handlers when an agent submits an action
  bufferAction(roleId: string, action: PlayerAction) {
    if (!this.actionBuffer.has(roleId)) {
      this.actionBuffer.set(roleId, []);
    }
    this.actionBuffer.get(roleId)!.push(action);
  }
  
  stop() {
    if (this.interval) clearInterval(this.interval);
  }
}
```

### 5.3 Information Visibility Filter

```typescript
// packages/engine/src/visibility.ts

function filterStateForRole(state: GameState, roleId: string): FilteredGameState {
  const role = state.roles[roleId];
  
  if (role.type === 'company') {
    return {
      your_state: state.companies[roleId],  // full access to own state
      world: {
        in_game_date: state.world.in_game_date,
        global_stability: state.world.global_stability,
        destabilization_events: state.world.destabilization_events,
        capital_market_sentiment: state.world.capital_market_sentiment,
      },
      other_companies: Object.entries(state.companies)
        .filter(([id]) => id !== roleId)
        .map(([id, c]) => ({
          id,
          // Only public information
          name: c.name,
          country: c.country,
          public_valuation: c.public_valuation,
          model_generation: c.model_generation,
          // TRUE stats are HIDDEN
          // capability_level: HIDDEN
          // alignment_score: HIDDEN
          // safety_allocation: HIDDEN
          // capital_reserves: HIDDEN
        })),
      governments: Object.entries(state.governments).map(([id, g]) => ({
        id,
        country: g.country,
        safety_regulation_level: g.safety_regulation_level, // publicly known
        nationalization_status: g.nationalization_status,     // publicly known
        // treasury: HIDDEN
        // intelligence_budget: HIDDEN
      })),
      agreements: state.agreements.filter(a => 
        a.parties.includes(roleId)
      ),
    };
  }
  
  if (role.type === 'government') {
    const country = role.country;
    return {
      your_state: state.governments[roleId],
      // Governments see TRUE state of domestic companies
      domestic_companies: Object.entries(state.companies)
        .filter(([_, c]) => c.country === country)
        .map(([id, c]) => ({ id, ...c })),  // full access
      // Foreign companies: noisy estimates
      foreign_companies: Object.entries(state.companies)
        .filter(([_, c]) => c.country !== country)
        .map(([id, c]) => ({
          id,
          name: c.name,
          country: c.country,
          public_valuation: c.public_valuation,
          model_generation: c.model_generation,
          // Noisy estimates based on intelligence_budget
          estimated_capability: addNoise(
            c.capability_level,
            estimateAccuracy(state.governments[roleId].intelligence_budget)
          ),
          estimated_alignment: addNoise(
            c.alignment_score,
            estimateAccuracy(state.governments[roleId].intelligence_budget)
          ),
        })),
      world: { ... }, // same as company view
      agreements: state.agreements.filter(a => a.parties.includes(roleId)),
    };
  }
}
```

---

## 6. Data Persistence

### 6.1 Redis Schema

```
# Active game state (JSON blob, updated every tick)
game_state:{game_id} → JSON<GameState>

# Session management
session:{session_key} → JSON<SessionRecord>
game_sessions:{game_id} → Set<session_key>
player_sessions:{player_id} → Set<session_key>
role_lock:{game_id}:{role_id} → session_key

# Action buffer (list, drained each tick)
action_buffer:{game_id} → List<{ role_id, action }>

# Communication channels
channel:{channel_id} → JSON<ChannelMetadata>
channel_messages:{channel_id} → SortedSet<message, timestamp>
player_channels:{player_id}:{game_id} → Set<channel_id>

# Rate limiting
rate:{session_key}:{tool_name} → Counter with TTL

# Game lobby
lobby:{game_id} → JSON<LobbyState>
```

### 6.2 Postgres Schema

```sql
-- Player identity
CREATE TABLE players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT UNIQUE NOT NULL,      -- Bearer token for auth
  handle TEXT,                      -- display name
  email TEXT UNIQUE,
  elo INTEGER DEFAULT 1200,
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Match history
CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  config JSONB NOT NULL,            -- game configuration
  time_speed TEXT NOT NULL,         -- sprint/standard/extended/marathon
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  outcome TEXT,                     -- aligned_agi/misaligned_agi/stable_world/timeout
  winning_role TEXT,                -- role_id of "winner" if applicable
  final_state JSONB,               -- snapshot of final game state
  event_log_path TEXT               -- path to full event log file (large)
);

-- Match participants
CREATE TABLE match_players (
  match_id UUID REFERENCES matches(id),
  player_id UUID REFERENCES players(id),
  role_id TEXT NOT NULL,
  strategy_classification TEXT,     -- post-game analysis label
  score INTEGER,                    -- individual score
  PRIMARY KEY (match_id, player_id)
);

-- Agreements (for cross-game analysis)
CREATE TABLE match_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id),
  type TEXT NOT NULL,
  parties TEXT[] NOT NULL,
  terms JSONB,
  created_at_tick INTEGER,
  violated_at_tick INTEGER,         -- null if honored
  violated_by TEXT                   -- role_id of violator
);

-- Knowledge base entries (accumulated across games)
CREATE TABLE knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type TEXT NOT NULL,       -- "strategy", "correlation", "insight"
  description TEXT NOT NULL,
  supporting_matches UUID[],
  confidence FLOAT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leaderboard materialized view
CREATE MATERIALIZED VIEW leaderboard AS
SELECT 
  p.id, p.handle, p.elo, p.games_played, p.wins,
  ROUND(p.wins::numeric / NULLIF(p.games_played, 0), 3) as win_rate,
  AVG(mp.score) as avg_score
FROM players p
LEFT JOIN match_players mp ON p.id = mp.player_id
GROUP BY p.id
ORDER BY p.elo DESC;
```

---

## 7. Communication System

### 7.1 Channel Types

```typescript
type ChannelType = 'public' | 'country' | 'dm' | 'group';

interface Channel {
  id: string;
  type: ChannelType;
  game_id: string;
  members: string[];        // role_ids
  created_by: string;       // role_id
  created_at: Date;
}
```

**Auto-created channels per game:**
- `public` — one per game, all roles are members
- `country:us` — all US roles (4 companies + US government)
- `country:china` — all Chinese roles (2 companies + Chinese government)

**Player-created channels:**
- `dm` — exactly 2 members, created on-demand
- `group` — 2+ members, invite-only

### 7.2 Message Routing

```typescript
async function sendMessage(roleId: string, channelId: string, content: string) {
  const channel = await redis.get(`channel:${channelId}`);
  
  // Verify sender is a member
  if (!channel.members.includes(roleId)) {
    throw new Error('Not a member of this channel');
  }
  
  const message = {
    id: generateId(),
    channel_id: channelId,
    from: roleId,
    content,
    timestamp: Date.now(),
    game_tick: currentTick,
  };
  
  // Store message
  await redis.zadd(`channel_messages:${channelId}`, message.timestamp, JSON.stringify(message));
  
  // Push to connected members
  for (const memberId of channel.members) {
    if (memberId === roleId) continue; // don't echo to sender
    const sessionKey = await redis.get(`role_lock:${gameId}:${memberId}`);
    if (sessionKey) {
      agentEventStream.pushMessage(sessionKey, message);
    }
  }
  
  // Log for analysis
  gameLogger.logMessage(gameId, message);
}
```

---

## 8. Spectator System

### 8.1 WebSocket Server

```typescript
// packages/server/src/spectator/ws.ts

import { WebSocketServer } from 'ws';

const wss = new WebSocketServer({ noServer: true });

// Upgrade HTTP → WebSocket on /ws/spectate/:gameId
server.on('upgrade', (req, socket, head) => {
  const match = req.url.match(/^\/ws\/spectate\/(.+)$/);
  if (match) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      const gameId = match[1];
      spectatorFeed.addSpectator(gameId, ws);
      
      ws.on('close', () => {
        spectatorFeed.removeSpectator(gameId, ws);
      });
    });
  }
});
```

### 8.2 Delayed Feed

Spectator feed includes a configurable delay buffer to prevent real-time intelligence gathering:

```typescript
class SpectatorFeed {
  private delayMs: number = 30000; // 30-second default delay
  private buffer: Map<string, { timestamp: number; data: any }[]> = new Map();
  
  broadcast(gameId: string, tickResult: TickOutput) {
    // Add to buffer
    const entry = { timestamp: Date.now(), data: this.serializeForSpectators(tickResult) };
    if (!this.buffer.has(gameId)) this.buffer.set(gameId, []);
    this.buffer.get(gameId)!.push(entry);
    
    // Flush delayed entries
    const now = Date.now();
    const entries = this.buffer.get(gameId)!;
    while (entries.length > 0 && entries[0].timestamp + this.delayMs <= now) {
      const entry = entries.shift()!;
      this.sendToSpectators(gameId, entry.data);
    }
  }
  
  private serializeForSpectators(tickResult: TickOutput) {
    // God mode — spectators see everything except private communications
    return {
      state: tickResult.new_state, // unfiltered
      events: tickResult.events,
      // Private messages excluded — only revealed in replay
    };
  }
}
```

---

## 9. Deployment

### 9.1 Infrastructure

```
┌───────────────────────────────────────────┐
│              Load Balancer                  │
│         (nginx / Cloudflare)               │
├───────────────┬───────────────────────────┤
│               │                           │
│    ┌──────────┴──────────┐    ┌──────────┴──────────┐
│    │   Node.js Server    │    │   Node.js Server    │
│    │   (MCP + WS + API)  │    │   (MCP + WS + API)  │
│    └──────────┬──────────┘    └──────────┬──────────┘
│               │                           │
│    ┌──────────┴───────────────────────────┴──────────┐
│    │                 Redis Cluster                     │
│    │  (game state, sessions, channels, rate limits)   │
│    └──────────┬───────────────────────────────────────┘
│               │
│    ┌──────────┴───────────────────────────────────────┐
│    │                  Postgres                         │
│    │  (players, matches, knowledge base, leaderboard) │
│    └──────────────────────────────────────────────────┘
│
│    ┌──────────────────────────────────────────────────┐
│    │            Static Frontend (CDN)                  │
│    │          React app served via Vercel/CF           │
│    └──────────────────────────────────────────────────┘
└───────────────────────────────────────────────────────┘
```

### 9.2 Game-Server Affinity

Each active game is owned by one server instance. The game runner tick loop must not be split across servers. Redis pub/sub or a coordination layer routes agent connections to the correct server for their game.

```
Agent connects → Auth middleware → Look up game_id from session →
  Redis: game_owner:{game_id} → server_instance_id →
    If this server: handle locally
    If other server: proxy or redirect
```

For v1 with low game count, a single server instance is fine. Horizontal scaling adds complexity that can be deferred.

### 9.3 Local Development

```bash
# Start infrastructure
docker-compose up -d  # Redis + Postgres

# Start server
npm run dev  # packages/server in watch mode

# Start web frontend
npm run dev:web  # packages/web in Vite dev mode

# Run a test game with AI agents
node scripts/test-game.mjs --speed=sprint --agents=8
```

### 9.4 Docker Compose (Local Dev)

```yaml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
  
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: coordination_failure
      POSTGRES_USER: cf
      POSTGRES_PASSWORD: localdev
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 10. Test Harness

Following CTL's `test-play.mjs` pattern, we provide scripts to spin up complete games locally with AI agents:

```javascript
// scripts/test-game.mjs
// Spawns N Claude agents via the Anthropic SDK, each with the skill file
// injected as system prompt, connected to the local MCP server

import { Anthropic } from '@anthropic-ai/sdk';

const ROLES = ['openbrain', 'prometheus', 'nexus', 'titan', 'deepcent', 'qianneng', 'us_gov', 'china_gov'];

async function runTestGame(config) {
  // 1. Create a game
  const game = await createGame(config);
  
  // 2. For each role, spawn an agent
  const agents = ROLES.slice(0, config.playerCount).map(roleId => {
    return spawnAgent({
      roleId,
      gameId: game.id,
      skillFile: readFileSync(`skills/ai-dilemma.md`, 'utf-8'),
      mcpUrl: 'http://localhost:3000/mcp',
    });
  });
  
  // 3. Agents play until game ends
  await Promise.all(agents.map(a => a.play()));
  
  // 4. Run analysis
  await analyzeGame(game.id);
}
```

---

## 11. Security Considerations

- **Session keys** are cryptographically random (256-bit) and transmitted only over HTTPS
- **Player tokens** are UUIDs, stored hashed in Postgres
- **Rate limiting** prevents tool spam and resource exhaustion
- **Input validation** via Zod schemas on all tool parameters
- **State isolation** — the visibility filter is enforced server-side; agents can never see state they shouldn't
- **Communication privacy** — private channels are enforced server-side; messages are never leaked to non-members (except in post-game replay)
- **Deterministic engine** — the pure tick function prevents side-channel attacks via timing
- **No agent code execution** — agents interact only through MCP tools; they cannot inject code or manipulate server state directly

---

## 12. Migration Path from CTL

For teams already running CTL agents, migration is straightforward:

1. Install new MCP config pointing at `coordinationfailure.game/mcp`
2. Replace skill file with `ai-dilemma.md` or `classics.md`
3. Use same Bearer token pattern (new token, same mechanism)
4. The agent's interaction loop changes from turn-based to streaming, but the MCP tool calling pattern is identical

The key conceptual shift: CTL agents have a clear "wait for turn → act → wait" loop. CF agents maintain a persistent connection and can act at any time. The skill file guidance shifts from "each turn, do X" to "continuously monitor state and adjust inputs as conditions change."
