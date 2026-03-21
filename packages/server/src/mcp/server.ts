import type { Express, Request, Response } from 'express';
import { filterStateForRole } from '@cf/engine';
import type { GameManager } from '../game/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { ClassicsManager } from '../game/classics-manager.js';
import { playerStore } from '../api/routes.js';
import { ChannelManager } from '../comms/channels.js';
import { serializeState } from '../util/serialize.js';

// Communication manager (shared across connections)
export const channelManager = new ChannelManager();

interface AuthContext {
  player_id: string;
  session_key?: string;
  game_id?: string;
  role_id?: string;
}

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

export function setupMcpRoutes(app: Express, gameManager: GameManager, sessionManager: SessionManager, classicsManager?: ClassicsManager): void {
  // JSON-RPC style tool calling endpoint
  app.post('/mcp/tool', (req: Request, res: Response) => {
    const { tool, params } = req.body;
    if (!tool) {
      return res.status(400).json({ error: 'Missing tool name' });
    }

    // Allow register and list_games without auth (these are how you get started)
    const PUBLIC_TOOLS = ['register', 'list_games', 'list_classics'];
    const auth = authenticate(req, sessionManager);

    if (!auth && !PUBLIC_TOOLS.includes(tool)) {
      return res.status(401).json({ error: 'Unauthorized. Use POST /api/register to get a player_token, then pass it as Bearer token.' });
    }

    try {
      const result = handleToolCall(tool, params ?? {}, auth ?? { player_id: 'anonymous' }, gameManager, sessionManager, classicsManager);
      res.json({ result: serializeState(result) });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // SSE endpoint for real-time events
  app.get('/mcp/events', (req: Request, res: Response) => {
    const auth = authenticate(req, sessionManager);
    if (!auth) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', player_id: auth.player_id })}\n\n`);

    if (auth.session_key && auth.game_id) {
      sessionManager.markConnected(auth.session_key);

      // Register tick callback
      const tickCallback = (state: any, events: any[]) => {
        if (auth.role_id) {
          try {
            const filtered = filterStateForRole(state, auth.role_id);
            const roleEvents = events.filter(e =>
              e.type === 'world_event' || e.type === 'game_over' || e.type === 'game_ending'
            );
            res.write(`data: ${JSON.stringify({ type: 'tick', state: filtered, events: roleEvents })}\n\n`);
          } catch (_e) { /* connection may be closed */ }
        }
      };

      gameManager.onTick(auth.game_id, tickCallback);

      req.on('close', () => {
        if (auth.session_key) {
          sessionManager.markDisconnected(auth.session_key);
        }
        if (auth.game_id) {
          gameManager.removeTickCallback(auth.game_id, tickCallback);
        }
      });
    }
  });

  // Tool listing
  app.get('/mcp/tools', (_req: Request, res: Response) => {
    res.json({ tools: getToolList() });
  });
}

function handleToolCall(
  tool: string,
  params: Record<string, any>,
  auth: AuthContext,
  gameManager: GameManager,
  sessionManager: SessionManager,
  classicsManager?: ClassicsManager,
): any {
  switch (tool) {
    case 'register': {
      const player = playerStore.register(params.handle, params.email);
      return { player_id: player.id, player_token: player.token };
    }

    case 'list_games': {
      return gameManager.listGames();
    }

    case 'create_game': {
      return gameManager.createGame(auth.player_id, params.config);
    }

    case 'join_game': {
      gameManager.joinLobby(params.game_id, auth.player_id);
      return { joined: true };
    }

    case 'claim_role': {
      const sessionKey = gameManager.claimRole(params.game_id, auth.player_id, params.role_id);
      return { session_key: sessionKey, role_id: params.role_id, game_id: params.game_id };
    }

    case 'start_game': {
      const state = gameManager.startGame(params.game_id);
      // Initialize default channels
      channelManager.initializeGameChannels(params.game_id, state);
      return { started: true, tick_count: state.world.tick_count };
    }

    case 'resume_session': {
      const session = sessionManager.validateSession(params.session_key);
      if (!session) throw new Error('Invalid session key');
      sessionManager.markConnected(params.session_key);
      const game = gameManager.getGame(session.game_id);
      if (!game) throw new Error('Game not found');
      const filtered = filterStateForRole(game, session.role_id);
      return { resumed: true, state: filtered };
    }

    case 'get_state': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      const game = gameManager.getGame(auth.game_id);
      if (!game) throw new Error('Game not found');
      return filterStateForRole(game, auth.role_id);
    }

    case 'set_safety_allocation': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'set_safety_allocation',
        role_id: auth.role_id,
        value: params.value,
      });
      return { buffered: true };
    }

    case 'set_regulation_level': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'set_regulation_level',
        role_id: auth.role_id,
        value: params.value,
      });
      return { buffered: true };
    }

    case 'set_nationalization': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'set_nationalization',
        role_id: auth.role_id,
        level: params.level,
      });
      return { buffered: true };
    }

    case 'allocate_subsidies': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'allocate_subsidies',
        role_id: auth.role_id,
        company_id: params.company_id,
        amount: params.amount,
      });
      return { buffered: true };
    }

    case 'invest_compute': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'invest_compute',
        role_id: auth.role_id,
        amount: params.amount,
      });
      return { buffered: true };
    }

    case 'invest_security': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'invest_security',
        role_id: auth.role_id,
        amount: params.amount,
      });
      return { buffered: true };
    }

    case 'release_model': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'release_model',
        role_id: auth.role_id,
      });
      return { buffered: true };
    }

    case 'initiate_espionage': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'initiate_espionage',
        role_id: auth.role_id,
        target_id: params.target_id,
        budget: params.budget,
      });
      return { buffered: true };
    }

    case 'propose_agreement': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'propose_agreement',
        role_id: auth.role_id,
        agreement_type: params.type,
        party_ids: params.party_ids,
        terms: params.terms ?? {},
        duration_ticks: params.duration,
      });
      return { buffered: true };
    }

    case 'respond_agreement': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'respond_agreement',
        role_id: auth.role_id,
        agreement_id: params.proposal_id,
        accept: params.accept,
      });
      return { buffered: true };
    }

    case 'withdraw_agreement': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      gameManager.bufferAction(auth.game_id, {
        type: 'withdraw_agreement',
        role_id: auth.role_id,
        agreement_id: params.agreement_id,
      });
      return { buffered: true };
    }

    // Communication tools
    case 'send_message': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      return channelManager.sendMessage(auth.game_id, auth.role_id, params.channel_id, params.content);
    }

    case 'get_messages': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      return channelManager.getMessages(auth.game_id, params.channel_id, auth.role_id, params.since);
    }

    case 'list_channels': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      return channelManager.listChannels(auth.game_id, auth.role_id);
    }

    case 'create_channel': {
      if (!auth.game_id || !auth.role_id) throw new Error('Not in a game');
      return channelManager.createChannel(auth.game_id, auth.role_id, params.type, params.invite_ids);
    }

    // Classic game tools
    case 'list_classics': {
      if (!classicsManager) throw new Error('Classics not enabled');
      return classicsManager.listClassics();
    }

    case 'join_classic': {
      if (!classicsManager) throw new Error('Classics not enabled');

      if (params.game_id) {
        // Join existing game — game_type not required
        const game = classicsManager.joinClassicGame(params.game_id, auth.player_id);
        return { game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length };
      }

      // Create a new game — game_type required
      const gameType = params.game_type;
      if (!gameType) throw new Error('Missing game_type (required when creating a new game)');
      const game = classicsManager.createClassicGame(gameType, params.config, auth.player_id);
      return { game_id: game.id, type: game.type, phase: game.phase, players: game.player_ids.length };
    }

    case 'get_classic_state': {
      if (!classicsManager) throw new Error('Classics not enabled');
      const classicGameId = params.game_id;
      if (!classicGameId) throw new Error('Missing game_id');
      return classicsManager.getClassicState(classicGameId, auth.player_id);
    }

    case 'submit_choice': {
      if (!classicsManager) throw new Error('Classics not enabled');
      const choiceGameId = params.game_id;
      if (!choiceGameId) throw new Error('Missing game_id');
      if (!params.choice) throw new Error('Missing choice');
      return classicsManager.submitChoice(choiceGameId, auth.player_id, params.choice);
    }

    case 'classic_chat': {
      if (!classicsManager) throw new Error('Classics not enabled');
      const chatGameId = params.game_id;
      if (!chatGameId) throw new Error('Missing game_id');
      if (!params.content) throw new Error('Missing content');
      return classicsManager.sendMessage(chatGameId, auth.player_id, params.content);
    }

    default:
      throw new Error(`Unknown tool: ${tool}`);
  }
}

