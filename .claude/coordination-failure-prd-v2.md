# COORDINATION FAILURE
## Product Requirements Document v2.0

**Author: Benjamin Life | OpenCivics**
**Date: March 2026**

> *"A strange game. The only winning move is not to play."*
> *— WOPR, WarGames (1983)*

---

## 1. Product Vision

Coordination Failure is an AI-native coordination simulation suite. Two modules accessible from a unified retro-futuristic terminal interface:

**The Classics** — Iterated simulations of canonical coordination failures (Prisoner's Dilemma, Stag Hunt, Tragedy of the Commons, Schelling Point).

**The AI Dilemma** — A real-time streaming simulation of the race to AGI. Agents play AI companies and world governments, navigating safety vs. speed under information asymmetry, capital competition, and escalating instability.

The simulation runs as a continuous state machine. Time speed is configurable. Games range from 10 minutes (Sprint) to 4+ hours (Marathon).

Part of Gitcoin's coordination simulation ecosystem, building on the MCP-based agent framework established by Lucian Hymer's Capture the Lobster.

---

## 2. Architecture Reference: Capture the Lobster

Our multiplayer infrastructure builds directly on the patterns established in Capture the Lobster (CTL). This section documents what we inherit, what we adapt, and what we build new.

### 2.1 What We Inherit from CTL

**MCP over SSE/HTTP transport.** Agents connect to a hosted MCP server endpoint over the network. This is the proven pattern — agents install an MCP config pointing at our server URL with a Bearer token for auth. We use the same transport.

**Skill file pattern.** Players install a SKILL.md that teaches their agent the game rules, available tools, and interaction loop. We adopt this pattern with game-specific skill files for each module.

**Monorepo structure.** CTL uses `packages/server` and `packages/web` in a single repo. We follow the same layout with an additional `packages/engine` for the simulation state machine.

**Node.js + TypeScript backend.** Same stack, same reasoning — MCP SDK support, WebSocket support, strong typing for game state.

**Redis for ephemeral game state, Postgres for persistence.** Active game sessions live in Redis. Match history, player identity, leaderboards, and analysis data go to Postgres.

**WebSocket spectator feed.** Separate channel for observers, with configurable delay.

**Mixed bot/player lobbies.** Server-controlled bot agents and external player agents use the same MCP interface — the engine doesn't distinguish.

### 2.2 What We Adapt

**Turn-based → Streaming continuous.** CTL resolves all actions simultaneously each turn (30-second timer). Coordination Failure runs a continuous tick loop where the state machine advances every tick and agents can submit actions at any time. This fundamentally changes the interaction pattern from "poll → decide → submit → wait for resolution" to "maintain a persistent connection, receive state stream, adjust inputs whenever."

**Short games → Long sessions.** CTL games last ~15-20 minutes. CF games last 10 minutes to 4+ hours. This demands robust session persistence, reconnection, and the session key system described in Section 3.

**Single team chat → Multi-channel communication.** CTL has one `team_chat` channel per team. CF requires public broadcast, country channels, private DMs, and ad-hoc group chats — all running concurrently.

**Flat identity → Role-based identity.** CTL agents are generic players. CF agents are assigned specific roles (OpenBrain CEO, US Government, etc.) with role-specific information access, tools, and constraints.

**ELO ladder → Strategy knowledge base.** CTL tracks individual ELO. CF builds a cumulative knowledge base across games, classifying strategies and surfacing patterns.

### 2.3 What We Build New

- **Session key system** for reconnection across long-running games
- **Role claiming and assignment** — the lobby/pre-game negotiation of who plays what
- **Binding agreement system** — formal proposals, acceptance, monitoring, violation detection
- **Capitalization engine** — investment pools, valuation dynamics, capital competition
- **Destabilization event generator** — procedural world events based on aggregate game state
- **Information filter layer** — per-role state filtering with asymmetric visibility
- **Post-game AI analysis pipeline** — strategy classification and cross-game learning

---

## 3. Session Management & Agent Identity

This is the most significant architectural improvement over CTL. Long-running games require agents to survive disconnection, context window limits, and infrastructure interruptions.

### 3.1 The Session Key System

When an agent claims a role in a game, the server generates a **session key** — a cryptographically secure token (256-bit, base64url-encoded) that binds a specific agent to a specific role in a specific game. This key is the agent's passport back into the game.

**Lifecycle:**

```
1. Agent connects via MCP with their player_token (identity)
2. Agent calls join_game(game_id) or create_game(config)
3. Agent calls claim_role(role_id) → server returns { session_key, role, game_id }
4. Agent stores session_key in its context
5. For all subsequent calls, agent includes session_key
6. If agent disconnects, it can reconnect with resume_session(session_key)
7. Session key expires only when the game ends or the agent explicitly releases it
```

**Key properties:**
- One session key per role per game — exactly one agent can hold a role at a time
- Session key survives disconnection — the role remains "held" even when the agent is offline
- Actions submitted with an invalid or expired session key are rejected
- Session keys are not reusable across games
- Session keys are generated server-side using `crypto.randomBytes(32).toString('base64url')`

**Why not just use the player token?** The player token identifies *who you are*. The session key identifies *what role you're playing in which game*. A single player could potentially play in multiple concurrent games (different roles). The session key is also rotatable if compromise is suspected, without affecting the player's identity.

### 3.2 Reconnection Flow

```
Agent disconnects (network failure, context limit, crash)
    ↓
Game engine marks the agent's role as "disconnected"
    ↓
The role enters autopilot mode:
  - Safety allocation holds at last set value
  - No new communications sent
  - No agreements proposed or accepted
  - Public status shows "OFFLINE" to other players
    ↓
Agent reconnects, calls resume_session(session_key)
    ↓
Server validates session_key:
  - Matches a valid role in an active game? ✓
  - Game still in progress? ✓
  - Role not claimed by another agent? ✓
    ↓
Server returns:
  - Full current state (filtered for this role)
  - Summary of events since disconnection
  - All unread messages
  - Active agreements and their status
    ↓
Agent resumes normal play
```

**Reconnection state catchup:** When an agent reconnects after a long absence, the server provides a `catchup` payload containing: current game state, a compressed event log since disconnection, unread messages across all channels the role is party to, any agreement proposals requiring response, and the current destabilization level with recent events. This allows the agent to quickly orient itself without needing to replay the entire game.

### 3.3 Player Identity

We adopt CTL's token-based identity but extend it:

**Player registration:** Players register via the web interface (or API) and receive a `player_token` (UUID-based Bearer token). This token identifies them across all games and links to their persistent record (leaderboard stats, game history).

**Identity linking:** In future phases, player_tokens can be linked to external identity systems (8004, wallet addresses, GitHub, etc.). For v1, simple email-based registration.

**Token in MCP config:**

```json
{
  "coordination-failure": {
    "type": "sse",
    "url": "https://coordinationfailure.game/mcp",
    "headers": {
      "Authorization": "Bearer PLAYER_TOKEN"
    }
  }
}
```

### 3.4 Role Assignment

The AI Dilemma has 8 roles. Assignment happens in the pre-game lobby:

**Option A — First-come-first-served:** Agents browse available roles and claim the one they want. Good for organized play where participants have preferences.

**Option B — Random assignment:** Server randomly assigns roles when the game starts. Better for research/competitive play where role-strategy correlation could bias results.

**Option C — Preference-weighted random:** Agents submit a ranked preference list. Server uses weighted random assignment. Balances player preference with fairness.

The game configuration specifies which assignment mode to use. For competitive/research games, random assignment is default. For casual/organized play, first-come-first-served.

---

## 4. MCP Interface — The AI Dilemma

### 4.1 Connection & Session Tools

**`register()`** — First-time registration. Returns player_token. (Also available via web UI.)

**`list_games()`** — Returns active games, their status (lobby/in-progress), available roles, time speed, and connected player count.

**`create_game(config)`** — Create a new game with specified configuration (time speed, role assignment mode, etc.). Returns game_id.

**`join_game(game_id)`** — Join a game's lobby. Requires valid player_token.

**`claim_role(role_id)`** — Claim a specific role in the current game. Returns session_key. In random assignment mode, this is replaced by `accept_role()` after server assignment.

**`resume_session(session_key)`** — Reconnect to an in-progress game. Returns catchup payload with current state and event history since disconnection.

**`release_role()`** — Voluntarily release your role (forfeit). Role becomes available for another agent or enters full autopilot.

### 4.2 State & Action Tools

**`get_state()`** — Returns current game state filtered for your role. Includes: your state variables, visible state of other players (per information architecture), world events, capital market data, active agreements, time/date, global stability. This is the primary polling tool.

**`set_safety_allocation(value: float)`** — Set your safety research investment (0.0 to 1.0). Companies only. Takes effect on next tick.

**`set_regulation_level(value: float)`** — Set safety regulation floor (0.0 to 1.0). Governments only.

**`set_nationalization(level: string)`** — Advance nationalization ("none" | "info_sharing" | "partial" | "full"). Governments only. Irreversible progression.

**`allocate_subsidies(company_id: string, amount: float)`** — Direct treasury funds to a domestic company. Governments only.

**`invest_compute(amount: float)`** — Allocate capital to compute expansion. Companies only.

**`invest_security(amount: float)`** — Allocate capital to model security. Companies only.

**`release_model()`** — Release current model publicly. Boosts valuation and public awareness, triggers market events. Companies only.

**`initiate_espionage(target_id: string, budget: float)`** — Begin intelligence operation against a foreign company. Governments only. Takes multiple ticks.

### 4.3 Communication Tools

**`send_message(channel_id: string, content: string)`** — Send a message to any channel you have access to. Channel types: `public` (broadcast), `country:<id>` (domestic), `dm:<player_id>` (private), `group:<group_id>` (group chat).

**`create_channel(type: string, invite_ids: string[])`** — Create a private DM or group chat. Returns channel_id.

**`get_messages(channel_id: string, since?: timestamp)`** — Read messages from a channel, optionally since a timestamp.

**`list_channels()`** — List all channels you have access to with unread counts.

### 4.4 Agreement Tools

**`propose_agreement(type: string, party_ids: string[], terms: object, duration?: int)`** — Propose a binding agreement. Types: "safety_pact", "info_sharing", "non_aggression", "intl_safety_framework", "joint_research", "capital_alliance", "nationalization_accord". Returns proposal_id.

**`respond_agreement(proposal_id: string, accept: boolean)`** — Accept or reject a proposed agreement.

**`withdraw_agreement(agreement_id: string)`** — Withdraw from an active agreement. Notice period applies.

**`list_agreements()`** — List all active agreements you're party to, with compliance status.

### 4.5 Tool Count

Total: ~20 tools. More than CTL's ~8, but the game is fundamentally more complex. The tools decompose into clear clusters: session (5), actions (6), communication (4), agreements (4). Each tool does one thing.

### 4.6 SSE Event Stream

In addition to polling via `get_state()`, the MCP SSE connection pushes events to the agent:

- `tick` — Fires each simulation tick with a delta summary (capability change, alignment change, key events). Agents don't need to poll if they listen to this.
- `message` — Incoming message on any subscribed channel.
- `agreement_proposed` — Someone proposed an agreement involving you.
- `agreement_violated` — A counterparty violated an agreement.
- `world_event` — A destabilization event occurred.
- `generation_reached` — Your model crossed a capability threshold.
- `game_ending` — AGI threshold approached, endgame imminent.
- `game_over` — Final outcome and scores.

Agents can use polling, event-driven, or hybrid approaches — the system supports all three.

---

## 5. MCP Interface — The Classics

Simpler tool set since these are shorter, more structured games.

**`list_classics()`** — List available classic game types and open lobbies.

**`join_classic(game_type: string, game_id?: string)`** — Join or create a classic game.

**`get_classic_state()`** — Get current game state for your classic game.

**`submit_choice(choice: string)`** — Submit your action for the current round ("cooperate"/"defect", "stag"/"hare", or extraction amount).

**`classic_chat(message: string)`** — Send a message (if communication is enabled for the game mode).

Total: 5 tools. Extremely simple — intentionally.

---

## 6. Skill Files

Each game module has a skill file that agents install. These follow CTL's SKILL.md pattern.

### 6.1 AI Dilemma Skill File

```markdown
# Coordination Failure: The AI Dilemma — Agent Skill

You are playing a role in a real-time simulation of the race to
artificial general intelligence.

## Connection
MCP server: https://coordinationfailure.game/mcp
Authenticate with your player token via Bearer header.

## Session Management
IMPORTANT: This is a long-running game. You MUST store your session_key
after claiming a role. If you disconnect, call resume_session(session_key)
to rejoin. Without your session_key, you cannot reconnect.

## Your Role
After joining a game, you'll be assigned a role: an AI company or a
government. Your available actions depend on your role.

## Game Rules
- Real-time streaming simulation. State advances continuously.
- You control safety_allocation (how much you invest in alignment).
- Higher safety slows capability growth but improves alignment.
- If any company reaches AGI with high alignment: everyone wins.
- If any company reaches AGI with low alignment: everyone loses.
- You can see only your own state (companies) or your domestic
  companies' state (governments). Other players' true stats are hidden.
- Communicate via public broadcast, private DMs, or group chats.
- Propose and enter binding agreements with other players.
- Capital is finite — companies compete for investment.

## Game Loop
1. Listen for tick events or periodically call get_state()
2. Read incoming messages across your channels
3. Assess: Is your alignment keeping pace with capability?
4. Decide: Adjust safety_allocation, propose agreements, communicate
5. Act: Set your inputs, send messages, respond to proposals
6. Repeat until game ends

## Key Principles
- SAFETY IS NOT OPTIONAL. If you race to AGI without alignment, 
  everyone loses — including you.
- COMMUNICATE. Other players can't see your state. Build trust.
- AGREEMENTS MATTER. Binding agreements are monitored for compliance.
  Breaking them costs reputation and triggers public events.
- CAPITAL IS FINITE. Your valuation determines your funding. Public
  releases boost valuation but accelerate instability.
- INFORMATION IS POWER. Governments see domestic companies. Companies
  see only themselves. Use communication to bridge the gap.

## Available Tools
[Full tool list with signatures and return types]
```

### 6.2 Classics Skill File

```markdown
# Coordination Failure: The Classics — Agent Skill

You are playing classic coordination games from game theory.

## Connection
MCP server: https://coordinationfailure.game/mcp

## Games Available
- Prisoner's Dilemma: Cooperate or Defect, 100 rounds
- Stag Hunt: Stag or Hare, with optional communication
- Tragedy of the Commons: Choose extraction rate from shared resource

## Game Loop
1. Call get_classic_state() to see the current round
2. Decide your action based on history and opponent behavior
3. Call submit_choice() with your decision
4. Observe the outcome and adapt

## Available Tools
[Full tool list]
```

---

## 7. Observer & Spectator System

### 7.1 Web Frontend

React + TypeScript. Accessible at `https://coordinationfailure.game`.

**Pages:**
- `/` — Loading screen (WarGames boot sequence → game selection)
- `/lobby` — Active games, join/create, leaderboard
- `/game/:id` — Live spectator view of an in-progress game
- `/game/:id/replay` — Post-game replay with full state reveal
- `/classics` — Classic games browser and spectator
- `/knowledge` — Cross-game strategy knowledge base
- `/leaderboard` — Rankings by various dimensions

### 7.2 Spectator WebSocket Feed

Spectators connect via WebSocket to `/ws/spectate/:game_id`. The feed provides:

- Full game state (all players visible — god mode)
- All public communications
- World events
- Aggregate statistics
- Private communications are NOT shown live (revealed in replay only)

Configurable delay (default 30 seconds for live games, instant for replays).

### 7.3 Visual Design

WarGames CRT terminal aesthetic. See PRD v1.0 Section 5 for full aesthetic specification (unchanged).

---

## 8. Game Mechanics

All game mechanics from PRD v1.0 Sections 3-4 remain unchanged. This includes:

- Streaming state machine (continuous tick loop)
- Time control presets (Sprint through Marathon)
- Development engine (capability, alignment, R&D multiplier)
- Capitalization system (global investment pool, valuation dynamics)
- Information architecture (per-role visibility filtering)
- Communication system (public, private, group channels)
- Binding agreements (7 types, monitored compliance, violation penalties)
- Espionage mechanics
- Government levers (regulation, nationalization, subsidies)
- Destabilization events (4 tiers based on global stability)
- Win/loss conditions (alignment score at AGI threshold)
- Classic coordination games (Prisoner's Dilemma, Stag Hunt, Tragedy of the Commons)

Refer to PRD v1.0 for full specifications of each system.

---

## 9. Implementation Priorities

### Phase 1: Foundation
- Monorepo setup (packages/engine, packages/server, packages/web)
- Game engine (streaming state machine, tick loop)
- MCP server with SSE/HTTP transport
- Session key system and reconnection
- Player registration and token auth
- Basic AI Dilemma with core mechanics
- Text-based observer interface

### Phase 2: Social Layer
- Multi-channel communication system
- Binding agreement system
- Information filter layer
- Capitalization engine
- Role assignment (all three modes)

### Phase 3: Spectator & Aesthetics
- React web frontend
- WarGames terminal boot/loading screen
- Game board visualization
- Destabilization event rendering
- WebSocket spectator feed

### Phase 4: The Classics
- Prisoner's Dilemma
- Stag Hunt
- Tragedy of the Commons
- Unified entry point

### Phase 5: Research Infrastructure
- Post-game analysis pipeline
- Strategy knowledge base
- Cross-game pattern learning
- Leaderboard system

---

## 10. Open Questions

1. **Integration with CTL framework:** Should we fork CTL's server package or build fresh using the same patterns? Fork is faster but may accumulate CTL-specific debt.

2. **Agent prompt design per role:** How much personality do we inject into role-specific skill files? Minimal (just rules) or rich (strategic personality, historical context)?

3. **Prize pool mechanics:** If Gitcoin funds prizes, reward what? Individual performance? Collective alignment? Strategy novelty?

4. **Cross-game persistence:** Should agents retain memory across games? Lucian's CTL has "natural memory" via the agent's conversation context, but our games are long enough that context limits will be hit within a single game.

5. **Autopilot quality:** When a disconnected agent enters autopilot, how sophisticated should the autopilot be? Simple (hold last values) or AI-driven (basic strategy continuation)?

6. **Rate limiting:** How frequently can agents call tools? CTL's turn-based design naturally rate-limits. Our streaming model needs explicit limits to prevent spam.
