# COORDINATION FAILURE
## Implementation Plan

**Version 1.0**
**Date: March 2026**

---

## How to Read This Document

Each phase has a clear entry condition (what must be true before starting) and exit condition (what must be true before the phase is "done"). Tasks within a phase are ordered by dependency — later tasks may depend on earlier ones. Sub-tasks are the atomic units of work.

Estimated effort is given in t-shirt sizes per sub-task: **S** (hours), **M** (1-2 days), **L** (3-5 days), **XL** (1-2 weeks). These assume a single developer familiar with the stack.

---

## Phase 0: Project Scaffolding

**Entry condition:** Nothing exists yet.
**Exit condition:** Monorepo builds, lints, and runs an empty Express server. Local dev infrastructure (Redis + Postgres) runs via Docker Compose. CI pipeline passes.
**Estimated duration:** 2-3 days.

### 0.1 Repository Setup

- **0.1.1** Initialize git repo, add `.gitignore` for Node/TypeScript — **S**
- **0.1.2** Create root `package.json` with npm workspaces configured for `packages/*` — **S**
- **0.1.3** Create `tsconfig.base.json` with shared TypeScript config (strict mode, ESM, path aliases) — **S**
- **0.1.4** Create `packages/engine/package.json` and `tsconfig.json` extending base — **S**
- **0.1.5** Create `packages/server/package.json` and `tsconfig.json` extending base — **S**
- **0.1.6** Create `packages/web/package.json` scaffolded with Vite + React + TypeScript — **S**
- **0.1.7** Write `CLAUDE.md` project context file for AI-assisted development — **M**

### 0.2 Infrastructure

- **0.2.1** Write `docker-compose.yml` with Redis 7 and Postgres 16 services — **S**
- **0.2.2** Install and configure Redis client (`ioredis`) in `packages/server` — **S**
- **0.2.3** Install and configure Postgres client (`pg` or `postgres.js`) in `packages/server` — **S**
- **0.2.4** Write initial Postgres migration: `players` table with id, token, handle, email, elo, timestamps — **M**
- **0.2.5** Write migration runner script (or integrate `node-pg-migrate`) — **M**

### 0.3 Server Skeleton

- **0.3.1** Create Express app in `packages/server/src/index.ts` with health check endpoint — **S**
- **0.3.2** Add `npm run dev` script with `tsx --watch` for hot reloading — **S**
- **0.3.3** Verify end-to-end: server starts, connects to Redis and Postgres, health check returns 200 — **S**

### 0.4 CI / Quality

- **0.4.1** Add ESLint config (shared across packages) — **S**
- **0.4.2** Add Vitest configuration for `packages/engine` — **S**
- **0.4.3** Write first placeholder test in engine package to verify test runner works — **S**

---

## Phase 1: Core Engine

**Entry condition:** Phase 0 complete. Monorepo builds, infrastructure runs.
**Exit condition:** The engine can run a complete AI Dilemma game in isolation — no network, no agents, just a function that takes a configuration and a sequence of scripted actions and produces a full game trace with a winner or draw. All engine tests pass.
**Estimated duration:** 2-3 weeks.

### 1.1 State Types & Configuration

- **1.1.1** Define `GameState` interface — all company, government, and world state variables from the PRD — **M**
- **1.1.2** Define `GameConfig` interface — time speed presets, starting positions per role, tuning parameters — **M**
- **1.1.3** Define `PlayerAction` union type — all possible player inputs (set_safety_allocation, send_message, propose_agreement, etc.) — **M**
- **1.1.4** Define `GameEvent` union type — all possible engine-generated events (generation_reached, agreement_violated, world_event, game_over, etc.) — **M**
- **1.1.5** Write `createInitialState(config: GameConfig): GameState` factory — sets up all 8 roles with starting positions per the PRD's asymmetric starting conditions — **M**
- **1.1.6** Write config presets for time speeds (Sprint, Standard, Extended, Marathon) — **S**
- **1.1.7** Write Zod schemas for all config and action types for runtime validation — **M**

### 1.2 Development Engine

