/**
 * ClassicsManager — thin orchestrator that routes classic-game calls to
 * one or more pluggable backends.
 *
 * Backend selection (in priority order):
 *   1. Explicit `classicsConfig` passed to the constructor (programmatic).
 *   2. The `CLASSICS_BACKEND` environment variable.
 *   3. Default: legacy for every game type.
 *
 * Accepted env var values:
 *   CLASSICS_BACKEND=legacy
 *   CLASSICS_BACKEND=plugin
 *   CLASSICS_BACKEND='{"prisoners_dilemma":"plugin","stag_hunt":"legacy"}'
 *
 * Notes:
 *   - `schelling_point` always falls back to the legacy backend because no
 *     CoordinationGame plugin has been written for it yet.
 *   - Games keep their backend for their entire lifetime. Flipping
 *     CLASSICS_BACKEND only affects games created after the flip.
 *   - The public method signatures mirror the original ClassicsManager
 *     exactly so every MCP/API call site (server.ts, mcp-sdk-server.ts,
 *     routes.ts) keeps working unchanged.
 */

import type {
  ClassicGameConfig,
  ClassicGameEndCallback,
  ClassicGameSession,
  ClassicGameType,
  ClassicStateView,
  ClassicsCatalog,
  ListGameItem,
  SpectatorStateView,
  SubmitChoiceResult,
} from './classics-shared.js';
import { GAME_DEFS } from './classics-shared.js';
import type { ClassicsBackend, ClassicsBackendName } from './classics-backend.js';
import { LegacyClassicsBackend } from './legacy-classics-backend.js';
import { PluginClassicsBackend } from './plugin-classics-backend.js';

// Re-export shared types so existing consumers that import from
// `./classics-manager.js` keep resolving.
export type {
  ClassicGameConfig,
  ClassicGameEndCallback,
  ClassicGameSession,
  ClassicGameType,
  ClassicRoundResult,
  SubmitChoiceResult,
  ClassicStateView,
  SpectatorStateView,
  ListGameItem,
} from './classics-shared.js';
export { GAME_DEFS } from './classics-shared.js';
export type { ClassicsBackend, ClassicsBackendName } from './classics-backend.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type ClassicsBackendRouting =
  | ClassicsBackendName
  | Partial<Record<ClassicGameType, ClassicsBackendName>>;

export interface ClassicsManagerOptions {
  /** Explicit routing (wins over env). */
  routing?: ClassicsBackendRouting;
  /**
   * Override env var lookup (used by tests). If undefined, `process.env`
   * is consulted. Pass `null` to skip env-based config entirely.
   */
  envOverride?: string | null;
  /** Supply pre-built backends (used by tests so they can inject fakes). */
  backends?: Partial<Record<ClassicsBackendName, ClassicsBackend>>;
  /** Disable the backends' periodic cleanup timers (used by tests). */
  disableCleanup?: boolean;
}

const BACKEND_NAMES: ReadonlyArray<ClassicsBackendName> = ['legacy', 'plugin'];

