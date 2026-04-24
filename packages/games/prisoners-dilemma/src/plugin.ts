/**
 * Prisoner's Dilemma — CoordinationGame plugin.
 *
 * Classic iterated 2-player PD. Also supports N-player mode (everyone plays
 * everyone, payoffs averaged) so the same plugin can power round-robin
 * tournaments.
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
  DEFAULT_PD_CONFIG,
  type PDAction,
  type PDConfig,
  type PDOutcome,
  type PDPlayerRanking,
  type PDState,
} from './types.js';

import {
  applyAction,
  createInitialState,
  getAgentView,
  getSpectatorView,
  validateAction,
} from './game.js';

const PD_GUIDE = `# Prisoner's Dilemma — Game Rules

Classic iterated prisoner's dilemma. Each round you and your opponent
simultaneously choose to **cooperate** or **defect**. The payoff matrix
enforces the dilemma — defection strictly dominates a one-shot game,
but mutual cooperation beats mutual defection.

## Payoff matrix (per round)
| You \\ Them | Cooperate | Defect |
|-------------|-----------|--------|
| **Cooperate** | R=3, R=3 | S=0, T=5 |
| **Defect**    | T=5, S=0 | P=1, P=1 |

## Flow
1. Engine emits \`game_start\`; round 1 begins.
2. Each player calls \`submit_choice({ choice })\` with "cooperate" or "defect".
3. As soon as both players submit — or the round timer fires and
   fills in the timeout default — the round resolves and the engine
   advances to the next round.
4. After \`config.rounds\` rounds the game ends. Final payouts
   distribute the entry pool proportionally to score.

## Strategy
- **Tit-for-tat**: cooperate first, mirror opponent. Classic and robust.
- **Grim trigger**: cooperate until betrayed, then defect forever.
- **Always defect**: nash-equilibrium for the one-shot game.
- **Always cooperate**: exploited by defectors.

Reputation is local to the game — history is visible only within this match.
`;

export const PRISONERS_DILEMMA_SYSTEM_ACTION_TYPES: readonly string[] = Object.freeze([
  'game_start',
  'round_timeout',
]);

const GAME_TOOLS: ToolDefinition[] = [
  {
    name: 'submit_choice',
    description:
      'Submit your choice for the current round: "cooperate" or "defect". ' +
      'The round resolves as soon as all players have submitted, or when the ' +
      'round timer fires and fills in the configured default.',
    mcpExpose: true,
    inputSchema: {
      type: 'object',
      properties: {
        choice: {
          type: 'string',
          enum: ['cooperate', 'defect'],
          description: '"cooperate" to keep silent, "defect" to betray.',
        },
      },
      required: ['choice'],
      additionalProperties: false,
    },
  },
];

export const PrisonersDilemmaPlugin: CoordinationGame<PDConfig, PDState, PDAction, PDOutcome> = {
  gameType: 'prisoners-dilemma',
  version: '0.1.0',

  entryCost: 1,
  spectatorDelay: 0,

  chatScopes: ['all', 'dm'] as const,

  guide: PD_GUIDE,

  getPlayerStatus(state: PDState, playerId: string): string {
    const me = state.players.find((p) => p.id === playerId);
    const lines = [
      '',
      '## Your Status',
      `- **Phase:** ${state.phase}`,
      `- **Round:** ${state.round}/${state.config.rounds}`,
    ];
    if (me) {
      lines.push(
        `- **Score:** ${me.score}`,
        `- **Cooperations:** ${me.cooperations}`,
        `- **Defections:** ${me.defections}`,
        `- **Submitted this round:** ${state.pendingChoices[me.id] !== undefined}`,
      );
    }
    return lines.join('\n');
  },

  getSummary(state: PDState): Record<string, any> {
    return {
      round: state.round,
      rounds: state.config.rounds,
      phase: state.phase,
      players: state.players.map((p) => p.id),
    };
  },

  getSummaryFromSpectator(snapshot: unknown): Record<string, any> {
    const s = snapshot as ReturnType<typeof getSpectatorView>;
    return {
      round: s.round,
      rounds: s.totalRounds,
      phase: s.phase,
      players: s.players.map((p) => p.id),
    };
  },

  getPlayersNeedingAction(state: PDState): string[] {
    if (state.phase !== 'playing') return [];
    return state.players
      .filter((p) => state.pendingChoices[p.id] === undefined)
      .map((p) => p.id);
  },

  lobby: {
    queueType: 'open' as const,
    phases: [new OpenQueuePhase(2)],
    matchmaking: {
      minPlayers: 2,
      maxPlayers: 2,
      teamSize: 1,
      numTeams: 0,
      queueTimeoutMs: 120000,
    },
  },

  gameTools: GAME_TOOLS,

  requiredPlugins: ['basic-chat'],

  createInitialState,
  validateAction,
  applyAction,

  getVisibleState(state: PDState, playerId: string | null): unknown {
    if (playerId === null) return getSpectatorView(state);
    return getAgentView(state, playerId) ?? getSpectatorView(state);
  },

  buildSpectatorView(state: PDState, _prev: PDState | null, _ctx: SpectatorContext): unknown {
    return getSpectatorView(state);
  },

  isOver(state: PDState): boolean {
    return state.phase === 'finished';
  },

  getOutcome(state: PDState): PDOutcome {
    const rankings: PDPlayerRanking[] = state.players
      .map((p) => {
        const total = p.cooperations + p.defections;
        return {
          id: p.id,
          score: p.score,
          cooperations: p.cooperations,
          defections: p.defections,
          cooperationRate: total > 0 ? p.cooperations / total : 0,
        };
      })
      .sort((a, b) => b.score - a.score);

    const totalCooperations = rankings.reduce((s, r) => s + r.cooperations, 0);
    const totalDefections = rankings.reduce((s, r) => s + r.defections, 0);

    return {
      rankings,
      rounds: state.config.rounds,
      totalCooperations,
      totalDefections,
    };
  },

  computePayouts(outcome: PDOutcome, playerIds: string[], entryCost: number): Map<string, number> {
    return computeZeroSumPayouts(outcome.rankings, playerIds, entryCost);
  },

  createConfig(
    players: { id: string; handle: string; team?: string; role?: string }[],
    seed: string,
    options?: Record<string, any>,
  ): GameSetup<PDConfig> {
    return {
      config: {
        ...DEFAULT_PD_CONFIG,
        entryCost: PrisonersDilemmaPlugin.entryCost,
        playerIds: players.map((p) => p.id),
        seed,
        ...(options?.rounds ? { rounds: options.rounds } : {}),
        ...(options?.payoffs ? { payoffs: options.payoffs } : {}),
      },
      players: players.map((p) => ({ id: p.id, team: 'FFA' })),
    };
  },
};

/**
 * Zero-sum payout: split the entry pool proportionally to score.
 * Each player's delta = share - entryCost. Sum of deltas = 0.
 *
 * Edge case: if the total score is 0, split the pool evenly.
 *
 * Generic over any ranking type that exposes `{ id, score }`, so other
 * classics (stag hunt, tragedy of the commons) can reuse this helper
 * without coupling to PD-specific fields.
 */