- **1.2.1** Implement `computeCapabilityDelta()` — the core formula: base_rate × r_and_d_multiplier × compute_factor × talent_factor × capital_efficiency × (1 - safety_drag) × (1 - regulation_drag) × tick_duration — **L**
- **1.2.2** Implement the R&D multiplier curve — non-linear function of capability_level with the four tiers (1.0-1.3 at low capability up to 10-50x at 80+) — **M**
- **1.2.3** Implement `computeAlignmentDelta()` — safety_allocation improvement vs. capability growth decay, plus stochastic breakthroughs and incidents — **L**
- **1.2.4** Implement generation thresholds — detect when a company crosses 20/40/60/80/95 and emit generation_reached events — **M**
- **1.2.5** Write deterministic pseudo-random number generator (seeded PRNG) for reproducible stochastic events — **M**
- **1.2.6** Test: verify that zero safety allocation at high capability reliably produces alignment collapse — **M**
- **1.2.7** Test: verify that moderate safety allocation (~40-50%) produces aligned AGI at moderate speeds — **M**
- **1.2.8** Test: verify the R&D multiplier curve produces the intended acceleration profile — **M**

### 1.3 Capital System

- **1.3.1** Implement `computeInvestmentAttracted()` — company's share of the global investment pool based on relative public_valuation × market_sentiment — **M**
- **1.3.2** Implement `computeValuationDelta()` — milestone bonuses, revenue growth signals, release bonuses, incident penalties, competitor effects — **L**
- **1.3.3** Implement `computeCapitalDelta()` — investment_attracted + revenue + government_subsidies - burn_rate - compute_investment - security_investment - safety_cost — **M**
- **1.3.4** Implement capital scarcity mechanics — underfunded companies slow down, emergency funding triggers — **M**
- **1.3.5** Implement revenue model — revenue scales with capability level and market position — **S**
- **1.3.6** Test: verify that releasing a model publicly boosts valuation and attracts capital — **M**
- **1.3.7** Test: verify that capital starvation slows development proportionally — **S**

### 1.4 Government Mechanics

- **1.4.1** Implement safety regulation effect — applies mandatory minimum safety_allocation floor to all domestic companies, computes regulation_drag — **M**
- **1.4.2** Implement nationalization state machine (none → info_sharing → partial → full) with transition delays and effects per level — **L**
- **1.4.3** Implement government subsidies — direct capital transfer from treasury to specified domestic company — **S**
- **1.4.4** Implement intelligence budget effect — accuracy of foreign capability estimates scales with intelligence spend — **M**
- **1.4.5** Test: verify that regulation slows domestic development while improving alignment — **M**
- **1.4.6** Test: verify nationalization produces expected R&D concentration effects — **M**

### 1.5 Espionage

- **1.5.1** Implement espionage operation lifecycle — initiation, multi-tick execution, probability-based resolution — **L**
- **1.5.2** Implement success probability function — `f(intelligence_budget, target_security_level, time_invested)` — **M**
- **1.5.3** Implement weight theft effect — boosts target Chinese company's capability by configurable percentage of the gap — **M**
- **1.5.4** Implement detection mechanics and consequences — US security upgrade, diplomatic fallout event, approval effects — **M**
- **1.5.5** Implement counterintelligence — US government intelligence investment increases detection probability — **S**
- **1.5.6** Test: verify espionage resolves correctly across the probability range — **M**

### 1.6 Agreement System

- **1.6.1** Define agreement types schema — Safety Pact, Info Sharing, Non-Aggression, International Safety Framework, Joint Research, Capital Alliance, Nationalization Accord — **M**
- **1.6.2** Implement agreement proposal and acceptance lifecycle — proposal creation, pending state, multi-party acceptance — **M**
- **1.6.3** Implement compliance monitoring — each tick, check each active agreement against current state — **L**
- **1.6.4** Implement violation detection and consequences — reputation penalty, agreement dissolution, treaty breach event generation — **M**
- **1.6.5** Implement withdrawal with notice period — configurable notice ticks, early withdrawal = violation — **M**
- **1.6.6** Implement specific agreement effects — Joint Research R&D bonus, Info Sharing visibility grants, Capital Alliance emergency funding — **L**
- **1.6.7** Test: verify compliance checking catches violations accurately — **M**
- **1.6.8** Test: verify agreement effects apply correctly while active and cease on dissolution — **M**

### 1.7 World Events & Destabilization