function parseEnvRouting(raw: string | null | undefined): ClassicsBackendRouting | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === 'legacy' || trimmed === 'plugin') return trimmed;
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, string>;
      const out: Partial<Record<ClassicGameType, ClassicsBackendName>> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!BACKEND_NAMES.includes(v as ClassicsBackendName)) {
          console.warn(
            `[ClassicsManager] CLASSICS_BACKEND entry "${k}": unknown backend "${v}" — ignoring`,
          );
          continue;
        }
        out[k as ClassicGameType] = v as ClassicsBackendName;
      }
      return out;
    } catch (err) {
      console.warn(
        `[ClassicsManager] CLASSICS_BACKEND is not valid JSON; falling back to "legacy". ${err}`,
      );
    }
  } else {
    console.warn(
      `[ClassicsManager] CLASSICS_BACKEND="${raw}" is not recognized; falling back to "legacy".`,
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class ClassicsManager {
  private readonly backends: Record<ClassicsBackendName, ClassicsBackend>;
  private readonly routing: Required<Record<ClassicGameType, ClassicsBackendName>>;
  private readonly callbacks: ClassicGameEndCallback[] = [];

  constructor(options: ClassicsManagerOptions = {}) {
    // Resolve routing config
    const env =
      options.envOverride !== undefined
        ? options.envOverride
        : process.env.CLASSICS_BACKEND;
    const resolved = options.routing ?? parseEnvRouting(env) ?? 'legacy';

    // Instantiate (or accept) backends. Legacy is always present because it
    // backstops schelling_point even in plugin mode.
    this.backends = {
      legacy:
        options.backends?.legacy ??
        new LegacyClassicsBackend({ enableCleanup: !options.disableCleanup }),
      plugin:
        options.backends?.plugin ??
        new PluginClassicsBackend({ enableCleanup: !options.disableCleanup }),
    };

    // Build the per-type routing map. Schelling Point is always legacy.
    this.routing = {
      prisoners_dilemma: 'legacy',
      stag_hunt: 'legacy',
      tragedy_of_commons: 'legacy',
      schelling_point: 'legacy',
    };
    const flat = typeof resolved === 'string' ? resolved : null;
    if (flat !== null) {
      for (const type of Object.keys(this.routing) as ClassicGameType[]) {
        this.routing[type] = flat;
      }
    } else {
      for (const [type, backendName] of Object.entries(resolved) as Array<
        [ClassicGameType, ClassicsBackendName]
      >) {
        this.routing[type] = backendName;
      }
    }

    // Validate + repair: unsupported types on plugin backend fall back to legacy.
    for (const [type, backendName] of Object.entries(this.routing) as Array<
      [ClassicGameType, ClassicsBackendName]
    >) {
      const backend = this.backends[backendName];
      if (!backend.supportedTypes.includes(type)) {
        if (backendName !== 'legacy') {
          console.warn(
            `[ClassicsManager] ${backendName} backend does not support "${type}" — falling back to legacy`,
          );
        }
        this.routing[type] = 'legacy';
      }
    }

    // Wire end-of-game callbacks from every backend through the aggregator.
    for (const backend of Object.values(this.backends)) {
      backend.onGameComplete((gameId, session) => {
        for (const cb of this.callbacks) {
          try {
            cb(gameId, session);
          } catch (err) {
            console.error('[ClassicsManager] end-of-game callback error:', err);
          }
        }
      });
    }

    // Log the final routing once at boot for diagnostics.
    const summary = Object.entries(this.routing)
      .map(([t, b]) => `${t}:${b}`)
      .join(', ');
    console.log(`[ClassicsManager] routing = { ${summary} }`);
  }

  // ---------------------------------------------------------------------------
  // Public API (mirrors the original ClassicsManager surface)
  // ---------------------------------------------------------------------------

  listClassics(): ClassicsCatalog {
    const game_types = (Object.entries(GAME_DEFS) as Array<
      [ClassicGameType, typeof GAME_DEFS[ClassicGameType]]
    >).map(([type, def]) => ({
      type,
      description: def.description,
      min_players: def.min_players,
      max_players: def.max_players,
      valid_choices:
        type === 'tragedy_of_commons'
          ? ['0.0 to 1.0 (numeric extraction rate)']
          : type === 'schelling_point'
          ? ['"row,col" coordinates (e.g., "3,5")']
          : def.valid_choices,
    }));

    const open_games: ClassicsCatalog['open_games'] = [];
    for (const backend of Object.values(this.backends)) {
      open_games.push(...backend.listOpenGames());
    }
    return { game_types, open_games };
  }

  /** @deprecated call createClassicGame — kept as an alias for ClassicsBackend parity. */
  createGame(
    type: ClassicGameType,
    config: Partial<ClassicGameConfig> | undefined,
    playerId: string,
  ): ClassicGameSession {
    return this.createClassicGame(type, config, playerId);
  }

  createClassicGame(
    type: ClassicGameType,
    config: Partial<ClassicGameConfig> | undefined,
    playerId: string,
  ): ClassicGameSession {
    const backendName = this.routing[type];
    const backend = this.backends[backendName];
    if (!backend) throw new Error(`No backend available for type ${type}`);
    return backend.createGame(type, config, playerId);
  }

  joinClassicGame(gameId: string, playerId: string): ClassicGameSession {
    return this.backendFor(gameId).joinGame(gameId, playerId);
  }

  submitChoice(
    gameId: string,
    playerId: string,
    choice: string,
    reasoning?: string,
  ): SubmitChoiceResult {
    return this.backendFor(gameId).submitChoice(gameId, playerId, choice, reasoning);
  }

  getClassicState(gameId: string, playerId: string): ClassicStateView {
    return this.backendFor(gameId).getClassicState(gameId, playerId);
  }

  sendMessage(gameId: string, playerId: string, content: string): { sent: true } {
    return this.backendFor(gameId).sendMessage(gameId, playerId, content);
  }

  getMessages(
    gameId: string,
    playerId: string,
  ): Array<{ from: string; content: string; timestamp: number }> {
    return this.backendFor(gameId).getMessages(gameId, playerId);
  }

  getSpectatorState(gameId: string): SpectatorStateView {
    for (const backend of Object.values(this.backends)) {
      if (backend.hasGame(gameId)) return backend.getSpectatorState(gameId);
    }
    return undefined;
  }

  listAllGames(): ListGameItem[] {
    const out: ListGameItem[] = [];
    for (const backend of Object.values(this.backends)) {
      out.push(...backend.listAllGames());
    }
    return out;
  }

  getGame(gameId: string): ClassicGameSession | undefined {
    for (const backend of Object.values(this.backends)) {
      if (backend.hasGame(gameId)) return backend.getGame(gameId);
    }
    return undefined;
  }

  onGameComplete(cb: ClassicGameEndCallback): void {
    this.callbacks.push(cb);
  }

  /** For diagnostics/tests: which backend is bound to each game type. */
  getRoutingSnapshot(): Readonly<Record<ClassicGameType, ClassicsBackendName>> {
    return { ...this.routing };
  }

  /** For diagnostics/tests: name of the backend owning a specific gameId. */
  getBackendForGame(gameId: string): ClassicsBackendName | undefined {
    for (const [name, backend] of Object.entries(this.backends) as Array<
      [ClassicsBackendName, ClassicsBackend]
    >) {
      if (backend.hasGame(gameId)) return name;
    }
    return undefined;
  }

  /** Stop any background timers owned by the backends (tests / shutdown). */
  shutdown(): void {
    for (const backend of Object.values(this.backends) as ClassicsBackend[]) {
      const maybeStop = (backend as any).stopCleanup;
      if (typeof maybeStop === 'function') maybeStop.call(backend);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private backendFor(gameId: string): ClassicsBackend {
    for (const backend of Object.values(this.backends) as ClassicsBackend[]) {
      if (backend.hasGame(gameId)) return backend;
    }
    throw new Error(`Classic game ${gameId} not found`);
  }
}