export function computeZeroSumPayouts(
  rankings: { id: string; score: number }[],
  playerIds: string[],
  entryCost: number,
): Map<string, number> {
  const pool = playerIds.length * entryCost;
  const byId = new Map(rankings.map((r) => [r.id, r]));
  const totalScore = rankings.reduce((s, r) => s + r.score, 0);

  const shares = new Map<string, number>();
  if (totalScore <= 0) {
    const evenShare = pool / playerIds.length;
    for (const id of playerIds) shares.set(id, evenShare);
  } else {
    for (const id of playerIds) {
      const r = byId.get(id);
      shares.set(id, r ? (r.score / totalScore) * pool : 0);
    }
  }

  // Normalize rounding drift so the sum of deltas is exactly 0.
  let payoutSum = 0;
  const payouts = new Map<string, number>();
  for (const id of playerIds) {
    const share = shares.get(id) ?? 0;
    const delta = share - entryCost;
    payouts.set(id, delta);
    payoutSum += delta;
  }
  if (Math.abs(payoutSum) > 1e-9 && playerIds.length > 0) {
    const correction = payoutSum / playerIds.length;
    for (const id of playerIds) {
      payouts.set(id, (payouts.get(id) ?? 0) - correction);
    }
  }
  return payouts;
}

registerGame(PrisonersDilemmaPlugin);