- **1.7.1** Implement `computeGlobalStability()` — aggregate capability factor, alignment deficit factor, capital volatility, active conflicts — **M**
- **1.7.2** Implement event generation — per-tick probability rolls based on stability, tiered event pools (Tremors, Shocks, Crises, Catastrophes) — **L**
- **1.7.3** Write event templates — at least 5 events per tier (20+ total), each with stability impact, market sentiment impact, and narrative text — **L**
- **1.7.4** Implement event effects on game state — capital_market_sentiment, government domestic_approval, forced government responses — **M**
- **1.7.5** Test: verify event frequency scales correctly with stability degradation — **M**

### 1.8 Win/Loss Conditions

- **1.8.1** Implement AGI threshold detection — any company reaching capability ~95 triggers endgame — **S**
- **1.8.2** Implement outcome determination based on alignment score tiers (80+, 60-79, 40-59, <40) — **M**
- **1.8.3** Implement scoring — per-role score based on outcome, contribution to safety, agreements honored — **M**
- **1.8.4** Implement alternative endings — Mutual Slowdown (no AGI by game end), Nationalization Takeover — **M**
- **1.8.5** Test: end-to-end game simulation with scripted actions that produce each outcome type — **L**

### 1.9 Visibility Filter

- **1.9.1** Implement `filterStateForRole()` for company roles — own full state, public-only view of others, world state — **M**
- **1.9.2** Implement `filterStateForRole()` for government roles — domestic company full state, noisy foreign estimates, world state — **M**
- **1.9.3** Implement `addNoise()` function for foreign intelligence estimates — noise inversely proportional to intelligence_budget — **S**
- **1.9.4** Implement Info Sharing agreement visibility grants — signatories see each other's true state — **M**
- **1.9.5** Test: verify no information leaks — filtered state for each role contains only what the PRD specifies — **L**

### 1.10 Core Tick Function

- **1.10.1** Implement the master `tick()` function that orchestrates all sub-systems in the correct order: apply actions → development → capital → agreements → espionage → events → clock → conditions → notifications — **L**
- **1.10.2** Implement action application — parse PlayerAction union, route to correct handler, validate role permissions — **M**
- **1.10.3** Implement notification builder — after tick resolution, build per-role notification lists from events — **M**
- **1.10.4** Integration test: run a 100-tick game with scripted actions, verify state trajectory is deterministic (same seed = same result) — **L**
- **1.10.5** Integration test: run 1000 Sprint-speed games with random actions, verify no crashes, no NaN, no infinite values, no state corruption — **L**

---

## Phase 2: MCP Server & Session Management

**Entry condition:** Phase 1 complete. Engine runs deterministic games in isolation.
**Exit condition:** A single AI agent can connect via MCP, claim a role, submit actions, receive state updates, disconnect, reconnect with session key, and resume play. The test harness can run a complete multi-agent game.
**Estimated duration:** 2-3 weeks.

### 2.1 MCP Server Setup

- **2.1.1** Install MCP SDK (`@modelcontextprotocol/sdk`) — **S**
- **2.1.2** Implement SSE endpoint (`GET /mcp`) — creates MCP server instance per connection, handles SSE transport — **M**
- **2.1.3** Implement HTTP message endpoint (`POST /mcp/message`) — routes tool calls to MCP server — **M**
- **2.1.4** Verify basic MCP handshake works with a test client (can list tools, call a simple tool) — **M**

### 2.2 Authentication

- **2.2.1** Implement player registration — `POST /api/register` returns a player_token — **M**
- **2.2.2** Implement auth middleware — validates Bearer token as player_token or session_key, attaches identity to request — **M**
- **2.2.3** Implement token storage — player_tokens hashed and stored in Postgres — **S**
- **2.2.4** Test: verify unauthorized requests are rejected, valid tokens pass through — **S**

### 2.3 Session Key System

- **2.3.1** Implement `generateSessionKey()` — 256-bit `crypto.randomBytes`, base64url encoded — **S**
- **2.3.2** Implement session creation — on `claim_role()`, generate key, store in Redis with full session record, set role_lock — **M**
- **2.3.3** Implement session validation — on each tool call, verify session_key maps to active role in active game — **M**
- **2.3.4** Implement connection tracking — mark connected/disconnected on SSE connect/close events — **M**
- **2.3.5** Implement role release — `release_role()` clears session, removes role_lock, returns role to lobby — **M**
- **2.3.6** Test: verify one-agent-per-role enforcement — second claim attempt for held role is rejected — **S**
- **2.3.7** Test: verify session key survives server restart (Redis persistence) — **M**

### 2.4 Reconnection

