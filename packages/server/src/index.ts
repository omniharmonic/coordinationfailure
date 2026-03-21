import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { setupMcpRoutes, channelManager } from './mcp/server.js';
import { setupMcpSdkRoutes } from './mcp/mcp-sdk-server.js';
import { setupApiRoutes } from './api/routes.js';
import { setupSpectatorWs } from './spectator/ws.js';
import { GameManager } from './game/manager.js';
import { ClassicsManager } from './game/classics-manager.js';
import { SessionManager } from './session/manager.js';
import { LeaderboardStore } from './analysis/leaderboard.js';
import { KnowledgeBase } from './analysis/knowledge-base.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT ?? '3000', 10);

const app = express();
app.use(cors());
// Skip body parsing for MCP messages — SSEServerTransport reads the raw stream
app.use((req, res, next) => {
  if (req.path === '/mcp/messages') return next();
  express.json()(req, res, next);
});

// Shared managers
export const sessionManager = new SessionManager();
export const gameManager = new GameManager(sessionManager);
export const classicsManager = new ClassicsManager();
export const leaderboardStore = new LeaderboardStore();
export const knowledgeBase = new KnowledgeBase();

// Unified persistence (Postgres when DATABASE_URL set, else SQLite)
import { initDb, closeAllDb, db } from './persistence/index.js';

// Initialize database on startup
initDb().catch(e => console.error('[CF] Database init error:', e));

// Register game-end callback for leaderboard + analysis on ALL games
import { classifyStrategy } from './analysis/strategy-classifier.js';
import { generatePostGameReport } from './analysis/report-generator.js';
import { generateAgentDebriefs } from './analysis/agent-debrief.js';
import type { AgentDebrief } from './analysis/agent-debrief.js';
import { playerStore } from './api/routes.js';

// In-memory caches (backed by database)
const gameReports = new Map<string, any>();
const gameDebriefs = new Map<string, AgentDebrief[]>();


gameManager.onGameEnd(async (gameId, state, events) => {
  try {
    const gameOverEvent = events.find(e => e.type === 'game_over');
    if (!gameOverEvent || gameOverEvent.type !== 'game_over') return;

    // Record leaderboard entries for all players (database)
    const sessions = sessionManager.getSessionsForGame(gameId);
    for (const session of sessions) {
      const player = await playerStore.getById(session.player_id);
      const handle = player?.handle ?? session.player_id;
      const score = gameOverEvent.scores[session.role_id] ?? 0;
      // Write to database
      db.leaderboard.record(session.player_id, handle, session.role_id, score, gameOverEvent.outcome, gameId);
      // Also write to in-memory store for backward compat
      leaderboardStore.recordGameResult(session.player_id, handle, session.role_id, score, gameOverEvent.outcome, gameId);
    }

    // Persist completed game metadata (database)
    db.completedGames.add({
      game_id: gameId,
      outcome: gameOverEvent.outcome,
      tick_count: state.world?.tick_count ?? 0,
      date: new Date().toISOString(),
      time_speed: state.config?.time_speed ?? 'sprint',
      player_count: sessions.length,
    });

    // Generate post-game report
    const log = gameManager.getGameLog(gameId);
    const summary = gameManager.getGameLogSummary(gameId);
    if (log && summary) {
      const strategies: Record<string, any> = {};
      for (const roleId of Object.keys(state.companies ?? {})) {
        strategies[roleId] = classifyStrategy(roleId, log);
      }
      for (const roleId of Object.keys(state.governments ?? {})) {
        strategies[roleId] = classifyStrategy(roleId, log);
      }
      const report = generatePostGameReport(gameId, log, summary, strategies);
      gameReports.set(gameId, report);
      db.reports.save(gameId, report);
      knowledgeBase.extractPatternsFromGame(report, gameId);

      // Save knowledge patterns to database
      for (const p of knowledgeBase.getPatterns()) {
        db.knowledge.upsert(p);
      }

      // Generate agent debriefs
      const debriefs = generateAgentDebriefs(gameId, log, report);
      gameDebriefs.set(gameId, debriefs);
      db.debriefs.save(gameId, debriefs);

      console.log(`[CF] Game ${gameId.slice(0, 8)} ended: ${gameOverEvent.outcome}. Report generated, ${debriefs.length} debriefs created, knowledge extracted.`);
    }
  } catch (err) {
    console.error('[CF] Post-game processing error:', err);
  }
});

// Make reports and debriefs accessible
export { gameReports, gameDebriefs };

// ---------------------------------------------------------------------------
// Classic game-end callback: extract insights into the knowledge base
// ---------------------------------------------------------------------------

