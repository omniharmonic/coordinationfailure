/**
 * ClassicsBackend — implementation interface for classic-game runtimes.
 *
 * Two backends are provided:
 *   - LegacyClassicsBackend: the original in-memory engine that's been
 *     serving the MCP surface since day one. Stable, no plugin dependency.
 *   - PluginClassicsBackend: drives Lucian's CoordinationGame plugins via
 *     GameRoom, using the game-engine workspace plugins in packages/games/.
 *
 * The outer ClassicsManager routes to one backend per game type (selectable
 * via CLASSICS_BACKEND env var) and remembers which backend owns each game
 * so subsequent calls dispatch consistently. The MCP layer does not know
 * which backend it is talking to — method signatures are identical to the
 * original ClassicsManager surface.
 */

import type {
  ClassicGameType,
  ClassicGameConfig,
  ClassicGameSession,
  ClassicGameEndCallback,
  ClassicsCatalog,
  ClassicStateView,
  SubmitChoiceResult,
  SpectatorStateView,
  ListGameItem,
} from './classics-shared.js';

export type ClassicsBackendName = 'legacy' | 'plugin';

export interface ClassicsBackend {
  /** Human-readable backend identifier used in logs and diagnostics. */
  readonly name: ClassicsBackendName;

  /** Game types this backend is willing to run. */
  readonly supportedTypes: ReadonlyArray<ClassicGameType>;

  /** Returns true iff this backend currently owns the given gameId. */
  hasGame(gameId: string): boolean;

  /** List metadata for every open lobby this backend is holding. */
  listOpenGames(): ClassicsCatalog['open_games'];

  /** List every non-complete game this backend owns (for the /api surface). */
  listAllGames(): ListGameItem[];

  /** Raw session object (used internally + by tests). */
  getGame(gameId: string): ClassicGameSession | undefined;

  /** Spectator-safe view of the session. */
  getSpectatorState(gameId: string): SpectatorStateView;

  /** Create a new game session of the given type. */
  createGame(
    type: ClassicGameType,
    config: Partial<ClassicGameConfig> | undefined,
    playerId: string,
  ): ClassicGameSession;

  /** Add a player to an existing lobby; auto-start when min players reached. */
  joinGame(gameId: string, playerId: string): ClassicGameSession;

  /** Submit a choice for the current round. Auto-resolves when all submit. */
  submitChoice(
    gameId: string,
    playerId: string,
    choice: string,
    reasoning?: string,
  ): SubmitChoiceResult;

  /** Per-player state view. */
  getClassicState(gameId: string, playerId: string): ClassicStateView;

  /** Send a chat message (requires allow_communication on the game). */
  sendMessage(
    gameId: string,
    playerId: string,
    content: string,
  ): { sent: true };

  /** Read the most recent chat messages. */
  getMessages(
    gameId: string,
    playerId: string,
  ): Array<{ from: string; content: string; timestamp: number }>;

  /** Subscribe to end-of-game notifications for games owned by this backend. */
  onGameComplete(cb: ClassicGameEndCallback): void;
}