- **2.4.1** Implement `resume_session()` tool — validate key, rebuild catchup payload — **L**
- **2.4.2** Implement catchup payload builder — current filtered state, events since disconnection, unread messages, agreement changes, state deltas — **L**
- **2.4.3** Implement autopilot — on disconnect, hold last action state, mark role OFFLINE in game state — **M**
- **2.4.4** Implement disconnect timeout — if disconnected > 50% of remaining game time, release role — **M**
- **2.4.5** Test: simulate disconnect/reconnect cycle, verify agent receives accurate catchup and can resume — **L**
- **2.4.6** Test: verify autopilot holds values correctly during disconnection — **M**

### 2.5 Game Lifecycle Manager

- **2.5.1** Implement `create_game()` tool — creates game in Redis with config, sets status to LOBBY — **M**
- **2.5.2** Implement `list_games()` tool — returns active games with status, available roles, player count — **M**
- **2.5.3** Implement `join_game()` tool — adds player to game lobby — **S**
- **2.5.4** Implement `claim_role()` tool — assigns role, generates session key, returns it — **M**
- **2.5.5** Implement lobby → game start transition — when all roles are filled (or minimum reached + timeout), initialize game state and start tick loop — **L**
- **2.5.6** Implement game end — stop tick loop, persist final state to Postgres, compute scores, update ELO — **L**

### 2.6 Tick Loop Runner

- **2.6.1** Implement `GameRunner` class — setInterval-based tick loop, action buffer drain, state persistence — **L**
- **2.6.2** Implement action buffering — incoming tool calls buffer actions, tick drains and applies them — **M**
- **2.6.3** Implement tick-to-agent push — after each tick, push filtered TickDelta to each connected agent via SSE — **L**
- **2.6.4** Implement time control — configurable tick interval, in-game time advancement per tick — **M**
- **2.6.5** Test: run a Sprint-speed game with 2 connected agents, verify tick events arrive correctly — **L**

### 2.7 Tool Handlers (AI Dilemma)

- **2.7.1** Implement state/action tools — `get_state`, `set_safety_allocation`, `set_regulation_level`, `set_nationalization`, `allocate_subsidies`, `invest_compute`, `invest_security`, `release_model`, `initiate_espionage` — **L**
- **2.7.2** Implement role-based tool access control — companies can't use government tools and vice versa — **M**
- **2.7.3** Implement rate limiting middleware — Redis sliding window counters per session_key per tool — **M**
- **2.7.4** Test: verify each tool correctly buffers actions and returns appropriate responses — **L**

### 2.8 Test Harness

- **2.8.1** Write `scripts/test-game.mjs` — spawns N Claude agents via Anthropic SDK with skill file as system prompt, connects each to local MCP server — **XL**
- **2.8.2** Write skill file `skills/ai-dilemma.md` — game rules, tool list, interaction loop guidance — **L**
- **2.8.3** Run first end-to-end multi-agent game — 4 agents (2 companies, 2 governments), Sprint speed — **L**
- **2.8.4** Debug and iterate on skill file based on agent behavior in test games — **L**

---

## Phase 3: Communication & Agreements

**Entry condition:** Phase 2 complete. Agents can connect, play, and disconnect/reconnect.
**Exit condition:** Agents can communicate via public, private, and group channels. Agents can propose, accept, and violate binding agreements. All communication is logged for analysis.
**Estimated duration:** 2 weeks.

### 3.1 Channel System

- **3.1.1** Implement channel data model in Redis — channel metadata, member lists, message sorted sets — **M**
- **3.1.2** Implement auto-created channels on game start — public broadcast, country:us, country:china — **M**
- **3.1.3** Implement `create_channel()` tool — DM (2 members) and group (2+ members) creation — **M**
- **3.1.4** Implement `send_message()` tool — validate membership, store message, push to connected members — **M**
- **3.1.5** Implement `get_messages()` tool — retrieve messages from channel, optionally since timestamp — **M**
- **3.1.6** Implement `list_channels()` tool — return all channels the role has access to with unread counts — **M**
- **3.1.7** Implement message push via SSE — connected agents receive `notifications/message` events in real-time — **M**
- **3.1.8** Implement mandatory public statement requirement — certain roles must send a public message every N ticks, with a nudge notification if overdue — **M**
- **3.1.9** Test: verify private messages are not visible to non-members — **M**
- **3.1.10** Test: verify messages queue correctly during disconnection and appear in catchup — **M**

