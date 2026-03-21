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

  // Helper to require game auth
  function requireGame(): { game_id: string; role_id: string } {
    if (!ctx.game_id || !ctx.role_id) throw new Error('Not in a game. Call claim_role first.');
    return { game_id: ctx.game_id, role_id: ctx.role_id };
  }

  // -- Public tools (no auth required) --

  server.tool(
    'register',
    'Register a new player. Returns player_id and player_token.',
    { handle: z.string().optional(), email: z.string().optional() },
    async (args) => {
      try {
        const player = playerStore.register(args.handle, args.email);
        // Update context so subsequent calls are authenticated
        ctx.player_id = player.id;
        return ok({ player_id: player.id, player_token: player.token });
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
    'Claim a role in a game. Returns a session_key. Subsequent tool calls will use this game/role context.',
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
      } catch (e: any) { return err(e.message); }
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
    'Get current game state filtered for your role.',
    {},
    async () => {
      try {
        const { game_id, role_id } = requireGame();
        const game = gameManager.getGame(game_id);
        if (!game) return err('Game not found');
        return ok(filterStateForRole(game, role_id));
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Game action tools --

  server.tool(
    'set_safety_allocation',
    'Set safety research investment (0-1).',
    { value: z.number().min(0).max(1) },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'set_safety_allocation', role_id, value: args.value });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'set_regulation_level',
    'Set safety regulation floor (0-1, gov only).',
    { value: z.number().min(0).max(1) },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'set_regulation_level', role_id, value: args.value });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'set_nationalization',
    'Advance nationalization level (gov only).',
    { level: z.enum(['none', 'info_sharing', 'partial', 'full']) },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'set_nationalization', role_id, level: args.level });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'allocate_subsidies',
    'Direct treasury funds to a company (gov only).',
    { company_id: z.string(), amount: z.number() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'allocate_subsidies', role_id, company_id: args.company_id, amount: args.amount });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'invest_compute',
    'Invest capital in compute (company only).',
    { amount: z.number() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'invest_compute', role_id, amount: args.amount });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'invest_security',
    'Invest capital in security (company only).',
    { amount: z.number() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'invest_security', role_id, amount: args.amount });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'release_model',
    'Release current model publicly (company only).',
    {},
    async () => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'release_model', role_id });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'initiate_espionage',
    'Begin intelligence operation (gov only).',
    { target_id: z.string(), budget: z.number() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, { type: 'initiate_espionage', role_id, target_id: args.target_id, budget: args.budget });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'propose_agreement',
    'Propose a binding agreement.',
    { type: z.string(), party_ids: z.array(z.string()), terms: z.record(z.unknown()).optional(), duration: z.number().optional() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, {
          type: 'propose_agreement',
          role_id,
          agreement_type: args.type,
          party_ids: args.party_ids,
          terms: args.terms ?? {},
          duration_ticks: args.duration,
        });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'respond_agreement',
    'Accept or reject a proposal.',
    { proposal_id: z.string(), accept: z.boolean() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, {
          type: 'respond_agreement',
          role_id,
          agreement_id: args.proposal_id,
          accept: args.accept,
        });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'withdraw_agreement',
    'Withdraw from an agreement.',
    { agreement_id: z.string() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        gameManager.bufferAction(game_id, {
          type: 'withdraw_agreement',
          role_id,
          agreement_id: args.agreement_id,
        });
        return ok({ buffered: true });
      } catch (e: any) { return err(e.message); }
    },
  );

  // -- Communication tools --

  server.tool(
    'send_message',
    'Send a message to a channel.',
    { channel_id: z.string(), content: z.string() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        return ok(channelManager.sendMessage(game_id, role_id, args.channel_id, args.content));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'get_messages',
    'Get messages from a channel.',
    { channel_id: z.string(), since: z.string().optional() },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
        return ok(channelManager.getMessages(game_id, args.channel_id, role_id, args.since));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'list_channels',
    'List your channels.',
    {},
    async () => {
      try {
        const { game_id, role_id } = requireGame();
        return ok(channelManager.listChannels(game_id, role_id));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'create_channel',
    'Create a DM or group channel.',
    { type: z.enum(['dm', 'group']), invite_ids: z.array(z.string()) },
    async (args) => {
      try {
        const { game_id, role_id } = requireGame();
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

  server.tool(
    'join_classic',
    'Join or create a classic game. Provide game_id to join an existing game, or game_type to create a new one.',
    { game_type: z.string().optional(), game_id: z.string().optional(), config: z.record(z.unknown()).optional() },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');

        if (args.game_id) {
          // Join existing game — game_type not required
          const game = classicsManager.joinClassicGame(args.game_id, ctx.player_id);
          return ok({ game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length });
        }

        // Create new game — game_type required
        if (!args.game_type) return err('Missing game_type (required when creating a new game)');
        const game = classicsManager.createClassicGame(args.game_type as any, args.config, ctx.player_id);
        return ok({ game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length });
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'get_classic_state',
    'Get current state for your classic game.',
    { game_id: z.string() },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');
        return ok(classicsManager.getClassicState(args.game_id, ctx.player_id));
      } catch (e: any) { return err(e.message); }
    },
  );

  server.tool(
    'submit_choice',
    'Submit your choice for current round.',
    { game_id: z.string(), choice: z.string() },
    async (args) => {
      try {
        if (!classicsManager) return err('Classics not enabled');
        if (ctx.player_id === 'anonymous') return err('Unauthorized.');
        return ok(classicsManager.submitChoice(args.game_id, ctx.player_id, args.choice));
      } catch (e: any) { return err(e.message); }
    },
  );
}
