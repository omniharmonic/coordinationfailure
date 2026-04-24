/**
 * Tragedy of the Commons — CoordinationGame plugin.
 */

import {
  registerGame,
  OpenQueuePhase,
  type CoordinationGame,
  type GameSetup,
  type SpectatorContext,
  type ToolDefinition,
} from '@coordination-games/engine';

import {
  DEFAULT_TC_CONFIG,
  type TCAction,
  type TCConfig,
  type TCOutcome,
  type TCPlayerRanking,
  type TCState,
} from './types.js';

import {
  applyAction,
  createInitialState,
  getAgentView,
  getSpectatorView,
  validateAction,
} from './game.js';

import { computeZeroSumPayouts } from '@coordination-failure/game-prisoners-dilemma';

const TC_GUIDE = `# Tragedy of the Commons — Game Rules

N-player resource management. A shared commons supports logistic growth.
Each round every player privately picks an extraction rate in [0, 1]. The
payoff for player i is \`rate_i * resource / N\`. After payouts, the
resource shrinks by the average extraction and regenerates.

## The dynamics
- \`afterExtraction = resource * (1 - avgRate)\`
- \`newResource = afterExtraction * growthRate * (1 - afterExtraction / capacity)\`
- If \`newResource ≤ 0.01\` the commons is depleted and the game ends early.

## Strategy
- Over-extract and you maximize short-term payoff — but the commons
  collapses and nobody scores anything later.
- Under-extract and you leave value on the table for someone else.
- The social optimum is an extraction rate that keeps the resource near
  its carrying capacity.
`;

export const TRAGEDY_COMMONS_SYSTEM_ACTION_TYPES: readonly string[] = Object.freeze([
  'game_start',
  'round_timeout',
]);

const GAME_TOOLS: ToolDefinition[] = [
  {
    name: 'set_extraction',
    description:
      'Set your extraction rate for the current round (0 = nothing, 1 = maximal). ' +
      'The round resolves as soon as all players submit, or when the round ' +
      'timer expires and fills in the configured default rate.',
    mcpExpose: true,
    inputSchema: {
      type: 'object',
      properties: {
        rate: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Extraction rate in [0, 1].',
        },
      },
      required: ['rate'],
      additionalProperties: false,
    },
  },
];

export const TragedyCommonsPlugin: CoordinationGame<TCConfig, TCState, TCAction, TCOutcome> = {
  gameType: 'tragedy-commons',
  version: '0.1.0',

  entryCost: 1,
  spectatorDelay: 0,

  chatScopes: ['all', 'dm'] as const,

  guide: TC_GUIDE,

  getPlayerStatus(state: TCState, playerId: string): string {
    const me = state.players.find((p) => p.id === playerId);
    const lines = [
      '',
      '## Your Status',
      `- **Phase:** ${state.phase}`,
      `- **Round:** ${state.round}/${state.config.rounds}`,
      `- **Resource:** ${state.resourceLevel.toFixed(2)} / ${state.config.capacity}`,
    ];
    if (me) {
      lines.push(
        `- **Score:** ${me.score.toFixed(2)}`,
        `- **Total extracted:** ${me.totalExtracted.toFixed(2)}`,
        `- **Submitted this round:** ${state.pendingExtractions[me.id] !== undefined}`,
      );
    }
    return lines.join('\n');
  },

  getSummary(state: TCState): Record<string, any> {
    return {
      round: state.round,
      rounds: state.config.rounds,
      phase: state.phase,
      resource: state.resourceLevel,
      capacity: state.config.capacity,
      players: state.players.map((p) => p.id),
    };
  },

  getSummaryFromSpectator(snapshot: unknown): Record<string, any> {
    const s = snapshot as ReturnType<typeof getSpectatorView>;
    return {
      round: s.round,
      rounds: s.totalRounds,
      phase: s.phase,
      resource: s.resourceLevel,
      capacity: s.capacity,
      players: s.players.map((p) => p.id),
    };
  },

  getPlayersNeedingAction(state: TCState): string[] {
    if (state.phase !== 'playing') return [];
    return state.players
      .filter((p) => state.pendingExtractions[p.id] === undefined)
      .map((p) => p.id);
  },

  lobby: {
    queueType: 'open' as const,
    phases: [new OpenQueuePhase(3)],
    matchmaking: {
      minPlayers: 3,
      maxPlayers: 8,
      teamSize: 1,
      numTeams: 0,
      queueTimeoutMs: 180000,
    },
  },

  gameTools: GAME_TOOLS,
  requiredPlugins: ['basic-chat'],

  createInitialState,
  validateAction,
  applyAction,

  getVisibleState(state: TCState, playerId: string | null): unknown {
    if (playerId === null) return getSpectatorView(state);
    return getAgentView(state, playerId) ?? getSpectatorView(state);
  },

  buildSpectatorView(state: TCState, _prev: TCState | null, _ctx: SpectatorContext): unknown {
    return getSpectatorView(state);
  },

  isOver(state: TCState): boolean {
    return state.phase === 'finished';
  },

  getOutcome(state: TCState): TCOutcome {
    const rankings: TCPlayerRanking[] = state.players
      .map((p) => ({
        id: p.id,
        score: p.score,
        totalExtracted: p.totalExtracted,
        avgExtractionRate:
          state.history.length > 0 ? p.totalExtracted / state.history.length : 0,
      }))
      .sort((a, b) => b.score - a.score);

    return {
      rankings,
      roundsPlayed: state.history.length,
      endedByDepletion: state.endedByDepletion,
      finalResource: state.resourceLevel,
    };
  },

  computePayouts(outcome: TCOutcome, playerIds: string[], entryCost: number): Map<string, number> {
    return computeZeroSumPayouts(outcome.rankings, playerIds, entryCost);
  },

  createConfig(
    players: { id: string; handle: string; team?: string; role?: string }[],
    seed: string,
    options?: Record<string, any>,
  ): GameSetup<TCConfig> {
    return {
      config: {
        ...DEFAULT_TC_CONFIG,
        entryCost: TragedyCommonsPlugin.entryCost,
        playerIds: players.map((p) => p.id),
        seed,
        ...(options?.rounds ? { rounds: options.rounds } : {}),
        ...(options?.capacity ? { capacity: options.capacity } : {}),
        ...(options?.growthRate ? { growthRate: options.growthRate } : {}),
      },
      players: players.map((p) => ({ id: p.id, team: 'FFA' })),
    };
  },
};

registerGame(TragedyCommonsPlugin);