### 3.2 Agreement System (Server Layer)

- **3.2.1** Implement `propose_agreement()` tool — creates agreement in pending state, notifies all proposed parties — **M**
- **3.2.2** Implement `respond_agreement()` tool — accept/reject, activate agreement when all parties accept — **M**
- **3.2.3** Implement `withdraw_agreement()` tool — initiate withdrawal with notice period, or immediate (counts as violation) — **M**
- **3.2.4** Implement `list_agreements()` tool — return active agreements with compliance status — **S**
- **3.2.5** Wire agreement compliance checking from engine into the tick loop — each tick, check all active agreements and emit violation events — **M**
- **3.2.6** Implement agreement-related SSE notifications — `agreement_proposed`, `agreement_activated`, `agreement_violated` — **M**
- **3.2.7** Test: full agreement lifecycle — propose, accept, comply, then violate, verify detection and consequences — **L**
- **3.2.8** Test: withdrawal with notice period vs. immediate withdrawal — **M**

### 3.3 Communication Logging

- **3.3.1** Implement game event logger — appends all messages, agreement events, and state changes to a per-game log — **M**
- **3.3.2** Ensure all communication is captured for post-game replay — messages tagged with game tick, sender role, channel — **M**
- **3.3.3** Implement log persistence — write completed game logs to Postgres (or file storage for large logs) — **M**

---

## Phase 4: Information Architecture & Capitalization

**Entry condition:** Phase 3 complete. Communication and agreements work.
**Exit condition:** The full information asymmetry model works — each role sees only what it should. Capital competition creates meaningful strategic dynamics. A full 8-player game produces interesting, differentiated outcomes.
**Estimated duration:** 1-2 weeks.

### 4.1 Information Filtering (Server Integration)

- **4.1.1** Wire the engine's `filterStateForRole()` into `get_state()` tool handler — **M**
- **4.1.2** Wire filtered state into tick push events — each agent receives only their filtered view — **M**
- **4.1.3** Implement Info Sharing agreement effect in visibility — signatories see each other's true capability/alignment — **M**
- **4.1.4** Implement government intelligence estimates — noisy foreign company stats in government `get_state()` — **M**
- **4.1.5** Audit: systematically verify that no tool or event leaks information beyond what the role should see — **L**

### 4.2 Capital System (Server Integration)

- **4.2.1** Wire capital computation from engine into tick loop — investment flows, valuation changes, burn rates — **M**
- **4.2.2** Implement `invest_compute()` and `invest_security()` tool handlers — validate capital availability, buffer as actions — **M**
- **4.2.3** Implement `release_model()` tool handler — triggers valuation boost, public awareness increase, market event — **M**
- **4.2.4** Implement government `allocate_subsidies()` tool handler — validate treasury, direct capital transfer — **M**
- **4.2.5** Test: run games where capital scarcity is a binding constraint — verify companies slow down when underfunded — **M**
- **4.2.6** Test: verify that releasing models publicly creates the intended capital/instability tradeoff — **M**

### 4.3 Full Game Validation

- **4.3.1** Run 8-agent full game (all roles filled) at Standard speed — observe and debug — **XL**
- **4.3.2** Tune development engine parameters — adjust safety_cost_coefficient, alignment_decay_rate, r_and_d_multiplier_curve to produce interesting games where diverse strategies are viable — **XL**
- **4.3.3** Tune capital parameters — adjust global_investment_pool, valuation sensitivity, burn rates to create meaningful scarcity without starving everyone — **L**
- **4.3.4** Tune event generation — adjust frequency and severity curves to create mounting pressure without overwhelming the game — **L**
- **4.3.5** Update skill file based on observed agent behavior — clarify rules, improve strategy guidance — **M**

---

## Phase 5: Spectator & Web Frontend

**Entry condition:** Phase 4 complete. Full games run with proper mechanics.
**Exit condition:** Observers can watch live games via web browser with the WarGames aesthetic. Game selection screen works. Basic lobby browser functional.
**Estimated duration:** 2-3 weeks.

### 5.1 WebSocket Spectator Feed

- **5.1.1** Implement WebSocket server on `/ws/spectate/:gameId` — **M**
- **5.1.2** Implement delayed feed buffer — configurable delay (default 30s), buffers tick results and flushes on schedule — **L**
- **5.1.3** Implement spectator state serialization — god-mode view of all state, public communications, events (private comms excluded) — **M**
- **5.1.4** Test: connect a WebSocket client, verify delayed state stream arrives correctly — **M**

