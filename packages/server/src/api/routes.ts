import type { Express } from 'express';
import type { GameManager } from '../game/manager.js';
import type { SessionManager } from '../session/manager.js';
import type { ClassicsManager } from '../game/classics-manager.js';
import type { LeaderboardStore } from '../analysis/leaderboard.js';
import type { KnowledgeBase } from '../analysis/knowledge-base.js';
import type { PostGameReport } from '../analysis/report-generator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PlayerStore } from './players.js';

const __routes_filename = fileURLToPath(import.meta.url);
const __routes_dirname = path.dirname(__routes_filename);
const DATA_DIR = path.resolve(__routes_dirname, '../../../..', 'data');
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const DEBRIEFS_DIR = path.join(DATA_DIR, 'debriefs');

function loadReportFromDisk(gameId: string): PostGameReport | undefined {
  try {
    const filePath = path.join(REPORTS_DIR, `${gameId}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[CF] Failed to load report for ${gameId} from disk:`, e);
  }
  return undefined;
}

function loadDebriefsFromDisk(gameId: string): any[] | undefined {
  try {
    const filePath = path.join(DEBRIEFS_DIR, `${gameId}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (e) {
    console.error(`[CF] Failed to load debriefs for ${gameId} from disk:`, e);
  }
  return undefined;
}
import { CompletedGameStore } from './completed-games.js';
import { serializeState } from '../util/serialize.js';
import { channelManager } from '../mcp/server.js';
import { runSmartBot } from '../game/bot-ai.js';
import { classifyStrategy } from '../analysis/strategy-classifier.js';
import { generatePostGameReport } from '../analysis/report-generator.js';
import { generateAgentDebriefs } from '../analysis/agent-debrief.js';
import type { AgentDebrief } from '../analysis/agent-debrief.js';

export const playerStore = new PlayerStore();
export const completedGameStore = new CompletedGameStore();

const ALL_ROLES = ['openbrain', 'prometheus', 'nexus', 'titan', 'deepcent', 'qianneng', 'us_gov', 'china_gov'];

// In-memory store for post-game reports
const reports = new Map<string, PostGameReport>();

export function setupApiRoutes(app: Express, gameManager: GameManager, sessionManager: SessionManager, classicsManager?: ClassicsManager, leaderboardStore?: LeaderboardStore, knowledgeBase?: KnowledgeBase): void {
  // Player registration
  app.post('/api/register', async (req, res) => {
    const { handle, email, model } = req.body ?? {};
    const player = await playerStore.register(handle, email, model);
    res.json({ player_id: player.id, player_token: player.token, handle: player.handle, model: player.model });
  });

  // List games
  app.get('/api/games', (_req, res) => {
    res.json(gameManager.listGames());
  });

  // List completed games (persisted metadata that survives cleanup)
  app.get('/api/completed-games', async (_req, res) => {
    try {
      const { db } = await import('../persistence/index.js');
      res.json(await db.completedGames.list());
    } catch (_e) {
      res.json(completedGameStore?.list() ?? []);
    }
  });

  // Get game state (spectator - full state)
  app.get('/api/games/:gameId', (req, res) => {
    const game = gameManager.getGame(req.params.gameId);
    if (game) {
      return res.json(serializeState(game));
    }

    const lobby = gameManager.getLobby(req.params.gameId);
    if (lobby) {
      const allRoles = [...lobby.config.companies.map(c => c.id), ...lobby.config.governments.map(g => g.id)];
      const claimedRoles = Array.from(lobby.players.keys()); // roles are the keys
      return res.json({
        phase: 'lobby',
        game_id: lobby.game_id,
        time_speed: lobby.config.time_speed,
        players: lobby.players.size,
        max_players: lobby.config.max_players,
        claimed_roles: claimedRoles,
        available_roles: allRoles.filter(r => !claimedRoles.includes(r)),
      });
    }

    return res.status(404).json({ error: 'Game not found' });
  });

  // Get public broadcast messages for spectator view
  app.get('/api/games/:gameId/messages', (req, res) => {
    const gameId = req.params.gameId;
    const game = gameManager.getGame(gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }
    const messages = channelManager.getPublicMessages(gameId);
    res.json(messages);
  });

  // Get all messages for replay (includes private DMs)
  app.get('/api/games/:gameId/messages/all', (req, res) => {
    const gameId = req.params.gameId;
    const allMessages = channelManager.getAllMessages(gameId);
    res.json(allMessages);
  });

  // Start game with server-controlled bots filling unclaimed roles
  app.post('/api/games/:gameId/start-with-bots', async (req, res) => {
    try {
      const gameId = req.params.gameId;
      const lobby = gameManager.getLobby(gameId);
      if (!lobby) {
        const existing = gameManager.getGame(gameId);
        if (existing) {
          return res.json({ started: true, game_id: gameId, message: 'Game already running' });
        }
        return res.status(404).json({ error: 'Game not found' });
      }

      const botCount = parseInt(req.body?.bot_count ?? '0', 10);
      const fillAll = req.body?.fill_all !== false;

      // Determine which roles need bots
      const allRoles = [...lobby.config.companies.map(c => c.id), ...lobby.config.governments.map(g => g.id)];
      const claimedRoles = new Set(lobby.players.keys()); // roles are the keys
      const unclaimedRoles = allRoles.filter(r => !claimedRoles.has(r));

      const rolesToFill = fillAll
        ? unclaimedRoles
        : unclaimedRoles.slice(0, Math.max(botCount, lobby.config.min_players - lobby.players.size));

      // Register and assign bot players
      const botSessions: Array<{ roleId: string; sessionKey: string }> = [];
      for (const roleId of rolesToFill) {
        const bot = await playerStore.register(`bot_${roleId}`);
        const sessionKey = gameManager.claimRole(gameId, bot.id, roleId);
        botSessions.push({ roleId, sessionKey });
      }

      // Start the game
      const state = gameManager.startGame(gameId);
      channelManager.initializeGameChannels(gameId, state);

      // Start smart bot loops for each bot
      for (const bot of botSessions) {
        runSmartBot(bot.roleId, gameId, gameManager, channelManager);
      }

      // Register a tick callback to record results when game ends
      if (leaderboardStore) {
        const onGameEnd = async (endState: import('@cf/engine').GameState, events: import('@cf/engine').GameEvent[]) => {
          const gameOverEvent = events.find(e => e.type === 'game_over');
          if (gameOverEvent && gameOverEvent.type === 'game_over') {
            const sessions = sessionManager.getSessionsForGame(gameId);
            for (const session of sessions) {
              const player = playerStore.getById(session.player_id);
              const handle = player?.handle ?? session.player_id;
              const score = gameOverEvent.scores[session.role_id] ?? 0;
              leaderboardStore.recordGameResult(
                session.player_id,
                handle,
                session.role_id,
                score,
                gameOverEvent.outcome,
                gameId,
              );
            }

            // Run the post-game analysis pipeline
            try {
              const log = gameManager.getGameLog(gameId);
              const summary = gameManager.getGameLogSummary(gameId);
              if (log && summary) {
                // Classify strategies for all roles
                const allGameRoles = [...Object.keys(endState.companies), ...Object.keys(endState.governments)];
                const strategies: Record<string, import('../analysis/strategy-classifier.js').StrategyClassification> = {};
                for (const roleId of allGameRoles) {
                  strategies[roleId] = classifyStrategy(roleId, log);
                }

                // Gather messages for communication analysis
                const allMessages = channelManager.getAllMessages(gameId).map(m => ({
                  from: m.from,
                  content: m.content,
                  channel_type: m.channel_type,
                  timestamp: m.timestamp,
                }));
                // Generate the report
                const report = generatePostGameReport(gameId, log, summary, strategies, allMessages);
                reports.set(gameId, report);

                // Generate agent debriefs
                const debriefs = generateAgentDebriefs(gameId, log, report);
                try {
                  const idx = await import('../index.js');
                  (idx as any).gameDebriefs?.set(gameId, debriefs);
                } catch (_e) { /* ignore - debriefs stored in centralized map */ }

                // Extract knowledge patterns
                if (knowledgeBase) {
                  knowledgeBase.extractPatternsFromGame(report, gameId);
                }

                console.log(`[CF] Post-game report generated for game ${gameId} with ${debriefs.length} debriefs`);
              }
            } catch (err) {
              console.error(`[CF] Failed to generate post-game report for ${gameId}:`, err);
            }

            // Remove this callback after recording
            gameManager.removeTickCallback(gameId, onGameEnd);
          }
        };
        gameManager.onTick(gameId, onGameEnd);
      }

      res.json({
        started: true,
        game_id: gameId,
        bots: botSessions.map(b => b.roleId),
        total_players: sessionManager.getSessionsForGame(gameId).length,
      });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // -------------------------------------------------------------------------
  // Game event log & summary routes
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/log', (req, res) => {
    const log = gameManager.getGameLog(req.params.gameId);
    if (!log) {
      return res.status(404).json({ error: 'Game log not found' });
    }
    res.json(log);
  });

  // Covert operations feed — espionage events extracted from game log
  app.get('/api/games/:gameId/covert', (req, res) => {
    const gameId = req.params.gameId;
    const log = gameManager.getGameLog(gameId);
    const game = gameManager.getGame(gameId);

    const covertEvents: any[] = [];

    // Active espionage operations from live game state
    if (game?.espionage_operations) {
      for (const op of game.espionage_operations) {
        covertEvents.push({
          type: 'espionage_active',
          tick: game.world.tick_count,
          initiator_id: op.initiator_id,
          target_id: op.target_id,
          ticks_remaining: op.ticks_remaining,
          ticks_total: op.ticks_total,
          detected: op.detected,
          budget: op.budget,
          timestamp: Date.now(),
        });
      }
    }

    // Completed espionage events from game log
    if (log) {
      for (const entry of log) {
        for (const event of entry.events) {
          if (event.type === 'espionage_completed') {
            covertEvents.push({
              ...event,
              type: 'espionage_completed',
              tick: entry.tick_number,
              timestamp: Date.now() - ((game?.world?.tick_count ?? entry.tick_number) - entry.tick_number) * 2000,
            });
          }
        }
      }
    }

    res.json(covertEvents);
  });

  app.get('/api/games/:gameId/summary', (req, res) => {
    const summary = gameManager.getGameLogSummary(req.params.gameId);
    if (!summary) {
      return res.status(404).json({ error: 'Game summary not found' });
    }
    res.json(summary);
  });

  // -------------------------------------------------------------------------
  // Post-game report route
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/report', async (req, res) => {
    const gameId = req.params.gameId;
    // Check in-memory first, then database
    let report = reports.get(gameId);
    if (!report) {
      try {
        const idx = await import('../index.js');
        report = (idx as any).gameReports?.get(gameId);
      } catch (_e) { /* ignore */ }
    }
    if (!report) {
      // Fallback: read from SQLite database
      try {
        const { db: pdb } = await import('../persistence/index.js');
        report = await pdb.reports.get(gameId);
      } catch (_e) { /* ignore */ }
    }
    if (!report) {
      return res.status(404).json({ error: 'Report not found. Game may not have ended yet.' });
    }
    res.json(report);
  });

  // -------------------------------------------------------------------------
  // Agent debriefs route
  // -------------------------------------------------------------------------

  app.get('/api/games/:gameId/debriefs', async (req, res) => {
    const gameId = req.params.gameId;
    try {
      // Check for agent-submitted debriefs first (preferred)
      const { getSubmittedDebriefs } = await import('../mcp/mcp-sdk-server.js');
      const agentDebriefs = getSubmittedDebriefs(gameId);

      // Also get auto-generated debriefs as fallback
      const idx = await import('../index.js');
      let autoDebriefs = (idx as any).gameDebriefs?.get(gameId);
      if (!autoDebriefs) {
        const { db: pdb2 } = await import('../persistence/index.js');
        autoDebriefs = await pdb2.debriefs.get(gameId);
      }

      // Also check database for persisted agent debriefs
      if (agentDebriefs.length === 0) {
        try {
          const { db: pdb3 } = await import('../persistence/index.js');
          const persisted = await pdb3.debriefs.get(gameId + ':agent');
          if (persisted && Array.isArray(persisted) && persisted.length > 0) {
            // Return persisted agent debriefs combined with auto-generated
            return res.json({
              agent_debriefs: persisted,
              auto_debriefs: autoDebriefs ?? [],
            });
          }
        } catch (_e) { /* ignore */ }
      }

      if (agentDebriefs.length === 0 && !autoDebriefs) {
        const diskDebriefs = loadDebriefsFromDisk(gameId);
        if (diskDebriefs) {
          return res.json({ agent_debriefs: [], auto_debriefs: diskDebriefs });
        }
        return res.status(404).json({ error: 'Debriefs not found. Game may not have ended yet.' });
      }

      res.json({
        agent_debriefs: agentDebriefs,
        auto_debriefs: autoDebriefs ?? [],
      });
    } catch (_e) {
      const debriefs = loadDebriefsFromDisk(gameId);
      if (debriefs) {
        return res.json({ agent_debriefs: [], auto_debriefs: debriefs });
      }
      return res.status(404).json({ error: 'Debriefs not found.' });
    }
  });

  // -------------------------------------------------------------------------
  // Leaderboard routes
  // -------------------------------------------------------------------------

  if (leaderboardStore) {
    app.get('/api/leaderboard', async (req, res) => {
      const sortBy = (req.query.sort as string) || 'elo';
      const limit = parseInt(req.query.limit as string, 10) || 20;
      try {
        const { db: pdb3 } = await import('../persistence/index.js');
        const dbResults = await pdb3.leaderboard.getLeaderboard(sortBy, limit);
        if (dbResults.length > 0) return res.json(dbResults);
      } catch (_e) { /* fallback to in-memory */ }
      res.json(leaderboardStore.getLeaderboard(sortBy as any, limit));
    });

    app.post('/api/leaderboard/reset', async (_req, res) => {
      try {
        const { db } = await import('../persistence/index.js');
        await db.leaderboard.reset();
        leaderboardStore.reset();
        res.json({ success: true, message: 'Leaderboard reset' });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    app.get('/api/leaderboard/models', async (_req, res) => {
      try {
        const { db: pdb4 } = await import('../persistence/index.js');
        const modelStats = await pdb4.leaderboard.getModelLeaderboard();
        return res.json(modelStats);
      } catch (_e) {
        return res.json([]);
      }
    });

    app.get('/api/leaderboard/:playerId', (req, res) => {
      const profile = leaderboardStore.getPlayerProfile(req.params.playerId);
      if (!profile) {
        return res.status(404).json({ error: 'Player not found' });
      }
      res.json(profile);
    });
  }

  // -------------------------------------------------------------------------
  // Knowledge base routes
  // -------------------------------------------------------------------------

  if (knowledgeBase) {
    app.get('/api/knowledge', async (req, res) => {
      const type = req.query.type as string | undefined;
      const limit = parseInt(req.query.limit as string, 10) || 0;
      try {
        const { db: pdb4 } = await import('../persistence/index.js');
        const dbResults = await pdb4.knowledge.getAll({ type, limit: limit || undefined });
        if (dbResults.length > 0) return res.json(dbResults);
      } catch (_e) { /* fallback to in-memory */ }
      if (limit > 0) {
        res.json(knowledgeBase.getTopPatterns(limit));
      } else {
        res.json(knowledgeBase.getPatterns(type ? { type } : undefined));
      }
    });

    // Agent-sourced insights extracted from submitted debriefs
    app.get('/api/knowledge/agent-insights', async (_req, res) => {
      try {
        const { getSubmittedDebriefs } = await import('../mcp/mcp-sdk-server.js');
        const { db: pdb5 } = await import('../persistence/index.js');

        // Gather debriefs from all games (in-memory + persisted)
        const insights: any[] = [];

        // Check completed games for debriefs
        const completedGames = await pdb5.completedGames.list().catch(() => []);
        const gameIds = completedGames.map((g: any) => g.game_id);

        for (const gameId of gameIds) {
          // Try in-memory first
          let debriefs = getSubmittedDebriefs(gameId);

          // Fallback to database
          if (debriefs.length === 0) {
            try {
              const persisted = await pdb5.debriefs.get(gameId + ':agent');
              if (persisted && Array.isArray(persisted)) {
                debriefs = persisted;
              }
            } catch (_e) { /* ignore */ }
          }

          for (const debrief of debriefs) {
            if (debrief.source !== 'agent' || !debrief.key_insights) continue;
            for (const insight of debrief.key_insights) {
              insights.push({
                id: `agent-${gameId.slice(0, 8)}-${debrief.role_id}-${insights.length}`,
                title: insight.title,
                description: insight.description,
                source: 'agent',
                role_id: debrief.role_id,
                role_name: debrief.role_name,
                game_id: gameId,
                submitted_at: debrief.submitted_at,
              });
            }
          }
        }

        res.json(insights);
      } catch (_e) {
        res.json([]);
      }
    });

    app.get('/api/knowledge/:id', (req, res) => {
      const pattern = knowledgeBase.getPatternById(req.params.id);
      if (!pattern) {
        return res.status(404).json({ error: 'Pattern not found' });
      }
      res.json(pattern);
    });
  }

  // -------------------------------------------------------------------------
  // Classic game API routes
  // -------------------------------------------------------------------------

  if (classicsManager) {
    // List classic games
    app.get('/api/classics', (_req, res) => {
      res.json(classicsManager.listAllGames());
    });

    // Get classic game state (spectator view)
    app.get('/api/classics/:gameId', (req, res) => {
      const state = classicsManager.getSpectatorState(req.params.gameId);
      if (!state) {
        return res.status(404).json({ error: 'Classic game not found' });
      }
      res.json(serializeState(state));
    });
  }
}

// Bot AI logic moved to game/bot-ai.ts
