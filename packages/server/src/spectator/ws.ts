import type { Server } from 'http';
import type { WebSocketServer, WebSocket } from 'ws';
import type { GameManager } from '../game/manager.js';
import { serializeState } from '../util/serialize.js';

const spectators = new Map<string, Set<WebSocket>>();

export function setupSpectatorWs(server: Server, wss: WebSocketServer, gameManager: GameManager): void {

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

      // Send current state immediately
      const game = gameManager.getGame(gameId);
      if (game) {
        ws.send(JSON.stringify({ type: 'state', data: serializeState(game) }));
      }

      // Register for tick updates — send directly (no delay)
      const tickCallback = (state: any, events: any[]) => {
        try {
          const payload = JSON.stringify({
            type: 'tick',
            data: {
              state: serializeState(state),
              events: events.filter(e => e.type !== 'espionage_completed'),
            },
          });

          const gameSpectators = spectators.get(gameId);
          if (gameSpectators) {
            for (const client of gameSpectators) {
              try { client.send(payload); } catch (_e) { /* ignore closed connections */ }
            }
          }
        } catch (_e) {
          // Prevent JSON.stringify errors from propagating to tick loop
        }
      };

      gameManager.onTick(gameId, tickCallback);

      ws.on('close', () => {
        spectators.get(gameId)?.delete(ws);
        gameManager.removeTickCallback(gameId, tickCallback);

        // Clean up empty spectator sets
        if (spectators.get(gameId)?.size === 0) {
          spectators.delete(gameId);
        }
      });
    });
  });
}