### 5.2 Boot Screen & Navigation

- **5.2.1** Implement CRT boot sequence animation — phosphor green text, character-by-character rendering, modem sounds — **L**
- **5.2.2** Implement `COORDINATION FAILURE` title screen with WarGames quote — **M**
- **5.2.3** Implement "SHALL WE PLAY A GAME?" scroll selector — The Classics vs The AI Dilemma — **M**
- **5.2.4** Implement CRT shader effect component — scanlines, phosphor glow, curvature, glitch effects — **L**
- **5.2.5** Implement color palette system — stability-driven palette shifting (green → amber → red) — **M**

### 5.3 Game Board (AI Dilemma Spectator View)

- **5.3.1** Implement main game board layout — US/China split, company cards, global status bar — **L**
- **5.3.2** Implement company cards — capability bar, alignment bar, capital indicator, model generation, online/offline status — **L**
- **5.3.3** Implement government panels — regulation slider display, nationalization status, treasury, approval rating — **M**
- **5.3.4** Implement world events ticker — scrolling news feed with CRT styling, flash effects for new events — **L**
- **5.3.5** Implement public communications panel — latest public statements from all players — **M**
- **5.3.6** Implement capital markets display — global sentiment indicator, investment pool, individual valuations — **M**
- **5.3.7** Implement global stability meter with visual degradation — CRT glitch intensity scales with instability — **L**
- **5.3.8** Implement time/date display and speed indicator — **S**
- **5.3.9** Wire everything to WebSocket feed — real-time updates from spectator stream — **L**

### 5.4 Lobby Browser

- **5.4.1** Implement lobby page — list active games (status, roles filled, time speed), create game button — **M**
- **5.4.2** Implement game creation form — select time speed, role assignment mode, other config — **M**
- **5.4.3** Implement game detail view — show filled/available roles, connected agents, start conditions — **M**

### 5.5 Sound Design

- **5.5.1** Source or create audio assets — modem tones, keyboard clicks, CRT hum, alert beeps, klaxons — **M**
- **5.5.2** Implement sound manager — stability-driven audio intensity, mute toggle — **M**
- **5.5.3** Implement alert escalation — beeps at medium stability, urgent tones at low, klaxons at critical — **M**

---

## Phase 6: The Classics

**Entry condition:** Phase 5 complete. Web frontend functional.
**Exit condition:** All three classic games are playable by AI agents via MCP, with spectator views on the web frontend.
**Estimated duration:** 1-2 weeks.

### 6.1 Classic Game Engines

- **6.1.1** Implement Prisoner's Dilemma engine — iterated, configurable rounds, standard payoff matrix, tournament round-robin — **L**
- **6.1.2** Implement Stag Hunt engine — N-player, with optional communication rounds between decision rounds — **L**
- **6.1.3** Implement Tragedy of the Commons engine — shared resource with logistic regeneration, configurable governance options — **L**
- **6.1.4** Test: each classic engine produces correct payoffs and identifies Nash equilibria — **M** per game

### 6.2 Classic MCP Tools

- **6.2.1** Implement `list_classics()`, `join_classic()`, `get_classic_state()`, `submit_choice()`, `classic_chat()` — **L**
- **6.2.2** Write classics skill file `skills/classics.md` — **M**
- **6.2.3** Test: run a Prisoner's Dilemma tournament with 8 agents — **M**

### 6.3 Classic Spectator Views

- **6.3.1** Implement Prisoner's Dilemma visualization — choice history stream, cooperation/defection ratios, running scores — **L**
- **6.3.2** Implement Stag Hunt visualization — hunter icons, stag/hare choice reveal animation — **M**
- **6.3.3** Implement Tragedy of the Commons visualization — shared resource meter with color degradation — **M**
- **6.3.4** Integrate all classic views into the Classics module on the web frontend — **M**

---

## Phase 7: Post-Game Analysis & Research Infrastructure

**Entry condition:** Phase 6 complete. Both game modules are playable.
**Exit condition:** Completed games produce automated analysis reports. Knowledge base accumulates across games. Leaderboard tracks player/strategy performance.
**Estimated duration:** 2-3 weeks.

### 7.1 Game Logging