classicsManager.onGameComplete((gameId, session) => {
  try {
    const { type, history, scores, player_ids, ended_by_depletion, resource_level } = session;
    const n = player_ids.length;

    if (type === 'prisoners_dilemma') {
      // Analyze cooperation rates
      const cooperationRates: Record<string, number> = {};
      for (const pid of player_ids) {
        const coopCount = history.filter(r => r.choices[pid] === 'cooperate').length;
        cooperationRates[pid] = history.length > 0 ? coopCount / history.length : 0;
      }
      const avgCoopRate = Object.values(cooperationRates).reduce((a, b) => a + b, 0) / n;
      const avgCoopPct = Math.round(avgCoopRate * 100);

      // Find highest scorer
      const sortedScores = Object.entries(scores).sort(([, a], [, b]) => b - a);
      const topPlayerId = sortedScores[0]?.[0];
      const topCoopRate = topPlayerId ? cooperationRates[topPlayerId] ?? 0 : 0;
      const topCoopPct = Math.round(topCoopRate * 100);

      // Tit-for-tat detection: cooperation rate between 30-70%
      if (topCoopPct >= 30 && topCoopPct <= 70) {
        knowledgeBase.addPattern({
          type: 'strategy',
          description: `PD: Tit-for-tat strategies (cooperation rate ${topCoopPct}%) scored highest in game with avg cooperation ${avgCoopPct}%.`,
          supporting_games: [gameId],
          confidence: 0.6,
        });
      }

      // Always-defect analysis
      const alwaysDefectors = player_ids.filter(pid => cooperationRates[pid] === 0);
      if (alwaysDefectors.length > 0) {
        const defectorWon = alwaysDefectors.some(pid => pid === topPlayerId);
        if (defectorWon && n === 2) {
          knowledgeBase.addPattern({
            type: 'insight',
            description: 'PD: Always-defect strategies won individual games but lost tournaments.',
            supporting_games: [gameId],
            confidence: 0.55,
          });
        }
      }

      // Mutual cooperation insight
      if (avgCoopPct > 70) {
        knowledgeBase.addPattern({
          type: 'correlation',
          description: `PD: High mutual cooperation (${avgCoopPct}%) produced total group score of ${Object.values(scores).reduce((a, b) => a + b, 0).toFixed(1)}.`,
          supporting_games: [gameId],
          confidence: 0.6,
        });
      }
    }

    if (type === 'stag_hunt') {
      // Analyze stag coordination rate
      const stagRates: Record<string, number> = {};
      for (const pid of player_ids) {
        const stagCount = history.filter(r => r.choices[pid] === 'stag').length;
        stagRates[pid] = history.length > 0 ? stagCount / history.length : 0;
      }

      // Check for 100% stag coordination
      const allStagRounds = history.filter(r => player_ids.every(pid => r.choices[pid] === 'stag')).length;
      const allStagPct = history.length > 0 ? Math.round((allStagRounds / history.length) * 100) : 0;
      const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

      // Mixed strategy rounds
      const mixedRounds = history.filter(r => {
        const choices = player_ids.map(pid => r.choices[pid]);
        return new Set(choices).size > 1;
      }).length;

      if (allStagPct === 100) {
        knowledgeBase.addPattern({
          type: 'insight',
          description: `Stag Hunt: Groups with 100% stag coordination scored ${totalScore.toFixed(1)} total points across ${history.length} rounds.`,
          supporting_games: [gameId],
          confidence: 0.65,
        });
      } else if (allStagPct > 0) {
        // Compare stag rounds vs mixed rounds
        const avgStagPayoff = allStagRounds > 0
          ? history.filter(r => player_ids.every(pid => r.choices[pid] === 'stag'))
              .reduce((sum, r) => sum + Object.values(r.payoffs).reduce((a, b) => a + b, 0), 0) / allStagRounds
          : 0;
        const avgMixedPayoff = mixedRounds > 0
          ? history.filter(r => { const c = player_ids.map(pid => r.choices[pid]); return new Set(c).size > 1; })
              .reduce((sum, r) => sum + Object.values(r.payoffs).reduce((a, b) => a + b, 0), 0) / mixedRounds
          : 0;

        if (avgStagPayoff > avgMixedPayoff && avgMixedPayoff > 0) {
          const pctHigher = Math.round(((avgStagPayoff - avgMixedPayoff) / avgMixedPayoff) * 100);
          knowledgeBase.addPattern({
            type: 'correlation',
            description: `Stag Hunt: Stag coordination rounds scored ${pctHigher}% higher than mixed strategy rounds.`,
            supporting_games: [gameId],
            confidence: 0.6,
          });
        }
      }
    }

    if (type === 'tragedy_of_commons') {
      // Analyze extraction rates
      const avgRates: Record<string, number> = {};
      for (const pid of player_ids) {
        const totalRate = history.reduce((sum, r) => {
          return sum + (parseFloat(r.choices[pid]) || 0);
        }, 0);
        avgRates[pid] = history.length > 0 ? totalRate / history.length : 0;
      }
      const overallAvgRate = Object.values(avgRates).reduce((a, b) => a + b, 0) / n;

      if (ended_by_depletion) {
        knowledgeBase.addPattern({
          type: 'insight',
          description: `Tragedy: Resource depleted after ${history.length} of ${session.total_rounds} rounds with avg extraction rate ${overallAvgRate.toFixed(2)}.`,
          supporting_games: [gameId],
          confidence: 0.65,
        });
      }

      // Sustainable extraction insight
      const sustainablePlayers = Object.entries(avgRates).filter(([, rate]) => rate < 0.4);
      if (sustainablePlayers.length > 0 && !ended_by_depletion) {
        knowledgeBase.addPattern({
          type: 'correlation',
          description: `Tragedy: Sustainable extraction (< 0.4) maintained resources for all ${history.length} rounds (final resource: ${(resource_level ?? 0).toFixed(1)}).`,
          supporting_games: [gameId],
          confidence: 0.6,
        });
      }

      // High extraction vs low extraction comparison
      if (n >= 2) {
        const sortedByRate = Object.entries(avgRates).sort(([, a], [, b]) => a - b);
        const lowestExtractor = sortedByRate[0];
        const highestExtractor = sortedByRate[sortedByRate.length - 1];
        if (lowestExtractor && highestExtractor && highestExtractor[1] - lowestExtractor[1] > 0.3) {
          const lowScore = scores[lowestExtractor[0]] ?? 0;
          const highScore = scores[highestExtractor[0]] ?? 0;
          knowledgeBase.addPattern({
            type: 'strategy',
            description: `Tragedy: High extractor (avg ${highestExtractor[1].toFixed(2)}) scored ${highScore.toFixed(1)} vs low extractor (avg ${lowestExtractor[1].toFixed(2)}) scored ${lowScore.toFixed(1)}.`,
            supporting_games: [gameId],
            confidence: 0.55,
          });
        }
      }
    }

    // General fallback: always log a summary pattern for any classic game
    const totalGroupScore = Object.values(scores).reduce((a, b) => a + b, 0);
    knowledgeBase.addPattern({
      type: 'insight',
      description: `Classic ${type.replace(/_/g, ' ')}: ${n}-player game completed after ${history.length} rounds with total group score ${totalGroupScore.toFixed(1)}.`,
      supporting_games: [gameId],
      confidence: 0.3,
    });

    console.log(`[CF] Classic game ${gameId.slice(0, 16)} (${type}) completed. Insights extracted.`);
  } catch (err) {
    console.error('[CF] Classic post-game processing error:', err);
  }
});

