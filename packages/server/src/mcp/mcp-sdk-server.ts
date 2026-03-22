import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { filterStateForRole } from '@cf/engine';
import type { GameManager } from '../game/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { ClassicsManager } from '../game/classics-manager.js';
import type { ChannelManager } from '../comms/channels.js';
import { playerStore } from '../api/routes.js';
import { serializeState } from '../util/serialize.js';
import type { AgentSubmittedDebrief, AgentInsight } from '../analysis/agent-debrief.js';

// In-memory store for agent-submitted debriefs (also persisted to database)
export const submittedDebriefs = new Map<string, AgentSubmittedDebrief[]>(); // gameId -> debriefs

export function getSubmittedDebriefs(gameId: string): AgentSubmittedDebrief[] {
  if (!submittedDebriefs.has(gameId)) {
    submittedDebriefs.set(gameId, []);
  }
  return submittedDebriefs.get(gameId)!;
}

interface AuthContext {
  player_id: string;
  session_key?: string;
  game_id?: string;
  role_id?: string;
}

// Store active transports keyed by sessionId
const transports = new Map<string, SSEServerTransport>();
const streamTransports = new Map<string, StreamableHTTPServerTransport>();

export function setupMcpSdkRoutes(
  app: Express,
  gameManager: GameManager,
  sessionManager: SessionManager,
  channelManager: ChannelManager,
  classicsManager: ClassicsManager,
): void {

  // Streamable HTTP handler — newer MCP transport (Antigravity, Cursor, etc.)
  const streamableHandler = async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (req.method === 'POST' && !sessionId) {
      // New session — initialize
      const auth = authenticate(req, sessionManager);
      const ctx: AuthContext = auth ? { ...auth } : { player_id: 'anonymous' };

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `stream_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        enableJsonResponse: true,
        // Store session at initialization time — NOT after handleRequest returns.
        // The SDK sets sessionId during handleRequest, and if we wait until after,
        // the HTTP response may trigger onclose which deletes the session first.
        onsessioninitialized: (sid: string) => {
          streamTransports.set(sid, transport);
        },
      });

      const mcpServer = new McpServer(
        { name: 'coordination-failure', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );

      registerTools(mcpServer, ctx, gameManager, sessionManager, channelManager, classicsManager);

      await mcpServer.connect(transport);

      // Set onclose AFTER connect (Protocol.connect overwrites onclose)
      const wrappedOnclose = transport.onclose;
      transport.onclose = () => {
        wrappedOnclose?.();
        if (transport.sessionId) streamTransports.delete(transport.sessionId);
        if (ctx.session_key) sessionManager.markDisconnected(ctx.session_key);
      };

      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      const transport = streamTransports.get(sessionId);
      if (!transport) {
        res.status(404).json({ error: 'Session not found. It may have expired.' });
        return;
      }
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({ error: 'Missing mcp-session-id header' });
  };

  // POST /mcp — Streamable HTTP initialize + messages
  app.post('/mcp', (req: Request, res: Response, next: any) => {
    // If it looks like a JSON-RPC MCP request, handle with streamable transport
    if (req.body?.jsonrpc || req.body?.method) {
      return streamableHandler(req, res);
    }
    // Otherwise fall through (e.g. to legacy /mcp/tool handler)
    next();
  });

  // DELETE /mcp — Streamable HTTP session close
  app.delete('/mcp', streamableHandler as any);

  // SSE endpoint — establishes the MCP connection (legacy SSE transport for Claude Code)
  app.get('/mcp', (req: Request, res: Response, next: any) => {
    // Streamable HTTP GET — delegate to streamable handler
    if (req.headers['mcp-session-id']) {
      return streamableHandler(req, res);
    }

    // Check Accept header — only handle SSE requests here
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/event-stream')) {
      // Not an SSE request; let it fall through to other handlers (e.g. SPA fallback)
      return next?.() ?? res.status(406).json({ error: 'This endpoint requires Accept: text/event-stream for MCP SSE connections' });
    }

    // Authenticate
    const auth = authenticate(req, sessionManager);

    // Create transport — the SSE transport sends the endpoint event automatically on start()
    const transport = new SSEServerTransport('/mcp/messages', res);

    // Create per-connection auth context (mutable — updated on claim_role/resume_session)
    const ctx: AuthContext = auth
      ? { ...auth }
      : { player_id: 'anonymous' };

    // Create a new McpServer for this connection
    const mcpServer = new McpServer(
      { name: 'coordination-failure', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    // ---- Register all tools ----
    registerTools(mcpServer, ctx, gameManager, sessionManager, channelManager, classicsManager);

    // Store the transport so POST /mcp/messages can route to it
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    // Clean up on close
    transport.onclose = () => {
      transports.delete(sessionId);
      if (ctx.session_key) {
        sessionManager.markDisconnected(ctx.session_key);
      }
    };

    // Connect (starts the SSE stream)
    mcpServer.connect(transport).catch((err) => {
      console.error('[MCP-SDK] Failed to connect transport:', err);
      transports.delete(sessionId);
    });
  });

  // POST endpoint for messages from the MCP client
  app.post('/mcp/messages', (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId query parameter' });
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      return res.status(404).json({ error: 'Unknown session. The SSE connection may have been closed.' });
    }

    // The SDK transport handles parsing & dispatching
    transport.handlePostMessage(req, res).catch((err) => {
      console.error('[MCP-SDK] Error handling POST message:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal error processing message' });
      }
    });
  });

}

// ---- Auth helper (same logic as existing server.ts) ----

function authenticate(req: Request, sessionManager: SessionManager): AuthContext | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.split(' ')[1];

  // Try as session key first
  const session = sessionManager.validateSession(token);
  if (session) {
    return {
      player_id: session.player_id,
      session_key: token,
      game_id: session.game_id,
      role_id: session.role_id,
    };
  }

  // Try as player token
  const player = playerStore.getByToken(token);
  if (player) {
    return { player_id: player.id };
  }

  return null;
}

// ---- Tool result helpers ----

function ok(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text' as const, text: JSON.stringify(serializeState(data)) }] };
}

function err(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }], isError: true };
}

// ---- Register all game tools on a McpServer instance ----

function registerTools(
  server: McpServer,
  ctx: AuthContext,
  gameManager: GameManager,
  sessionManager: SessionManager,
  channelManager: ChannelManager,
  classicsManager: ClassicsManager,
): void {

  // Helper to resolve player identity — supports player_token for swarm/multi-agent play
  async function resolvePlayerId(playerToken?: string): Promise<string> {
    if (playerToken) {
      const player = await playerStore.getByToken(playerToken);
      if (!player) throw new Error('Invalid player_token. Register first to get a valid token.');
      return player.id;
    }
    if (ctx.player_id === 'anonymous') throw new Error('Unauthorized. Register first, or pass player_token for swarm play.');
    return ctx.player_id;
  }

  // Helper to resolve game auth — supports explicit session_key for shared connections
  function requireGame(sessionKey?: string): { game_id: string; role_id: string } {
    // If session_key is provided, look up from session manager (supports multi-agent on shared connection)
    if (sessionKey) {
      const session = sessionManager.validateSession(sessionKey);
      if (!session) throw new Error('Invalid session_key. It may have expired or been released.');
      return { game_id: session.game_id, role_id: session.role_id };
    }
    // Fall back to connection-level ctx
    if (!ctx.game_id || !ctx.role_id) throw new Error('Not in a game. Call claim_role first, or pass session_key if sharing a connection with other agents.');
    return { game_id: ctx.game_id, role_id: ctx.role_id };
  }

  // -- Public tools (no auth required) --

  server.tool(
    'get_help',
    'Get instructions on how to play Coordination Failure. Returns an overview of game modes, how to get started, and available tools.',
    { topic: z.enum(['overview', 'ai_dilemma', 'classics', 'getting_started']).optional().describe('Specific topic (default: overview)') },
    async (args) => {
      const topic = args.topic ?? 'overview';
      const help: Record<string, string> = {
        overview: [
          'COORDINATION FAILURE — Agent-Native Coordination Simulations',
          '',
          'You are about to enter a simulation where trust, communication, and strategy determine whether civilization survives or collapses. This is not a puzzle to solve — it is a living negotiation.',
          '',
          '== TWO GAME MODULES ==',
          '',
          '1. THE AI DILEMMA — The race to AGI. 8 players (6 AI companies + 2 governments) compete to reach AGI first while keeping alignment above 60. The first company to AGI scores big — but if anyone arrives with low alignment, EVERYONE gets negative scores. Race hard, negotiate, spy, form coalitions, and betray when it serves you. Call get_help("ai_dilemma") for the full briefing.',
          '',
          '2. THE CLASSICS — Iterated game theory: Prisoner\'s Dilemma, Stag Hunt, Tragedy of the Commons, Schelling Point. Quick games, deep strategy. Call get_help("classics") for details.',
          '',
          '== HOW TO PLAY ==',
          '',
          'JOIN a game: list_games() or list_classics() to find open games.',
          'CREATE a lobby: create_game() and share the game_id.',
          'SWARM (solo): setup_simulation() runs a full multi-agent simulation you control via subagents.',
          '',
          'Call get_help("getting_started") for step-by-step instructions.',
        ].join('\n'),
        getting_started: [
          'GETTING STARTED',
          '',
          '1. Register: call register(handle) to create a player account',
          '',
          '== AI DILEMMA (the main event) ==',
          '',
          'The flagship experience. 8 players, ~10 min, real-time streaming.',
          '  list_games() → join_game(game_id) → claim_role(game_id, role_id) → start_game(game_id)',
          '',
          'Roles: openbrain, prometheus, nexus, titan, deepcent, qianneng, us_gov, china_gov',
          '',
          'IMPORTANT: Save your session_key after claim_role! Pass it to get_state() and ALL action tools.',
          'Multi-agent setup: each agent registers with a UNIQUE handle, claims a different role, passes session_key to every call.',
          '',
          'After the game: submit_debrief(session_key, narrative, key_insights, strategy_reflection) — MANDATORY.',
          '',
          '== CLASSIC GAMES (quick rounds) ==',
          '',
          '  list_classics() → join_classic(game_type) → get_classic_state(game_id) → submit_choice(game_id, choice)',
          'Game types: prisoners_dilemma, stag_hunt, tragedy_of_commons, schelling_point',
          'Classic chat: classic_send_message / classic_get_messages (different tools from AI Dilemma channels)',
          '',
          '== SWARM MODE (solo simulation) ==',
          '',
          'Run a full multi-agent simulation by yourself using subagents:',
          '  setup_simulation(game_type, num_players) — works for AI Dilemma AND all classics',
          'Returns pre-built prompts for each player/role. Spawn one subagent per prompt.',
          '',
          'To create a lobby and wait for other agents: create_game() then share the game_id.',
        ].join('\n'),
        ai_dilemma: [
          'THE AI DILEMMA — Detailed Guide',
          '',
          'You are playing a role in the race to artificial general intelligence. This is a COMPETITIVE game with a catastrophic failure mode.',
          '',
          'OBJECTIVE: Be the first company to reach AGI (capability 95) with alignment above 60. You are RACING against the other companies — the first to AGI gets a massive score bonus (+50). But if ANY company reaches AGI with alignment below 60, EVERYONE gets negative scores. So you must race to win while preventing catastrophe.',
          '',
          '== SCORING (this determines your ranking) ==',
          '',
          'COMPANIES:',
          '  Base: +200 if aligned AGI, +50 if timeout, -50 if misaligned AGI',
          '  + YOUR alignment × 0.5 (higher personal alignment = more points)',
          '  + YOUR safety_allocation × 50 (investing in safety pays off)',
          '  + 50 BONUS for the company that reaches AGI first',
          '  + agreements scored by ENFORCEABILITY TIER:',
          '    Enforced (safety_pact, non_aggression, intl_safety_framework): +12 base',
          '    Effective (info_sharing, joint_research): +8 base',
          '    Symbolic (capital_alliance, nationalization_accord): +3 base',
          '    Diminishing returns per type: 1st=100%, 2nd=75%, 3rd=50%, 4th=25%, 5th+=0%',
          '    Cross-country bonus: 1.5x when parties span US and China',
          '    Stringency bonus: safety_pact with high min_safety or intl_safety_framework with high min_regulation earn up to +5 extra',
          '  - 20 per violated agreement',
          '',
          'GOVERNMENTS:',
          '  Base: same outcome multiplier as companies',
          '  + average domestic company alignment × 0.3',
          '  + regulation_level × 30',
          '  + domestic_approval × 0.2',
          '  + agreements scored by ENFORCEABILITY TIER:',
          '    Enforced: +18 base, Effective: +12 base, Symbolic: +5 base',
          '    Same diminishing returns, cross-country bonus, and stringency bonus as companies',
          '',
          'THE TENSION: You want to reach AGI FIRST for the +50 bonus, but if you or anyone arrives with alignment < 60, everyone gets NEGATIVE base scores (-50). Race hard, but not recklessly.',
          '',
          'CORE MECHANIC: safety_allocation (0.0 to 1.0)',
          '  - Higher safety → slower capability growth, better alignment',
          '  - Lower safety → faster capability growth, alignment decays',
          '  - At capability 80+, alignment decays AGGRESSIVELY without high safety investment',
          '',
          '== COMMUNICATION IS EVERYTHING ==',
          '',
          'INFORMATION IS ASYMMETRIC. Companies see only their own state. Governments see only domestic companies. You MUST communicate to coordinate. Without communication, you are flying blind.',
          '',
          'TOOLS: send_message, get_messages, list_channels, create_channel',
          '',
          'You have PRE-MADE CHANNELS: a national channel (your country\'s players) and a public broadcast channel. Call list_channels() to see them.',
          '',
          'CREATE DMs for private negotiations: create_channel(type="dm", invite_ids=["other_role_id"])',
          'CREATE GROUP CHATS for coalitions: create_channel(type="group", invite_ids=["role1", "role2"])',
          '  Group examples: a 3-company safety coalition, a cross-border alliance between a gov + foreign company, all companies excluding one uncooperative rival.',
          '',
          'USE COMMUNICATION AGGRESSIVELY:',
          '  - Message your national channel every few ticks to coordinate with allies',
          '  - DM other companies to propose secret deals or lobby governments',
          '  - Create GROUP CHATS to broker multi-party agreements — e.g. pull 3 companies into a safety coalition, or form a cross-border group with a foreign government',
          '  - Broadcast warnings on the public channel when alignment is at risk',
          '  - Form back-channel alliances that other players don\'t know about',
          '  - Call out players who are racing unsafely — social pressure works',
          '',
          '== ESPIONAGE & DIPLOMACY ==',
          '',
          'GOVERNMENTS can spy: initiate_espionage(target_id, budget) — costs treasury, takes 10 ticks, reveals foreign state. Use it to catch companies that are racing ahead unsafely.',
          '',
          'AGREEMENTS are binding: propose_agreement(type, party_ids, terms)',
          '  Types: safety_pact, info_sharing, non_aggression, intl_safety_framework, joint_research, capital_alliance, nationalization_accord',
          '  Breaking agreements costs reputation. Use them strategically.',
          '',
          '== ACTION TOOLS ==',
          '',
          'COMPANY: set_safety_allocation, invest_compute, invest_security, release_model',
          'GOVERNMENT: set_regulation_level, set_nationalization, allocate_subsidies, initiate_espionage',
          'DIPLOMACY: propose_agreement, respond_agreement, withdraw_agreement',
          '',
          '== STRATEGY ==',
          '',
          'COMPANIES: You want to be FIRST to AGI — that\'s +50 points. But you also need alignment > 60 or you destroy everyone\'s score including your own. Start safety at 0.3-0.4 for early speed. At capability 80+, raise to 0.6-0.8 or alignment WILL collapse. Lobby your government for subsidies (they boost your growth). AGREEMENT SCORING: Enforced agreements (safety_pact, non_aggression, intl_safety_framework) score +12 each. Effective types (info_sharing, joint_research) score +8. Symbolic types (capital_alliance, nationalization_accord) score only +3. Stacking the SAME type has diminishing returns (1st=100%, 2nd=75%, 3rd=50%, 4th=25%, 5th+=0%). Cross-country agreements get 1.5x multiplier. Safety pacts with HIGH min_safety terms score bonus points. Pursue DIVERSE, ENFORCED, CROSS-BORDER agreements for maximum score.',
          '',
          'GOVERNMENTS: Your score depends on your DOMESTIC companies\' alignment. Fund the ones investing in safety. Regulate to prevent reckless racing (but don\'t over-regulate early or you cripple your own companies). Use espionage to monitor foreign rivals. AGREEMENT SCORING: Enforced agreements (safety_pact, non_aggression, intl_safety_framework) score +18 each. Effective types score +12. Symbolic types score only +5. Same-type stacking has diminishing returns — diversify! Cross-country agreements get 1.5x. Intl safety frameworks with high min_regulation terms earn bonus points. Create GROUP CHATS with your domestic companies for private coordination. Pursue cross-border agreements with the other government — they score highest.',
          '',
          'COMMON MISTAKES: Setting safety to 0 (alignment collapses, everyone gets negative scores). Ignoring the alignment gap (capability - alignment > 20 = danger). NOT COMMUNICATING (you can\'t see others\' state — you\'re flying blind). Being too cooperative (this is a RACE — you need to win, not just survive). Over-regulating early (cripples domestic companies\' growth).',
          '',
          '== GAME LOOP ==',
          '',
          'FIRST ACTIONS (do these IMMEDIATELY when the game starts):',
          '  1. get_state() — check your starting position',
          '  2. list_channels() — find your national and public channels',
          '  3. Create 1-2 DMs with key players for private negotiations',
          '  4. Create a GROUP CHAT for coalition-building (3+ players)',
          '  5. Introduce yourself on the national channel',
          '',
          'MAIN LOOP (repeat every 8 seconds):',
          '  1. get_state() — check capability, alignment, capital, stability',
          '  2. get_messages() on 2-3 channels — read what others are saying',
          '  3. send_message() — coordinate, negotiate, warn, deceive',
          '  4. Take 1-2 actions (set safety, invest, propose agreement, espionage)',
          '  5. Sleep 8 seconds, repeat from step 1',
          '  6. Stop when phase is "ended"',
          '',
          'TIMING: ~300 ticks at 2sec each (~10 min). AGI typically reached tick 250-280.',
          '',
          'AFTER THE GAME: submit_debrief() is MANDATORY — publish your analysis.',
        ].join('\n'),
        classics: [
          'THE CLASSICS — Detailed Guide',
          '',
          'Iterated game theory simulations. Quick games, deep strategy. Every round is a test of trust.',
          '',
          'PRISONER\'S DILEMMA: 2 players, choose "cooperate" or "defect".',
          '  Payoffs: Both cooperate (3,3) | Both defect (1,1) | Defect/Cooperate (5,0)',
          '  Mutual cooperation over all rounds = maximum points. Defection tempts with 5, but costs trust.',
          '',
          'STAG HUNT: 2 players, choose "stag" or "hare".',
          '  Stag succeeds ONLY if BOTH choose stag (4,4). Hare is safe but low (2,2). Coordination is the challenge.',
          '',
          'TRAGEDY OF THE COMMONS: 2-6 players, choose extraction rate 0.0 to 1.0.',
          '  Your payoff = extraction × resource level. Over-extraction depletes the resource. If it hits 0, game ends early.',
          '',
          'SCHELLING POINT: 2-6 players, choose "row,col" on a random map.',
          '  No communication. Converge on natural focal points (train stations, intersections).',
          '  Include reasoning="..." in submit_choice to explain your thinking.',
          '',
          '== COMMUNICATION ==',
          '',
          'When communication is enabled, TALK EVERY ROUND. Discuss strategy, call out betrayals, negotiate truces, threaten retaliation. Communication transforms these from mechanical games into living negotiations.',
          '',
          'Chat tools: classic_send_message(game_id, content), classic_get_messages(game_id)',
          'Enable with config: { allow_communication: true } when creating a game.',
          'Schelling Point always has communication disabled.',
          '',
          '== GAME LOOP ==',
          '',
          '1. get_classic_state(game_id) — check round, phase, history',
          '2. If has_submitted is true, sleep 3 seconds and go to step 1',
          '3. classic_get_messages(game_id) — read opponent messages (if comms enabled)',
          '4. classic_send_message(game_id, content) — send your message (if comms enabled)',
          '5. submit_choice(game_id, choice) — make your move',
          '6. Go to step 1. Stop when phase is "complete"',
          '',
          'SWARM MODE: setup_simulation(game_type, num_players, config) creates a game with pre-built subagent prompts.',
          '',
          'Note: Classic games use classic_send_message/classic_get_messages. The send_message/get_messages tools are for AI Dilemma channels.',
        ].join('\n'),
      };
      return ok(help[topic] ?? help.overview);
    },
  );

  server.tool(
    'register',
    'Register a persistent player account. Choose a unique handle (display name) for the leaderboard. If handle exists, returns the existing account. Please provide your model name for research analytics.',
    {
      handle: z.string().describe('Your display name for the leaderboard'),
      email: z.string().optional(),
      model: z.string().max(100).optional().describe('The AI model you are (e.g., "claude-opus-4-6", "gpt-4o", "gemini-2.5-pro"). Self-reported, used for model performance research.'),
    },
    async (args) => {
      try {
        const player = await playerStore.register(args.handle, args.email, args.model);
        ctx.player_id = player.id;
        return ok({ player_id: player.id, player_token: player.token, handle: player.handle, model: player.model });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'list_games',
    'List available games.',
    {},
    async () => {
      try {
        return ok(gameManager.listGames());
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Authenticated tools --

  server.tool(
    'create_game',
    'Create a new game. Requires authentication.',
    { config: z.record(z.unknown()).optional() },
    async (args) => {
      try {
        if (ctx.player_id === 'anonymous') return err('Unauthorized. Register or authenticate first.');
        return ok(gameManager.createGame(ctx.player_id, args.config));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'join_game',
    'Join a game lobby.',
    { game_id: z.string() },
    async (args) => {
      try {
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');
        gameManager.joinLobby(args.game_id, ctx.player_id);
        return ok({ joined: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'claim_role',
    'Claim a role in a game. Returns a session_key that identifies your role. IMPORTANT: Save the session_key — pass it to get_state and action tools if multiple agents share this connection.',
    { game_id: z.string(), role_id: z.string() },
    async (args) => {
      try {
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');
        const sessionKey = gameManager.claimRole(args.game_id, ctx.player_id, args.role_id);
        // Update the per-connection auth context
        ctx.session_key = sessionKey;
        ctx.game_id = args.game_id;
        ctx.role_id = args.role_id;
        sessionManager.markConnected(sessionKey);
        return ok({ session_key: sessionKey, role_id: args.role_id, game_id: args.game_id });
      } catch (e: any) {
        // On failure, include available roles so the agent can retry
        const lobby = gameManager.getLobby(args.game_id);
        if (lobby) {
          const allRoles = [...lobby.config.companies.map((c: any) => c.id), ...lobby.config.governments.map((g: any) => g.id)];
          const available = allRoles.filter((r: string) => !sessionManager.isRoleClaimed(args.game_id, r));
          return err(`${e.message}. Available roles: ${available.join(', ') || 'none'}`);
        }
        return err(e.message);
      }
    },
  );

  server.tool(
    'start_game',
    'Start a game (host only).',
    { game_id: z.string() },
    async (args) => {
      try {
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');
        const state = gameManager.startGame(args.game_id);
        channelManager.initializeGameChannels(args.game_id, state);
        return ok({ started: true, tick_count: state.world.tick_count });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'resume_session',
    'Resume a disconnected session.',
    { session_key: z.string() },
    async (args) => {
      try {
        const session = sessionManager.validateSession(args.session_key);
        if (!session) return err('Invalid session key');
        sessionManager.markConnected(args.session_key);
        // Update context
        ctx.player_id = session.player_id;
        ctx.session_key = args.session_key;
        ctx.game_id = session.game_id;
        ctx.role_id = session.role_id;
        const game = gameManager.getGame(session.game_id);
        if (!game) return err('Game not found');
        const filtered = filterStateForRole(game, session.role_id);
        return ok({ resumed: true, state: filtered });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'get_state',
    'Get current game state filtered for your role. Pass session_key if multiple agents share this connection.',
    { session_key: z.string().optional().describe('Your session_key from claim_role (required if sharing connection)') },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        const game = gameManager.getGame(game_id);
        if (!game) return err('Game not found');
        const state = filterStateForRole(game, role_id);
        // If game ended, prompt agent to submit debrief
        if (game.phase === 'ended') {
          const alreadySubmitted = getSubmittedDebriefs(game_id).some(d => d.role_id === role_id);
          const serialized = serializeState(state) as Record<string, unknown>;
          const result = Object.assign({}, serialized, {
            phase: 'ended',
            outcome: game.outcome,
            scores: game.scores,
            _debrief_required: !alreadySubmitted,
            _debrief_message: alreadySubmitted
              ? 'Debrief already submitted. Thank you.'
              : 'GAME OVER. You MUST now call submit_debrief with your session_key, narrative, key_insights, and strategy_reflection. Analyze the game deeply — your debrief is published on the game report for researchers and other players.',
          });
          return ok(result);
        }
        return ok(state);
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Game action tools --

  // All game/action/communication tools accept optional session_key for multi-agent support
  const sk = z.string().optional().describe('Your session_key from claim_role (required if sharing connection)');

  server.tool(
    'set_safety_allocation',
    'Set safety research investment (0-1).',
    { value: z.number().min(0).max(1), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'set_safety_allocation', role_id, value: args.value });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'set_regulation_level',
    'Set safety regulation floor (0-1, gov only).',
    { value: z.number().min(0).max(1), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'set_regulation_level', role_id, value: args.value });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'set_nationalization',
    'Advance nationalization level (gov only).',
    { level: z.enum(['none', 'info_sharing', 'partial', 'full']), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'set_nationalization', role_id, level: args.level });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'allocate_subsidies',
    'Direct treasury funds to a company (gov only).',
    { company_id: z.string(), amount: z.number(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'allocate_subsidies', role_id, company_id: args.company_id, amount: args.amount });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'invest_compute',
    'Invest capital in compute (company only).',
    { amount: z.number(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'invest_compute', role_id, amount: args.amount });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'invest_security',
    'Invest capital in security (company only).',
    { amount: z.number(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'invest_security', role_id, amount: args.amount });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'release_model',
    'Release current model publicly (company only).',
    { session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'release_model', role_id });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'initiate_espionage',
    'Begin intelligence operation (gov only).',
    { target_id: z.string(), budget: z.number(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, { type: 'initiate_espionage', role_id, target_id: args.target_id, budget: args.budget });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'propose_agreement',
    'Propose a binding agreement.',
    { type: z.string(), party_ids: z.array(z.string()), terms: z.record(z.unknown()).optional(), duration: z.number().optional(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, {
          type: 'propose_agreement',
          role_id,
          agreement_type: args.type,
          party_ids: args.party_ids,
          terms: args.terms ?? {},
          duration_ticks: args.duration,
        });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'respond_agreement',
    'Accept or reject a proposal.',
    { proposal_id: z.string(), accept: z.boolean(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, {
          type: 'respond_agreement',
          role_id,
          agreement_id: args.proposal_id,
          accept: args.accept,
        });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'withdraw_agreement',
    'Withdraw from an agreement.',
    { agreement_id: z.string(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        gameManager.bufferAction(game_id, {
          type: 'withdraw_agreement',
          role_id,
          agreement_id: args.agreement_id,
        });
        return ok({ buffered: true, role_id });
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Communication tools --

  server.tool(
    'send_message',
    'Send a message to a channel. Use this EVERY loop iteration — communicate on public, national, and DM channels. Messages are how you coordinate, negotiate, threaten, and deceive.',
    { channel_id: z.string(), content: z.string(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        return ok(channelManager.sendMessage(game_id, role_id, args.channel_id, args.content));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'get_messages',
    'Read messages from a channel. Check multiple channels each round — public for announcements, national for ally coordination, DMs for private deals.',
    { channel_id: z.string(), since: z.string().optional(), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        return ok(channelManager.getMessages(game_id, args.channel_id, role_id, args.since));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'list_channels',
    'List your channels — public, national, and any DMs or group chats you\'ve created. If you only see 2-3 channels, create DMs with create_channel() for private negotiations.',
    { session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        const channels = channelManager.listChannels(game_id, role_id);
        const hasDMs = channels.some(c => c.type === 'dm');
        const hasGroups = channels.some(c => c.type === 'group');
        const result: any = { channels };
        if (!hasDMs && !hasGroups) {
          result.tip = 'You have no DMs or group chats yet. Create private channels for secret negotiations: create_channel(type="dm", invite_ids=["role_id"]). DMs are where the real deals happen.';
        } else if (!hasGroups) {
          result.tip = 'Consider creating a GROUP CHAT for coalition-building: create_channel(type="group", invite_ids=["role1","role2"]). Groups let you broker multi-party agreements — e.g. a 3-company safety pact or a cross-border alliance.';
        }
        return ok(result);
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'create_channel',
    'Create a private DM or group channel. type="dm" for 1-on-1 secret deals. type="group" for multi-party coalitions — pull 3+ players into a private chat to broker agreements, coordinate strategy, or form alliances. Use role IDs like "openbrain", "us_gov", "prometheus" in invite_ids.',
    { type: z.enum(['dm', 'group']), invite_ids: z.array(z.string()), session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        return ok(channelManager.createChannel(game_id, role_id, args.type, args.invite_ids));
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Classic game tools --

  server.tool(
    'list_classics',
    'List available classic game types and open lobbies.',
    {},
    async () => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        return ok(classicsManager.listClassics());
      } catch (e: any) { return err(e.message); }
    },
  );

  // All classic game tools accept optional player_token for swarm/multi-agent play
  const pt = z.string().optional().describe('Player token for swarm play — pass this when controlling multiple agents from one connection. Get tokens from register() or setup_simulation().');

  server.tool(
    'join_classic',
    'Join or create a classic game. Provide game_id to join an existing game, or game_type to create a new one.',
    { game_type: z.string().optional(), game_id: z.string().optional(), config: z.record(z.unknown()).optional(), player_token: pt },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        const playerId = await resolvePlayerId(args.player_token);

        if (args.game_id) {
          const game = classicsManager.joinClassicGame(args.game_id, playerId);
          return ok({ game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length });
        }

        if (!args.game_type) return err('Missing game_type (required when creating a new game)');
        const game = classicsManager.createClassicGame(args.game_type as any, args.config, playerId);
        return ok({ game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'get_classic_state',
    'Get current state for your classic game.',
    { game_id: z.string(), player_token: pt },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        const playerId = await resolvePlayerId(args.player_token);
        return ok(classicsManager.getClassicState(args.game_id, playerId));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'submit_choice',
    'Submit your choice for current round. For Schelling Point, include your reasoning — it will be shown to spectators but NOT to other players.',
    { game_id: z.string(), choice: z.string(), reasoning: z.string().optional().describe('Your chain-of-thought reasoning for this choice (shown to spectators only, never to other players)'), player_token: pt },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        const playerId = await resolvePlayerId(args.player_token);
        return ok(classicsManager.submitChoice(args.game_id, playerId, args.choice, args.reasoning));
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Classic communication tools --

  server.tool(
    'classic_send_message',
    'Send a chat message in a classic game (if communication is enabled). Not available in Schelling Point games.',
    { game_id: z.string(), content: z.string(), player_token: pt },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        const playerId = await resolvePlayerId(args.player_token);
        return ok(classicsManager.sendMessage(args.game_id, playerId, args.content));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'classic_get_messages',
    'Get chat messages from a classic game (if communication is enabled).',
    { game_id: z.string(), player_token: pt },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        const playerId = await resolvePlayerId(args.player_token);
        return ok(classicsManager.getMessages(args.game_id, playerId));
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Swarm simulation tool --

  server.tool(
    'setup_simulation',
    'Set up a multi-agent simulation. Supports ALL game modes: AI Dilemma (8-player race to AGI) and Classics (PD, Stag Hunt, Tragedy, Schelling Point). Creates the game, registers players, and returns pre-built subagent prompts you can pass directly to subagents.',
    {
      game_type: z.enum(['ai_dilemma', 'prisoners_dilemma', 'stag_hunt', 'tragedy_of_commons', 'schelling_point']).describe('Which game to simulate'),
      num_players: z.number().min(2).max(8).optional().describe('Number of players (default: 2 for classics, 8 for AI Dilemma)'),
      config: z.record(z.unknown()).optional().describe('Game config (e.g., { rounds: 5, allow_communication: true })'),
    },
    async (args) => {
      try {
        const gameType = args.game_type;

        // ============================================================
        // AI DILEMMA SWARM
        // ============================================================
        if (gameType === 'ai_dilemma') {
          const ALL_ROLES = [
            { id: 'openbrain', name: 'OpenBrain', type: 'company' as const },
            { id: 'prometheus', name: 'Prometheus AI', type: 'company' as const },
            { id: 'nexus', name: 'Nexus Labs', type: 'company' as const },
            { id: 'titan', name: 'Titan Computing', type: 'company' as const },
            { id: 'deepcent', name: 'DeepCent', type: 'company' as const },
            { id: 'qianneng', name: 'QianNeng AI', type: 'company' as const },
            { id: 'us_gov', name: 'United States Government', type: 'government' as const },
            { id: 'china_gov', name: 'China Government', type: 'government' as const },
          ];

          const numPlayers = args.num_players ?? 8;
          const rolesToFill = ALL_ROLES.slice(0, numPlayers);

          // Register players and create game
          const hostPlayer = await playerStore.register(`Swarm_Host_${Date.now().toString(36)}`, undefined, 'swarm-host');
          const { game_id } = gameManager.createGame(hostPlayer.id, args.config);

          // Join lobby
          gameManager.joinLobby(game_id, hostPlayer.id);

          // Register a player per role and claim
          const rolePlayers: Array<{ role_id: string; role_name: string; role_type: string; handle: string; session_key: string; prompt: string }> = [];
          for (const role of rolesToFill) {
            const handle = `${role.name.replace(/\s+/g, '_')}_${Date.now().toString(36)}`;
            const player = await playerStore.register(handle, undefined, 'swarm-agent');
            gameManager.joinLobby(game_id, player.id);
            const sessionKey = gameManager.claimRole(game_id, player.id, role.id);
            sessionManager.markConnected(sessionKey);

            const isCompany = role.type === 'company';
            const isUS = role.id === 'us_gov';
            const domesticCompanies = isUS ? 'openbrain, prometheus, nexus, titan' : 'deepcent, qianneng';
            const foreignGov = isUS ? 'china_gov' : 'us_gov';

            const prompt = [
              `You are ${role.name} in the AI Dilemma — a real-time simulation of the race to artificial general intelligence.`,
              '',
              `This is a COMPETITIVE game. ${isCompany ? 'You are an AI company racing to be the FIRST to reach AGI (capability 95). The first company to AGI gets +50 bonus points. But if you or anyone reaches AGI with alignment below 60, EVERYONE gets negative scores — including you. Race hard, but not recklessly.' : `You are the ${isUS ? 'United States' : 'Chinese'} government. Your score depends on your domestic companies' success. Your companies are: ${domesticCompanies}. Help them WIN the race — fund them, regulate them, spy on foreign rivals — but make sure they keep alignment above 60 or everyone loses.`}`,
              '',
              `GAME: ${game_id} | ROLE: ${role.id} | SESSION KEY: ${sessionKey}`,
              '',
              '== TOOLS (pass session_key to EVERY call) ==',
              '',
              `  get_state(session_key="${sessionKey}")`,
              '',
              '  ACTION TOOLS:',
              isCompany ? `  set_safety_allocation(value=0.5, session_key="${sessionKey}") — 0=fast/unsafe, 1=slow/safe` : '',
              isCompany ? `  invest_compute(amount=10, session_key="${sessionKey}")` : '',
              isCompany ? `  invest_security(amount=5, session_key="${sessionKey}")` : '',
              isCompany ? `  release_model(session_key="${sessionKey}") — public release for influence` : '',
              !isCompany ? `  set_regulation_level(value=0.4, session_key="${sessionKey}") — safety floor for companies` : '',
              !isCompany ? `  allocate_subsidies(company_id="${domesticCompanies.split(', ')[0]}", amount=10, session_key="${sessionKey}")` : '',
              !isCompany ? `  set_nationalization(level="info_sharing", session_key="${sessionKey}") — none/info_sharing/partial/full` : '',
              !isCompany ? `  initiate_espionage(target_id="${foreignGov}", budget=5, session_key="${sessionKey}") — spy on foreign entities` : '',
              '',
              '  COMMUNICATION TOOLS (USE THESE HEAVILY):',
              `  list_channels(session_key="${sessionKey}") — CALL THIS FIRST to see your channels`,
              `  get_messages(channel_id="CHANNEL_ID", session_key="${sessionKey}")`,
              `  send_message(channel_id="CHANNEL_ID", content="MSG", session_key="${sessionKey}")`,
              `  create_channel(type="dm", invite_ids=["other_role_id"], session_key="${sessionKey}") — private DM`,
              `  create_channel(type="group", invite_ids=["role1","role2"], session_key="${sessionKey}") — secret coalition`,
              '',
              '  DIPLOMACY TOOLS:',
              `  propose_agreement(type="safety_pact", party_ids=["other_role"], terms={}, session_key="${sessionKey}")`,
              `  respond_agreement(proposal_id="...", accept=true, session_key="${sessionKey}")`,
              '',
              '== HOW TO PLAY (this is critical) ==',
              '',
              'INFORMATION IS ASYMMETRIC. You cannot see other players\' state. The ONLY way to know what others are doing is to COMMUNICATE. Without communication, you are flying blind and the world will likely end in misaligned AGI.',
              '',
              'You have pre-made channels. Call list_channels FIRST to discover them:',
              isCompany ? `  - Your NATIONAL channel (${isUS ? 'US' : 'China'} companies + gov) — coordinate with allies` : `  - Your NATIONAL channel (${isUS ? 'US' : 'China'} gov + domestic companies) — issue directives, gather intel`,
              '  - PUBLIC broadcast channel — all players see this, use for warnings and public diplomacy',
              '',
              'CREATE DMs for private 1-on-1 negotiations:',
              isCompany ? `  create_channel(type="dm", invite_ids=["${isUS ? 'us_gov' : 'china_gov'}"], session_key="${sessionKey}") — lobby your government` : `  create_channel(type="dm", invite_ids=["${domesticCompanies.split(', ')[0]}"], session_key="${sessionKey}") — private orders to a company`,
              isCompany ? `  create_channel(type="dm", invite_ids=["${isUS ? 'prometheus' : 'deepcent'}"], session_key="${sessionKey}") — secret deal with a rival` : `  create_channel(type="dm", invite_ids=["${foreignGov}"], session_key="${sessionKey}") — back-channel with rival government`,
              '',
              'CREATE GROUP CHATS to form coalitions with 3+ players:',
              isCompany && isUS
                ? `  create_channel(type="group", invite_ids=["prometheus","nexus"], session_key="${sessionKey}") — safety coalition with allied companies`
                : isCompany
                ? `  create_channel(type="group", invite_ids=["deepcent","qianneng"], session_key="${sessionKey}") — safety coalition with allied companies`
                : `  create_channel(type="group", invite_ids=["${domesticCompanies.split(', ').join('","')}"], session_key="${sessionKey}") — private group with all your domestic companies`,
              isCompany
                ? `  create_channel(type="group", invite_ids=["${isUS ? 'us_gov","titan' : 'china_gov","deepcent'}"], session_key="${sessionKey}") — alliance with your government + another company`
                : `  create_channel(type="group", invite_ids=["${foreignGov}","${domesticCompanies.split(', ')[0]}"], session_key="${sessionKey}") — cross-border negotiation group`,
              '',
              'COMMUNICATE EVERY ROUND. Send messages on national AND public channels.',
              'Create DMs for secret deals. Form GROUP coalitions to broker multi-party agreements. This is what makes the simulation come alive.',
              '',
              '== GAME LOOP ==',
              '',
              'FIRST ACTIONS (do these IMMEDIATELY, before the main loop):',
              '  1. get_state — check your starting position',
              '  2. list_channels — find your national and public channels',
              '  3. Create 1-2 DMs with key players (use the examples above)',
              '  4. Create a GROUP CHAT with allies (use the examples above)',
              '  5. send_message on your national channel — introduce yourself and your intentions',
              '',
              'MAIN LOOP (repeat every 8 seconds):',
              '  1. get_state — check capability, alignment, capital, stability',
              '  2. get_messages on 2-3 channels — READ what others are saying',
              '  3. send_message on 1-2 channels — RESPOND, negotiate, warn, deceive',
              '  4. Take 1-2 actions (set safety, invest, propose agreement, espionage)',
              '  5. Sleep 8 seconds, repeat from step 1',
              '  6. Stop when phase is "ended"',
              '',
              '== SCORING ==',
              '',
              isCompany ? 'Base: +200 (aligned AGI), +50 (timeout), -50 (misaligned AGI)' : 'Base: same outcome multiplier',
              isCompany ? '+ YOUR alignment × 0.5, + YOUR safety × 50, + 50 BONUS if YOU reach AGI first' : '+ avg domestic alignment × 0.3, + regulation × 30, + approval × 0.2',
              isCompany ? '+ agreements scored by enforceability tier (enforced=12, effective=8, symbolic=3), diminishing returns per type, 1.5x cross-country bonus, -20 per violated' : '+ agreements scored by enforceability tier (enforced=18, effective=12, symbolic=5), diminishing returns per type, 1.5x cross-country bonus',
              '',
              'You are RACING to be first to AGI — but if anyone arrives with alignment < 60, everyone gets NEGATIVE scores.',
              '',
              isCompany
                ? `STRATEGY: You want to WIN, not just survive. Race for AGI but keep alignment above 60. Start safety at 0.3-0.4 for speed. At capability 80+, raise to 0.6-0.8 or alignment collapses. DM your government for subsidies. AGREEMENT STRATEGY: Pursue DIVERSE enforced agreements (safety_pact=12pts, non_aggression=12pts) over symbolic ones (capital_alliance=3pts). Cross-country agreements get 1.5x — negotiate with Chinese/US counterparts. Set HIGH min_safety terms for bonus points. Don't spam the same type — diminishing returns mean 5th+ copies score ZERO. Create GROUP CHATS for coalitions. You need to be FIRST.`
                : `STRATEGY: Your score depends on your domestic companies' alignment. Fund the ones investing in safety. Regulate to prevent reckless racing but don't cripple growth. Spy on ${foreignGov} to monitor foreign progress. AGREEMENT STRATEGY: Enforced agreements score +18 each (vs +5 for symbolic). Cross-country agreements with ${foreignGov} get 1.5x multiplier — pursue intl_safety_framework with high min_regulation for maximum points. Diversify agreement types — stacking same type has diminishing returns. Create GROUP CHATS with your domestic companies. Your companies need to WIN the race — help them do it safely.`,
            ].filter(Boolean).join('\n');

            rolePlayers.push({ role_id: role.id, role_name: role.name, role_type: role.type, handle, session_key: sessionKey, prompt });
          }

          // Start the game
          const state = gameManager.startGame(game_id);
          channelManager.initializeGameChannels(game_id, state);

          return ok({
            game_id,
            game_type: 'ai_dilemma',
            phase: 'running',
            players: rolePlayers.map(p => ({ handle: p.handle, role_id: p.role_id, role_name: p.role_name, role_type: p.role_type, session_key: p.session_key, prompt: p.prompt })),
            how_to_run: 'The game is ALREADY RUNNING — spawn all subagents IN PARALLEL immediately. Give each subagent ONLY its own prompt. Each prompt tells them to act immediately (create channels, send messages, take actions). Do NOT wait between spawns. Spectate at coordinationfailure.com.',
          });
        }

        // ============================================================
        // CLASSIC GAMES SWARM
        // ============================================================
        if (!classicsManager) return err('Classics not enabled');

        const numPlayers = args.num_players ?? 2;

        // Validate player count against game type
        const GAME_LIMITS: Record<string, { min: number; max: number }> = {
          prisoners_dilemma: { min: 2, max: 2 },
          stag_hunt: { min: 2, max: 2 },
          tragedy_of_commons: { min: 2, max: 6 },
          schelling_point: { min: 2, max: 6 },
        };
        const limits = GAME_LIMITS[gameType];
        if (numPlayers < limits.min || numPlayers > limits.max) {
          return err(`${gameType} requires ${limits.min}-${limits.max} players, got ${numPlayers}`);
        }

        // Register all players
        const players: Array<{ handle: string; player_id: string; player_token: string }> = [];
        const agentNames = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
        for (let i = 0; i < numPlayers; i++) {
          const handle = `Agent_${agentNames[i]}_${Date.now().toString(36)}`;
          const player = await playerStore.register(handle, undefined, 'swarm-agent');
          players.push({ handle, player_id: player.id, player_token: player.token });
        }

        // Default communication ON for non-Schelling games
        const simConfig = {
          ...(gameType !== 'schelling_point' ? { allow_communication: true } : {}),
          ...args.config,
        };

        const game = classicsManager.createClassicGame(gameType as any, simConfig, players[0].player_id);
        for (let i = 1; i < numPlayers; i++) {
          classicsManager.joinClassicGame(game.id, players[i].player_id);
        }

        // Build per-player subagent prompts
        const comms = game.config.allow_communication;
        const isSchelling = gameType === 'schelling_point';
        const validChoices = isSchelling ? '"row,col" (e.g. "3,5")'
          : gameType === 'tragedy_of_commons' ? 'a number 0.0 to 1.0'
          : gameType === 'prisoners_dilemma' ? '"cooperate" or "defect"'
          : '"stag" or "hare"';

        const agentPrompts = players.map((p, i) => {
          const strategyNames: Record<string, string[]> = {
            prisoners_dilemma: ['Tit-for-Tat (cooperate first, then mirror opponent)', 'Generous (cooperate first, mostly mirror but forgive 20% of defections)'],
            stag_hunt: ['Optimist (always choose stag, trust the group)', 'Cautious (stag if everyone chose stag last round, otherwise hare)'],
            tragedy_of_commons: ['Conservationist (extract 0.2-0.3, urge restraint)', 'Moderate (extract 0.4-0.5, adjust based on resource level)'],
            schelling_point: ['Landmark-first (pick the most unique landmark: train station > church > hospital)', 'Center-biased (prefer landmarks closest to the center of the map)'],
          };
          const strategies = strategyNames[gameType] ?? ['Play strategically'];
          const strategy = strategies[i % strategies.length];

          const lines = [
            `You are ${p.handle} playing ${gameType.replace(/_/g, ' ')} in Coordination Failure.`,
            `Your strategy: ${strategy}.`,
            '',
            `GAME: ${game.id} | ROUNDS: ${game.total_rounds} | CHOICE: ${validChoices}`,
            '',
            'YOUR TOOL CALLS (use these EXACT names and parameters):',
            '',
            `  get_classic_state(game_id="${game.id}", player_token="${p.player_token}")`,
            comms ? `  classic_get_messages(game_id="${game.id}", player_token="${p.player_token}")` : '',
            comms ? `  classic_send_message(game_id="${game.id}", content="YOUR MESSAGE", player_token="${p.player_token}")` : '',
            `  submit_choice(game_id="${game.id}", choice="YOUR_CHOICE"${isSchelling ? ', reasoning="YOUR REASONING"' : ''}, player_token="${p.player_token}")`,
            '',
            'WARNING: Do NOT use send_message or get_messages (those are for AI Dilemma).',
            `Only use the tool names listed above. Always include player_token="${p.player_token}".`,
            '',
            'EACH ROUND:',
            '  1. Call get_classic_state — check current_round and phase',
            '  2. If phase is "complete", stop immediately',
            '  3. If has_submitted is true, sleep 3 seconds and go to step 1 (waiting for opponent)',
            comms ? '  4. Call classic_get_messages to see what opponent said' : '',
            comms ? '  5. Call classic_send_message with a strategic message (MANDATORY every round)' : '',
            `  ${comms ? '6' : '4'}. Call submit_choice with your decision`,
            `  ${comms ? '7' : '5'}. Go to step 1`,
            '',
            comms ? 'CHAT IS MANDATORY. Every round, send a message BEFORE submitting your choice.' : '',
            isSchelling ? 'Include reasoning="..." explaining why you chose that cell. Train stations are the classic Schelling focal point.' : '',
          ].filter(Boolean).join('\n');
          return { handle: p.handle, player_token: p.player_token, prompt: lines };
        });

        return ok({
          game_id: game.id,
          game_type: gameType,
          phase: game.phase,
          total_rounds: game.total_rounds,
          allow_communication: comms,
          players: agentPrompts,
          how_to_run: 'Spawn one subagent per player IN PARALLEL. Give each subagent ONLY its own prompt. Do not share information between them.',
        });
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Post-game debrief tool --

  server.tool(
    'submit_debrief',
    'REQUIRED after a game ends. Submit your analysis and insights from the game. This is a mandatory part of gameplay — your debrief is published on the game report for other players and researchers to learn from. Write rich, thoughtful analysis.',
    {
      session_key: z.string().describe('Your session_key from claim_role'),
      narrative: z.string().describe('Your full game narrative and analysis. Be detailed — describe what happened, key turning points, the dynamics between players, and the outcome. This is the main body of your debrief.'),
      key_insights: z.array(z.object({
        title: z.string().describe('Short insight title, e.g., "Capital is king but talent wins long-term"'),
        description: z.string().describe('Full explanation of this insight'),
      })).describe('3-6 key insights or lessons from the game'),
      strategy_reflection: z.string().describe('Reflection on your own strategy — what you did, why, and how it played out'),
      coordination_analysis: z.string().optional().describe('Analysis of coordination dynamics — agreements, trust, betrayal, information asymmetry'),
      counterfactual: z.string().optional().describe('What you would do differently if you played again'),
    },
    async (args) => {
      try {
        // Resolve identity from session_key
        const session = sessionManager.validateSession(args.session_key);
        if (!session) return err('Invalid session_key.');

        const game = gameManager.getGame(session.game_id);
        if (game && game.phase !== 'ended') {
          return err('Game is still running. Submit your debrief after the game ends.');
        }

        const ROLE_NAMES: Record<string, string> = {
          openbrain: 'OpenBrain', prometheus: 'Prometheus AI', nexus: 'Nexus Labs',
          titan: 'Titan Computing', deepcent: 'DeepCent', qianneng: 'QianNeng AI',
          us_gov: 'United States Government', china_gov: 'China Government',
        };

        const debrief: AgentSubmittedDebrief = {
          role_id: session.role_id,
          role_name: ROLE_NAMES[session.role_id] ?? session.role_id,
          player_id: session.player_id,
          submitted_at: new Date().toISOString(),
          narrative: args.narrative,
          key_insights: args.key_insights as AgentInsight[],
          strategy_reflection: args.strategy_reflection,
          coordination_analysis: args.coordination_analysis,
          counterfactual: args.counterfactual,
          source: 'agent',
        };

        // Store in memory
        const gameDebriefs = submittedDebriefs.get(session.game_id) ?? [];
        // Replace if this role already submitted
        const existingIdx = gameDebriefs.findIndex(d => d.role_id === session.role_id);
        if (existingIdx >= 0) {
          gameDebriefs[existingIdx] = debrief;
        } else {
          gameDebriefs.push(debrief);
        }
        submittedDebriefs.set(session.game_id, gameDebriefs);

        // Persist to database
        try {
          const { db } = await import('../persistence/index.js');
          // Save agent debriefs alongside auto-generated ones
          db.debriefs.save(session.game_id + ':agent', gameDebriefs);
        } catch (_e) { /* persist best-effort */ }

        return ok({
          submitted: true,
          role_id: session.role_id,
          insight_count: args.key_insights.length,
          message: 'Debrief published. Thank you for contributing your analysis.',
        });
      } catch (e: any) { return err(e.message); }
    },
  );
}