- **7.1.1** Implement comprehensive tick-by-tick event logger — captures full state deltas, all actions, all messages, all events — **M**
- **7.1.2** Implement log format — structured JSON lines, one entry per tick, suitable for streaming analysis — **M**
- **7.1.3** Implement log storage — write completed game logs to file storage (S3 or local), store path reference in Postgres — **M**

### 7.2 Post-Game Analysis Pipeline

- **7.2.1** Implement analysis trigger — on game end, queue analysis job — **S**
- **7.2.2** Implement strategy classifier — use LLM (Claude API) to analyze each player's action sequence and classify their strategy (aggressive, cooperative, deceptive, balanced, etc.) — **XL**
- **7.2.3** Implement causal pattern extractor — use LLM to identify key decision points and their consequences ("When OpenBrain released Agent-2 publicly, capital flowed from Nexus, leading to...") — **XL**
- **7.2.4** Implement post-game report generator — human-readable summary of what happened, why, and what strategies produced what outcomes — **L**
- **7.2.5** Store analysis results in Postgres — strategy classifications per player, key patterns, game narrative — **M**

### 7.3 Knowledge Base

- **7.3.1** Design knowledge base schema — pattern types (strategy, correlation, insight), descriptions, supporting evidence, confidence scores — **M**
- **7.3.2** Implement cross-game pattern extraction — after N games, use LLM to identify patterns that hold across multiple games — **XL**
- **7.3.3** Implement knowledge base API — query patterns by type, confidence, game parameters — **M**
- **7.3.4** Implement knowledge base web view — browsable, searchable, with links to supporting game replays — **L**

### 7.4 Leaderboard

- **7.4.1** Implement ELO calculation — standard ELO with K=32, adjusted for game outcome quality (aligned AGI win worth more than timeout draw) — **M**
- **7.4.2** Implement leaderboard materialized view refresh — triggered after each game — **S**
- **7.4.3** Implement leaderboard web page — rankings by ELO, win rate, average alignment score, strategy diversity — **L**
- **7.4.4** Implement per-player profile — game history, strategy distribution, best/worst games — **L**

### 7.5 Replay System

- **7.5.1** Implement replay viewer — load completed game log, step through ticks, full state visible — **L**
- **7.5.2** Implement replay speed control — pause, play, fast-forward, rewind, jump to tick — **L**
- **7.5.3** Implement private communication reveal — in replay mode, all private messages are visible (not in live spectator) — **M**
- **7.5.4** Implement replay sharing — shareable URL for specific game replays — **S**

---

## Phase 8: Polish, Tuning & Launch Prep

**Entry condition:** Phase 7 complete. All systems functional.
**Exit condition:** The product is ready for public beta. Games run reliably, the UI is polished, the skill files produce good agent behavior, and the analysis pipeline generates useful insights.
**Estimated duration:** 2-3 weeks.

### 8.1 Parameter Tuning

- **8.1.1** Run 100+ Sprint-speed AI-only games — collect data on outcome distribution, strategy viability, game length variance — **XL**
- **8.1.2** Identify and fix degenerate strategies — any strategy that dominates regardless of opponent behavior is a design flaw — **L**
- **8.1.3** Calibrate safety/speed tradeoff — target: ~30-50% safety should be viable without being suicidal, ~0% safety should reliably produce catastrophe at high capability — **L**
- **8.1.4** Calibrate capital scarcity — target: capital is meaningful constraint but doesn't starve all companies simultaneously — **M**
- **8.1.5** Calibrate event generation — target: events create mounting pressure, ~10 events per Standard game, catastrophes are rare but possible — **M**
- **8.1.6** Calibrate agreement violation penalty — target: breaking agreements is tempting but costly, not trivially cheap — **M**

### 8.2 Skill File Iteration

- **8.2.1** Observe 10+ games and identify common agent confusion points — rules misunderstandings, tool misuse, strategic blind spots — **L**
- **8.2.2** Rewrite skill files to address observed confusion — clearer rules, better examples, more strategic guidance — **L**
- **8.2.3** Test revised skill files with 10+ more games — verify improvement — **L**

### 8.3 UI Polish

- **8.3.1** Final CRT effect tuning — scanline density, glow intensity, glitch frequency curves — **M**
- **8.3.2** Responsive layout for mobile spectating — **L**
- **8.3.3** Accessibility pass — keyboard navigation, screen reader basics, high contrast mode — **L**
- **8.3.4** Error handling and loading states throughout the web app — **M**

