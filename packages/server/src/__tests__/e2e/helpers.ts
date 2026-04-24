/**
 * E2E test helpers: drive ClassicsManager + the real MCP dispatcher without
 * touching the HTTP layer or the DB-backed playerStore. Every helper here
 * exercises the same code path an agent hits in production.
 */

import { ClassicsManager } from '../../game/classics-manager.js';
import { dispatchClassicsTool } from '../../mcp/classics-tool-dispatcher.js';
import type {
  ClassicGameType,
  ClassicStateView,
  SubmitChoiceResult,
} from '../../game/classics-shared.js';
import type { ClassicsBackendName } from '../../game/classics-backend.js';

export const BACKENDS: ReadonlyArray<ClassicsBackendName> = ['legacy', 'plugin'];

/** Game types both backends implement. Schelling is legacy-only. */
export const SHARED_GAME_TYPES: ReadonlyArray<ClassicGameType> = [
  'prisoners_dilemma',
  'stag_hunt',
  'tragedy_of_commons',
];

export interface McpAgent {
  playerId: string;
  /** Convenience wrapper that dispatches `tool` with `{ params }`. */
  call(tool: string, params?: Record<string, any>): unknown;
  /** Returns state from the agent's perspective. */
  state(gameId: string): ClassicStateView;
  /** Submit a choice, return the full result (may or may not resolve the round). */
  submit(gameId: string, choice: string, reasoning?: string): SubmitChoiceResult;
}

/** Build a test ClassicsManager in a specific routing mode, cleanup disabled. */
export function makeManager(
  routing: ClassicsBackendName | Record<string, ClassicsBackendName>,
): ClassicsManager {
  return new ClassicsManager({
    routing: typeof routing === 'string' ? routing : (routing as any),
    envOverride: null,
    disableCleanup: true,
  });
}

/** Bind a player to a manager — every call uses the shared dispatcher. */
export function agent(mgr: ClassicsManager, playerId: string): McpAgent {
  const call = (tool: string, params: Record<string, any> = {}) =>
    dispatchClassicsTool({ tool, params, playerId, classicsManager: mgr });
  return {
    playerId,
    call,
    state: (gameId: string) =>
      call('get_classic_state', { game_id: gameId }) as ClassicStateView,
    submit: (gameId: string, choice: string, reasoning?: string) =>
      call('submit_choice', { game_id: gameId, choice, reasoning }) as SubmitChoiceResult,
  };
}

/**
 * Create + auto-join to the configured min_players for `type`, starting the
 * game. Returns the gameId and the list of agent handles in join order.
 */
export function startGameWithAgents(
  mgr: ClassicsManager,
  type: ClassicGameType,
  agents: McpAgent[],
  overrides: Record<string, any> = {},
): { gameId: string; agents: McpAgent[] } {
  const [creator, ...rest] = agents;
  const created = creator.call('join_classic', {
    game_type: type,
    config: overrides,
  }) as { game_id: string };
  for (const a of rest) {
    a.call('join_classic', { game_id: created.game_id });
  }
  return { gameId: created.game_id, agents };
}

/** Wait for game to be 'playing' by polling state (should be immediate after min_players). */
export function ensurePlaying(mgr: ClassicsManager, gameId: string, someAgent: McpAgent): void {
  const s = someAgent.state(gameId);
  if (s.phase !== 'playing')
    throw new Error(`Expected phase=playing, got ${s.phase} for ${gameId}`);
}

/**
 * Play a whole game by asking each agent's strategy for the choice each
 * round. Terminates when isOver (state.phase === 'complete').
 */
export function playToCompletion(
  mgr: ClassicsManager,
  gameId: string,
  agents: McpAgent[],
  strategies: Record<string, (state: ClassicStateView) => string>,
  opts: { maxRounds?: number } = {},
): ClassicStateView {
  const maxRounds = opts.maxRounds ?? 200;
  let safety = maxRounds * agents.length + 10;

  while (safety-- > 0) {
    // Poll state from the first agent; any agent would do since type/phase are public.
    const anyState = agents[0].state(gameId);
    if (anyState.phase === 'complete') return anyState;

    for (const a of agents) {
      const s = a.state(gameId);
      if (s.phase === 'complete') return s;
      if (s.has_submitted) continue; // already submitted this round
      const choice = strategies[a.playerId](s);
      a.submit(gameId, choice);
    }
  }
  throw new Error(`Game ${gameId} did not finish within safety bound`);
}

// ---------------------------------------------------------------------------
// Strategy primitives used across suites
// ---------------------------------------------------------------------------

export const STRATS = {
  alwaysCooperate: (_s: ClassicStateView) => 'cooperate',
  alwaysDefect: (_s: ClassicStateView) => 'defect',
  alwaysStag: (_s: ClassicStateView) => 'stag',
  alwaysHare: (_s: ClassicStateView) => 'hare',
  extractionRate: (rate: number) => (_s: ClassicStateView) => rate.toString(),
  titForTat:
    (me: string) =>
    (s: ClassicStateView): string => {
      if (s.history.length === 0) return 'cooperate';
      const last = s.history[s.history.length - 1];
      const opponent = Object.keys(last.choices).find((k) => k !== me);
      return opponent ? last.choices[opponent] : 'cooperate';
    },
  grimTrigger:
    (me: string) =>
    (s: ClassicStateView): string => {
      const opponentDefected = s.history.some((h) => {
        const opp = Object.keys(h.choices).find((k) => k !== me);
        return opp && h.choices[opp] === 'defect';
      });
      return opponentDefected ? 'defect' : 'cooperate';
    },
};
