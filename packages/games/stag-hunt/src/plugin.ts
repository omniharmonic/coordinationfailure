/**
 * Stag Hunt — CoordinationGame plugin.
 *
 * N-player coordination: stag pays off only if ALL players choose stag.
 * Optional per-round communication phase lets players signal intent.
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
  DEFAULT_SH_CONFIG,
  type SHAction,
  type SHConfig,
  type SHOutcome,
  type SHPlayerRanking,
  type SHState,
} from './types.js';

import {
  applyAction,
  createInitialState,
  getAgentView,
  getSpectatorView,
  validateAction,
} from './game.js';

import { computeZeroSumPayouts } from '@coordination-failure/game-prisoners-dilemma';

const SH_GUIDE = `# Stag Hunt — Game Rules

N-player coordination game. Each round has two phases:

## Communication (optional)
All players can send messages to coordinate intent. Messages are
visible to everyone in the round. Use this to signal trust and plan.

## Decision
Each player independently submits \`submit_choice({ choice })\`:
- **stag** — risky. Pays only if EVERY player also chooses stag.
  Total stag payoff is split evenly among stag hunters.
- **hare** — safe. Guaranteed payoff regardless of others.

As soon as every player submits a choice — or the round timer fires
and fills in the timeout default — the round resolves. After
\`config.rounds\` rounds the game ends.

## Payoffs (default)
- \`stagPayoff = 10\` split evenly across stag hunters when all pick stag
- \`harePayoff = 2\` paid to every hare chooser
- Stag-but-not-unanimous: 0

## Strategy
- Stag is Pareto-optimal but risky. One defector ruins the hunt.
- Use the communication phase to build trust.
- Reputation persists within the game: history shows who defected.
`;

export const STAG_HUNT_SYSTEM_ACTION_TYPES: readonly string[] = Object.freeze([
  'game_start',
  'end_communication',
  'round_timeout',
]);

const GAME_TOOLS: ToolDefinition[] = [
  {
    name: 'send_message',
    description:
      'Send a message during the communication phase. All players in the ' +
      'current round see the message. Use to signal intent, build trust, or bluff.',
    mcpExpose: true,
    inputSchema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          minLength: 1,
          maxLength: DEFAULT_SH_CONFIG.maxMessageLength,
          description: 'Round-scoped message, <= maxMessageLength chars.',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_choice',
    description:
      'Submit your decision: "stag" (risky, pays only if all players choose stag) ' +
      'or "hare" (safe, guaranteed payoff).',
    mcpExpose: true,
    inputSchema: {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: ['stag', 'hare'],
        },
      },
      required: ['choice'],
      additionalProperties: false,
    },
  },
];

export const StagHuntPlugin: CoordinationGame<SHConfig, SHState, SHAction, SHOutcome> = {
  gameType: 'stag-hunt',
  version: '0.1.0',

  entryCost: 1,
  spectatorDelay: 0,

  chatScopes: ['all', 'dm'] as const,

  guide: SH_GUIDE,

  getPlayerStatus(state: SHState, playerId: string): string {
    const me = state.players.find((p) => p.id === playerId);
    const lines = [
      '',
      '## Your Status',
      `- **Phase:** ${state.phase}`,
      `- **Round phase:** ${state.roundPhase}`,
      `- **Round:** ${state.round}/${state.config.rounds}`,
    ];
    if (me) {
      lines.push(
        `- **Score:** ${me.score}`,
        `- **Stag choices:** ${me.stagChoices}`,
        `- **Hare choices:** ${me.hareChoices}`,
      );
    }
    return lines.join('\n');
  },

  getSummary(state: SHState): Record<string, any> {
    return {
      round: state.round,
      rounds: state.config.rounds,
      phase: state.phase,
      roundPhase: state.roundPhase,
      players: state.players.map((p) => p.id),
    };
  },

  getSummaryFromSpectator(snapshot: unknown): Record<string, any> {
    const s = snapshot as ReturnType<typeof getSpectatorView>;
    return {
      round: s.round,
      rounds: s.totalRounds,
      phase: s.phase,
      roundPhase: s.roundPhase,
      players: s.players.map((p) => p.id),
    };
  },

  getPlayersNeedingAction(state: SHState): string[] {
    if (state.phase !== 'playing') return [];
    if (state.roundPhase !== 'decision') return [];
    return state.players
      .filter((p) => state.pendingChoices[p.id] === undefined)
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

  getVisibleState(state: SHState, playerId: string | null): unknown {
    if (playerId === null) return getSpectatorView(state);
    return getAgentView(state, playerId) ?? getSpectatorView(state);
  },

  buildSpectatorView(state: SHState, _prev: SHState | null, _ctx: SpectatorContext): unknown {
    return getSpectatorView(state);
  },

  isOver(state: SHState): boolean {
    return state.phase === 'finished';
  },

  getOutcome(state: SHState): SHOutcome {
    const rankings: SHPlayerRanking[] = state.players
      .map((p) => {
        const total = p.stagChoices + p.hareChoices;
        const stagSuccesses = state.history.filter(
          (r) => r.stagSuccess && r.choices[p.id] === 'stag',
        ).length;
        return {
          id: p.id,
          score: p.score,
          stagChoices: p.stagChoices,
          hareChoices: p.hareChoices,
          stagSuccessRate: total > 0 ? stagSuccesses / total : 0,
        };
      })
      .sort((a, b) => b.score - a.score);

    const stagSuccessCount = state.history.filter((r) => r.stagSuccess).length;
    const hareCount = rankings.reduce((s, r) => s + r.hareChoices, 0);

    return { rankings, rounds: state.config.rounds, stagSuccessCount, hareCount };
  },

  computePayouts(outcome: SHOutcome, playerIds: string[], entryCost: number): Map<string, number> {
    return computeZeroSumPayouts(outcome.rankings, playerIds, entryCost);
  },

  createConfig(
    players: { id: string; handle: string; team?: string; role?: string }[],
    seed: string,
    options?: Record<string, any>,
  ): GameSetup<SHConfig> {
    return {
      config: {
        ...DEFAULT_SH_CONFIG,
        entryCost: StagHuntPlugin.entryCost,
        playerIds: players.map((p) => p.id),
        seed,
        ...(options?.rounds ? { rounds: options.rounds } : {}),
        ...(options?.stagPayoff ? { stagPayoff: options.stagPayoff } : {}),
        ...(options?.harePayoff ? { harePayoff: options.harePayoff } : {}),
        ...(options?.communication !== undefined ? { communication: options.communication } : {}),
      },
      players: players.map((p) => ({ id: p.id, team: 'FFA' })),
    };
  },
};

registerGame(StagHuntPlugin);