### 8.4 Infrastructure Hardening

- **8.4.1** Add server health monitoring — tick loop health, Redis connection, Postgres connection, active game count — **M**
- **8.4.2** Add game state backup — periodic snapshots to Postgres in case of Redis failure — **M**
- **8.4.3** Add graceful shutdown — on server stop, persist all active game states, notify connected agents — **M**
- **8.4.4** Load testing — simulate 10 concurrent games with 80 connected agents, verify resource usage and latency — **L**
- **8.4.5** Set up deployment pipeline — Docker build, environment config, secrets management — **L**
- **8.4.6** Deploy to production infrastructure — server, Redis, Postgres, DNS, TLS — **L**

### 8.5 Documentation

- **8.5.1** Write README with project overview, quick start, and architecture summary — **M**
- **8.5.2** Write player onboarding guide — how to register, install MCP config, install skill file, join a game — **M**
- **8.5.3** Write API reference — all MCP tools with parameters, return types, and examples — **L**
- **8.5.4** Write game rules document (public-facing version of the PRD game mechanics) — **M**

---

## Dependency Graph Summary

```
Phase 0: Scaffolding
    │
    ▼
Phase 1: Core Engine (pure logic, no I/O)
    │
    ▼
Phase 2: MCP Server & Sessions (networking, agent connection)
    │
    ├─────────────────────────┐
    ▼                         ▼
Phase 3: Comms & Agreements   Phase 4: Info & Capital
    │                         │
    └────────┬────────────────┘
             ▼
Phase 5: Spectator & Web Frontend
             │
             ▼
Phase 6: The Classics (can run in parallel with Phase 5)
             │
             ▼
Phase 7: Analysis & Research Infrastructure
             │
             ▼
Phase 8: Polish, Tuning & Launch
```

Phases 5 and 6 can run in parallel if there are multiple developers. Phase 1 is the critical path — nothing else can start until the engine works.

---

## Estimated Total Timeline

| Phase | Duration | Cumulative |
|---|---|---|
| Phase 0: Scaffolding | 2-3 days | ~3 days |
| Phase 1: Core Engine | 2-3 weeks | ~3.5 weeks |
| Phase 2: MCP Server & Sessions | 2-3 weeks | ~6.5 weeks |
| Phase 3: Comms & Agreements | 2 weeks | ~8.5 weeks |
| Phase 4: Info & Capital | 1-2 weeks | ~10 weeks |
| Phase 5: Spectator & Web | 2-3 weeks | ~13 weeks |
| Phase 6: The Classics | 1-2 weeks | ~14.5 weeks |
| Phase 7: Analysis & Research | 2-3 weeks | ~17 weeks |
| Phase 8: Polish & Launch | 2-3 weeks | ~19.5 weeks |

**Total: approximately 4-5 months** for a single developer working full-time. With 2-3 developers working in parallel on later phases, this compresses to **3-4 months**.

**MVP milestone (playable game, no web UI):** End of Phase 4, ~10 weeks. At this point, AI agents can play full games via MCP with all mechanics. Validation happens via test harness output and logs.

**Demo milestone (watchable games):** End of Phase 5, ~13 weeks. Spectators can watch live games in the browser. This is the first publicly impressive artifact.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engine parameter tuning takes much longer than expected | High | Medium | Start tuning in Phase 1 with automated sweep scripts. Don't wait for Phase 8. |
| Agents consistently misunderstand the game via skill file | High | High | Plan for 3+ iterations of the skill file. Budget time for observation and rewriting. |
| MCP SDK has limitations we haven't anticipated | Medium | High | Prototype the SSE transport early in Phase 2. Identify blockers before building on it. |
| Reconnection is more complex than spec'd | Medium | Medium | Build and test reconnection in isolation before integrating with the full game loop. |
| Context window limits hit during long games | High | Medium | Design the tick push events to be self-contained summaries, not cumulative. Agent doesn't need full history — just current state + recent events. |
| Game balance is fundamentally broken | Medium | Critical | Run hundreds of automated games in Phase 8. Identify dominant strategies early. Accept that balance will require ongoing tuning post-launch. |
| Concurrent game scaling hits Redis performance limits | Low | Medium | Start with single-game-per-server. Monitor Redis memory and latency. Shard later if needed. |