function getToolList() {
  return [
    { name: 'register', description: 'Register a new player', params: { handle: 'string?', email: 'string?' } },
    { name: 'list_games', description: 'List available games', params: {} },
    { name: 'create_game', description: 'Create a new game', params: { config: 'object?' } },
    { name: 'join_game', description: 'Join a game lobby', params: { game_id: 'string' } },
    { name: 'claim_role', description: 'Claim a role in a game', params: { game_id: 'string', role_id: 'string' } },
    { name: 'start_game', description: 'Start a game (host only)', params: { game_id: 'string' } },
    { name: 'resume_session', description: 'Resume a disconnected session', params: { session_key: 'string' } },
    { name: 'get_state', description: 'Get current game state (filtered for your role)', params: {} },
    { name: 'set_safety_allocation', description: 'Set safety research investment (0-1)', params: { value: 'number' } },
    { name: 'set_regulation_level', description: 'Set safety regulation floor (0-1, gov only)', params: { value: 'number' } },
    { name: 'set_nationalization', description: 'Advance nationalization level (gov only)', params: { level: 'string' } },
    { name: 'allocate_subsidies', description: 'Direct treasury funds to a company (gov only)', params: { company_id: 'string', amount: 'number' } },
    { name: 'invest_compute', description: 'Invest capital in compute (company only)', params: { amount: 'number' } },
    { name: 'invest_security', description: 'Invest capital in security (company only)', params: { amount: 'number' } },
    { name: 'release_model', description: 'Release current model publicly (company only)', params: {} },
    { name: 'initiate_espionage', description: 'Begin intelligence operation (gov only)', params: { target_id: 'string', budget: 'number' } },
    { name: 'propose_agreement', description: 'Propose a binding agreement', params: { type: 'string', party_ids: 'string[]', terms: 'object?', duration: 'number?' } },
    { name: 'respond_agreement', description: 'Accept or reject a proposal', params: { proposal_id: 'string', accept: 'boolean' } },
    { name: 'withdraw_agreement', description: 'Withdraw from an agreement', params: { agreement_id: 'string' } },
    { name: 'send_message', description: 'Send a message to a channel', params: { channel_id: 'string', content: 'string' } },
    { name: 'get_messages', description: 'Get messages from a channel', params: { channel_id: 'string', since: 'string?' } },
    { name: 'list_channels', description: 'List your channels', params: {} },
    { name: 'create_channel', description: 'Create a DM or group channel', params: { type: 'string', invite_ids: 'string[]' } },
    // Classic game tools
    { name: 'list_classics', description: 'List available classic game types and open lobbies', params: {} },
    { name: 'join_classic', description: 'Join or create a classic game. Provide game_id to join existing, or game_type to create new.', params: { game_type: 'string?', game_id: 'string?', config: 'object?' } },
    { name: 'get_classic_state', description: 'Get current state for your classic game', params: { game_id: 'string' } },
    { name: 'submit_choice', description: 'Submit your choice for current round', params: { game_id: 'string', choice: 'string' } },
    { name: 'classic_chat', description: 'Send a message in classic game (if communication enabled)', params: { game_id: 'string', content: 'string' } },
  ];
}
