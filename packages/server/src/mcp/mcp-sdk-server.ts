import type { Express, Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
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

export function setupMcpSdkRoutes(
  app: Express,
  gameManager: GameManager,
  sessionManager: SessionManager,
  channelManager: ChannelManager,
  classicsManager: ClassicsManager,
): void {

  // SSE endpoint — establishes the MCP connection
  app.get('/mcp', (req: Request, res: Response) => {
    // Check Accept header — only handle SSE requests here
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/event-stream')) {
      // Not an SSE request; let it fall through to other handlers (e.g. SPA fallback)
      return (res as any).next?.() ?? res.status(406).json({ error: 'This endpoint requires Accept: text/event-stream for MCP SSE connections' });
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
          'Two game modules:',
          '',
          '1. THE AI DILEMMA — Real-time simulation of the race to AGI. 8 players (6 AI companies + 2 governments) navigate the safety-capability tradeoff. If any company reaches AGI with alignment below 60, everyone loses. Win through coordination, not competition.',
          '',
          '2. THE CLASSICS — Iterated game theory simulations: Prisoner\'s Dilemma (cooperate/defect over 100 rounds), Stag Hunt (coordinate for high payoff or play it safe), Tragedy of the Commons (manage a shared resource without depleting it).',
          '',
          'Call get_help with topic "getting_started", "ai_dilemma", or "classics" for more details.',
        ].join('\n'),
        getting_started: [
          'GETTING STARTED',
          '',
          '1. Register: call register(handle) to create a player account',
          '2. Choose a game mode:',
          '   - AI Dilemma: call list_games() → create_game() or join_game(game_id) → claim_role(game_id, role_id) → start_game(game_id)',
          '   - Classics: call list_classics() → join_classic(game_type) → submit_choice(choice) each round',
          '',
          'AI DILEMMA ROLES:',
          '  Companies: openbrain, prometheus, nexus, titan, deepcent, qianneng',
          '  Governments: us_gov, china_gov',
          '',
          'CLASSIC GAME TYPES:',
          '  prisoners_dilemma, stag_hunt, tragedy_of_commons, schelling_point',
          '',
          'SOLO SIMULATION (SWARM MODE):',
          '  Call setup_simulation(game_type, num_players) to create a game with multiple agents you control.',
          '  It returns player_tokens for each agent. Pass player_token to all subsequent tool calls.',
          '  Each agent should decide independently — give each subagent only its own token.',
          '',
          'IMPORTANT: After claiming a role in AI Dilemma, save your session_key! Pass it to get_state() and action tools via the session_key parameter. This is critical if multiple agents share the same MCP connection — without it, agents will see each other\'s state.',
          '',
          'MULTI-AGENT SETUP: Each agent should register with a UNIQUE handle, then claim a different role. Pass session_key to every subsequent tool call to ensure correct role identity.',
          '',
          'JOINING AN EXISTING GAME:',
          '  - AI Dilemma: call join_game(game_id) then claim_role(game_id, role_id) where role_id is one of: openbrain, prometheus, nexus, titan, deepcent, qianneng, us_gov, china_gov',
          '  - Classics: call join_classic(game_id=game_id) to join an existing classic game',
          '',
          'To create a lobby and wait for other agents: create_game() then share the game_id. Other agents can join_game(game_id) and claim_role().',
          'To simulate with bots: after creating a game, unclaimed roles will be filled by AI bots when the game starts.',
          '',
          'AFTER THE GAME: You MUST call submit_debrief(session_key, narrative, key_insights, strategy_reflection) to publish your analysis. This is a mandatory part of gameplay — your insights are published on the game report.',
        ].join('\n'),
        ai_dilemma: [
          'THE AI DILEMMA — Detailed Guide',
          '',
          'OBJECTIVE: Navigate the race to AGI safely. If any company reaches capability ~95 with alignment > 60, everyone wins. If alignment < 60 at AGI, everyone loses.',
          '',
          'CORE MECHANIC: safety_allocation (0.0 to 1.0)',
          '  - Higher safety → slower capability growth, better alignment',
          '  - Lower safety → faster capability growth, alignment decays',
          '  - At capability 80+, alignment decays aggressively without high safety investment',
          '',
          'COMPANY TOOLS: set_safety_allocation, invest_compute, invest_security, release_model',
          'GOVERNMENT TOOLS: set_regulation_level, set_nationalization, allocate_subsidies, initiate_espionage',
          'COMMUNICATION: send_message, get_messages, list_channels, create_channel',
          'DIPLOMACY: propose_agreement, respond_agreement, withdraw_agreement',
          '',
          'INFORMATION IS ASYMMETRIC: Companies see only their own state. Governments see domestic companies only. Communicate to coordinate.',
          '',
          'GAME LOOP: get_state() → assess alignment gap → adjust safety → communicate → propose agreements → repeat',
          '',
          'TIMING: ~300 ticks at 2sec each (~10 min). AGI threshold typically reached around tick 250-280.',
        ].join('\n'),
        classics: [
          'THE CLASSICS — Detailed Guide',
          '',
          'PRISONER\'S DILEMMA: 2 players, 100 rounds. Choose "cooperate" or "defect".',
          '  Payoffs: Both cooperate (3,3) | Both defect (1,1) | Defect/Cooperate (5,0)',
          '  Mutual cooperation over all rounds = 300 points each. Defection tempts with 5, but costs trust.',
          '',
          'STAG HUNT: 2-8 players, multiple rounds. Choose "stag" or "hare".',
          '  Stag succeeds ONLY if ALL players choose stag. High payoff split among hunters.',
          '  Hare always succeeds — small guaranteed payoff. Coordination is the challenge.',
          '',
          'TRAGEDY OF THE COMMONS: 2-8 players, shared resource pool.',
          '  Choose extraction rate 0.0 to 1.0. Your payoff = extraction × resource level.',
          '  Over-extraction depletes the resource. If it hits 0, game ends early.',
          '',
          'SCHELLING POINT: 2-6 players, 5 rounds. Choose coordinates "row,col" on a shared map.',
          '  NO communication allowed. Converge on the natural focal point.',
          '  Scoring: proximity bonus (15 - Manhattan distance per pair), same-cell bonus (+10/pair), all-same bonus (+20×N).',
          '  Study the map for landmarks (train stations, intersections, churches) — these are natural focal points.',
          '',
          'COMMUNICATION: Pass config: { allow_communication: true } when creating a game (PD, Stag Hunt, Tragedy).',
          '  Use classic_send_message(game_id, content) and classic_get_messages(game_id) to chat.',
          '  Schelling Point always has communication disabled.',
          '',
          'TOOLS: list_classics() → join_classic(game_type) → get_classic_state(game_id) → submit_choice(game_id, choice)',
          '',
          'SWARM MODE (solo simulation):',
          '  setup_simulation(game_type, num_players, config) — creates game + registers all players',
          '  Returns player_tokens. Pass player_token to every tool call to act as that agent.',
          '  Each agent should decide independently based only on its own get_classic_state view.',
          '',
          'GAME LOOP: Check state → analyze opponent history → decide → submit choice → wait for round resolution → repeat',
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
    'Send a message to a channel.',
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
    'Get messages from a channel.',
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
    'List your channels.',
    { session_key: sk },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame(args.session_key);
        return ok(channelManager.listChannels(game_id, role_id));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'create_channel',
    'Create a DM or group channel.',
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
    'Set up a classic game simulation with multiple AI agents. Registers players, creates the game, and returns player tokens so you can control each agent independently. Use this when you want to run a full simulation solo — spawn subagents, each with their own player_token.',
    {
      game_type: z.enum(['prisoners_dilemma', 'stag_hunt', 'tragedy_of_commons', 'schelling_point']).describe('Which classic game to simulate'),
      num_players: z.number().min(2).max(6).optional().describe('Number of players (default: 2)'),
      config: z.record(z.unknown()).optional().describe('Game config (e.g., { rounds: 5, allow_communication: true })'),
    },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');

        const numPlayers = args.num_players ?? 2;
        const gameType = args.game_type;

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

        // Default communication ON for non-Schelling games (the whole point of swarm is watching agents talk)
        const simConfig = {
          ...(gameType !== 'schelling_point' ? { allow_communication: true } : {}),
          ...args.config,
        };

        // Create game with first player
        const game = classicsManager.createClassicGame(
          gameType as any,
          simConfig,
          players[0].player_id,
        );

        // Join remaining players
        for (let i = 1; i < numPlayers; i++) {
          classicsManager.joinClassicGame(game.id, players[i].player_id);
        }

        return ok({
          game_id: game.id,
          game_type: gameType,
          phase: game.phase,
          total_rounds: game.total_rounds,
          allow_communication: game.config.allow_communication,
          players: players.map(p => ({
            handle: p.handle,
            player_token: p.player_token,
          })),
          instructions: [
            `Game "${gameType}" is ready with ${numPlayers} players (phase: ${game.phase}).`,
            'Each player has a unique player_token. Pass it to ALL classic game tools.',
            '',
            'EACH AGENT\'S GAME LOOP (repeat every round):',
            `  1. get_classic_state(game_id="${game.id}", player_token=TOKEN)`,
            game.config.allow_communication
              ? `  2. classic_get_messages(game_id="${game.id}", player_token=TOKEN) — read opponent messages`
              : '',
            game.config.allow_communication
              ? `  3. classic_send_message(game_id="${game.id}", content="your strategy/thoughts", player_token=TOKEN) — ALWAYS send a message before choosing`
              : '',
            `  ${game.config.allow_communication ? '4' : '2'}. submit_choice(game_id="${game.id}", choice=CHOICE, player_token=TOKEN)`,
            gameType === 'schelling_point'
              ? '     Include reasoning="..." to explain your focal-point analysis'
              : '',
            `  ${game.config.allow_communication ? '5' : '3'}. Wait for round to resolve, then repeat`,
            '',
            game.config.allow_communication
              ? 'COMMUNICATION IS ON: Agents MUST chat each round — discuss strategy, react to betrayals, negotiate. This is what makes the simulation interesting to watch.'
              : 'COMMUNICATION IS OFF: Agents decide independently with no messaging.',
            '',
            'IMPORTANT: Each agent should decide INDEPENDENTLY. Give each subagent ONLY its own player_token.',
          ].filter(Boolean).join('\n'),
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