// Graceful shutdown flag
let shuttingDown = false;

// Enhanced health check
app.get('/health', (_req, res) => {
  res.json({
    status: shuttingDown ? 'shutting_down' : 'ok',
    active_games: gameManager.listGames().filter(g => g.phase === 'running').length,
    connected_sessions: sessionManager.getActiveSessionCount(),
    uptime: process.uptime(),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
    tick_loops_active: gameManager.getActiveTickLoopCount(),
  });
});

// API routes (registration, game listing)
setupApiRoutes(app, gameManager, sessionManager, classicsManager, leaderboardStore, knowledgeBase);

// MCP routes (SSE + HTTP)
setupMcpRoutes(app, gameManager, sessionManager, classicsManager);

// MCP SDK routes (proper SSE transport for Claude agents)
setupMcpSdkRoutes(app, gameManager, sessionManager, channelManager, classicsManager);

// Serve web frontend (from built dist if it exists)
import fs from 'fs';
const webDistPath = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistPath)) {
  app.use(express.static(webDistPath));
  // SPA fallback — serve index.html for non-API routes
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/ws') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(webDistPath, 'index.html'));
  });
  console.log('[CF] Serving web frontend from', webDistPath);
} else {
  console.log('[CF] No web dist found — run "npm run dev:web" on port 5173, or build with "cd packages/web && npx vite build"');
}

// HTTP server for WebSocket upgrade
const server = createServer(app);

// WebSocket spectator feed
const wss = new WebSocketServer({ noServer: true });
setupSpectatorWs(server, wss, gameManager);

// Reject new connections during shutdown
server.on('upgrade', (req, socket, head) => {
  if (shuttingDown) {
    socket.destroy();
    return;
  }
});

server.listen(PORT, () => {
  console.log(`[CF] Server running on http://localhost:${PORT}`);
  console.log(`[CF] MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`[CF] Health: http://localhost:${PORT}/health`);
});

// === Graceful Shutdown ===
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[CF] Received ${signal}. Shutting down gracefully...`);

  // Stop all game tick loops
  gameManager.stopAllGames();
  console.log('[CF] All game tick loops stopped.');

  // Close database
  closeAllDb().catch(() => {});

  // Close all WebSocket connections
  wss.clients.forEach((ws) => {
    try {
      ws.close(1001, 'Server shutting down');
    } catch (_e) { /* ignore */ }
  });
  console.log('[CF] All WebSocket connections closed.');

  // Close the HTTP server
  server.close(() => {
    console.log('[CF] HTTP server closed. Goodbye.');
    process.exit(0);
  });

  // Force exit after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    console.error('[CF] Forced exit after timeout.');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
