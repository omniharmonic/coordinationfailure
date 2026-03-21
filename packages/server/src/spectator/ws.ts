import type { Server } from 'http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { GameManager } from '../game/manager.js';
import { serializeState } from '../util/serialize.js';

const spectators = new Map<string, Set<WebSocket>>();

// Delayed feed buffer — prevents real-time intelligence gathering
const DEFAULT_DELAY_MS = 10_000; // 10 seconds for live games (configurable)

interface BufferedEntry {
  timestamp: number;
  payload: string;
}

const delayBuffers = new Map<string, BufferedEntry[]>();

function flushDelayedEntries(gameId: string) {
  const buffer = delayBuffers.get(gameId);
  if (!buffer || buffer.length === 0) return;

  const now = Date.now();
  const gameSpectators = spectators.get(gameId);
  if (!gameSpectators || gameSpectators.size === 0) return;

  // Flush entries that have waited long enough
  while (buffer.length > 0 && buffer[0].timestamp + DEFAULT_DELAY_MS <= now) {
    const entry = buffer.shift()!;
    for (const ws of gameSpectators) {
      try { ws.send(entry.payload); } catch (_e) { /* ignore closed connections */ }
    }
  }
}

export function setupSpectatorWs(server: Server, wss: WebSocketServer, gameManager: GameManager): void {
  // Periodic flush of delay buffers
  setInterval(() => {
    for (const gameId of delayBuffers.keys()) {
      flushDelayedEntries(gameId);
    }
  }, 1000);

  server.on('upgrade', (req, socket, head) => {
    const match = req.url?.match(/^\/ws\/spectate\/(.+)$/);
    if (!match) {
      return; // Let other upgrade handlers (Vite HMR) handle non-matching paths
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const gameId = match[1];

      if (!spectators.has(gameId)) {
        spectators.set(gameId, new Set());
      }
      spectators.get(gameId)!.add(ws);

      // Send current state immediately (delayed state is acceptable since
      // the game has been running for a while already by the time you connect)
      const game = gameManager.getGame(gameId);
      if (game) {
        ws.send(JSON.stringify({ type: 'state', data: serializeState(game) }));
      }

      // Register for tick updates — buffer them with delay
      if (!delayBuffers.has(gameId)) {
        delayBuffers.set(gameId, []);
      }

      const tickCallback = (state: any, events: any[]) => {
        const payload = JSON.stringify({
          type: 'tick',
          data: {
            state: serializeState(state),
            events: events.filter(e => e.type !== 'espionage_completed'),
          },
        });

        const buffer = delayBuffers.get(gameId);
        if (buffer) {
          buffer.push({ timestamp: Date.now(), payload });
        }
      };

      gameManager.onTick(gameId, tickCallback);

      ws.on('close', () => {
        spectators.get(gameId)?.delete(ws);
        gameManager.removeTickCallback(gameId, tickCallback);

        // Clean up empty spectator sets and buffers
        if (spectators.get(gameId)?.size === 0) {
          spectators.delete(gameId);
          delayBuffers.delete(gameId);
        }
      });
    });
  });
}
