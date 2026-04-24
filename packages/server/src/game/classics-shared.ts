/**
 * Shared types, game definitions, and constants for the classics subsystem.
 *
 * Lifted out of the original classics-manager.ts so that every backend
 * (legacy in-memory engine, plugin-based GameRoom backend) can import the
 * same stable types without pulling in either implementation.
 */

import type { SchellingBoard } from './schelling-board.js';

export type ClassicGameType =
  | 'prisoners_dilemma'
  | 'stag_hunt'
  | 'tragedy_of_commons'
  | 'schelling_point';

export interface ClassicRoundResult {
  round: number;
  choices: Record<string, string>;
  payoffs: Record<string, number>;
  /** For tragedy_of_commons: resource level after this round resolved */
  resource_after?: number;
  /** For schelling_point: the board used this round */
  board?: SchellingBoard;
  /** Chain-of-thought reasoning submitted with choices (spectator-only). */
  reasoning?: Record<string, string>;
}

export interface ClassicGameConfig {
  rounds: number;
  allow_communication: boolean;
  [key: string]: unknown;
}

export interface ClassicGameSession {
  id: string;
  type: ClassicGameType;
  config: ClassicGameConfig;
  player_ids: string[];
  min_players: number;
  max_players: number;
  current_round: number;
  total_rounds: number;
  history: ClassicRoundResult[];
  scores: Record<string, number>;
  pending_choices: Record<string, string>;
  pending_reasoning: Record<string, string>;
  phase: 'waiting' | 'playing' | 'complete';
  messages: Array<{ from: string; content: string; timestamp: number }>;
  created_at: Date;
  resource_level?: number;
  ended_by_depletion?: boolean;
  current_board?: SchellingBoard;
  last_activity: number;
}

export type ClassicGameEndCallback = (
  gameId: string,
  session: ClassicGameSession,
) => void;

// ---------------------------------------------------------------------------
// Game-type definitions (legacy payoff resolvers live here so both backends
// can share the same catalog metadata — description, min/max players, valid
// choices — while their resolution paths differ).
// ---------------------------------------------------------------------------

export type PayoffResolver = (
  choices: Record<string, string>,
  playerIds: string[],
) => Record<string, number>;

export interface GameDef {
  description: string;
  min_players: number;
  max_players: number;
  valid_choices: string[];
  default_rounds: number;
  resolvePayoffs: PayoffResolver;
}

export const GAME_DEFS: Record<ClassicGameType, GameDef> = {
  prisoners_dilemma: {
    description: "Iterated Prisoner's Dilemma — cooperate or defect each round",
    min_players: 2,
    max_players: 2,
    valid_choices: ['cooperate', 'defect'],
    default_rounds: 10,
    resolvePayoffs(choices, playerIds) {
      const [p1, p2] = playerIds;
      const c1 = choices[p1];
      const c2 = choices[p2];
      if (c1 === 'cooperate' && c2 === 'cooperate') return { [p1]: 3, [p2]: 3 };
      if (c1 === 'defect' && c2 === 'defect') return { [p1]: 1, [p2]: 1 };
      if (c1 === 'defect') return { [p1]: 5, [p2]: 0 };
      return { [p1]: 0, [p2]: 5 };
    },
  },
  stag_hunt: {
    description:
      'Stag Hunt — coordinate on stag (risky, high reward) or play it safe with hare',
    min_players: 2,
    max_players: 2,
    valid_choices: ['stag', 'hare'],
    default_rounds: 10,
    resolvePayoffs(choices, playerIds) {
      const [p1, p2] = playerIds;
      const c1 = choices[p1];
      const c2 = choices[p2];
      if (c1 === 'stag' && c2 === 'stag') return { [p1]: 4, [p2]: 4 };
      if (c1 === 'hare' && c2 === 'hare') return { [p1]: 2, [p2]: 2 };
      if (c1 === 'stag') return { [p1]: 0, [p2]: 3 };
      return { [p1]: 3, [p2]: 0 };
    },
  },
  tragedy_of_commons: {
    description:
      'Tragedy of the Commons — choose an extraction rate (0.0 = conserve, 1.0 = full exploit) from a shared resource pool',
    min_players: 2,
    max_players: 6,
    valid_choices: [], // numeric 0.0-1.0 — validated separately
    default_rounds: 10,
    resolvePayoffs(choices, playerIds) {
      const n = playerIds.length;
      const payoffs: Record<string, number> = {};
      for (const id of playerIds) {
        const rate = parseFloat(choices[id]);
        payoffs[id] =
          Math.round(((isNaN(rate) ? 0 : rate) * 100) / n * 100) / 100;
      }
      return payoffs;
    },
  },
  schelling_point: {
    description:
      'Schelling Point — independently choose a location on a shared map. No communication. Converge on the focal point.',
    min_players: 2,
    max_players: 6,
    valid_choices: [], // coordinate format "row,col" — validated separately
    default_rounds: 5,
    resolvePayoffs(_choices, playerIds) {
      const payoffs: Record<string, number> = {};
      for (const id of playerIds) payoffs[id] = 0;
      return payoffs;
    },
  },
};

// Tragedy-of-the-Commons constants (used by both backends so the math lines up
// if/when we run them side by side on the same game).
export const TRAGEDY_CAPACITY = 100;
export const TRAGEDY_GROWTH_RATE = 0.3;
export const TRAGEDY_INITIAL_RESOURCE = 100;

// ---------------------------------------------------------------------------
// Return shapes shared across backends (documenting the MCP contract)
// ---------------------------------------------------------------------------

export interface ClassicsCatalog {
  game_types: Array<{
    type: ClassicGameType;
    description: string;
    min_players: number;
    max_players: number;
    valid_choices: string[];
  }>;
  open_games: Array<{
    game_id: string;
    type: ClassicGameType;
    players: number;
    min_players: number;
    max_players: number;
    phase: string;
  }>;
}

export interface SubmitChoiceResult {
  submitted: true;
  round_resolved?: boolean;
  result?: ClassicRoundResult;
  resource_level?: number;
}

export interface ClassicStateView {
  game_id: string;
  type: ClassicGameType;
  phase: string;
  current_round: number;
  total_rounds: number;
  players: number;
  player_ids: string[];
  my_score: number;
  scores: Record<string, number>;
  history: ClassicRoundResult[];
  has_submitted: boolean;
  waiting_on: number;
  valid_choices: string[];
  allow_communication: boolean;
  resource_level?: number;
  ended_by_depletion?: boolean;
  board?: string;
  board_grid?: unknown;
  board_width?: number;
  board_height?: number;
}

export interface ListGameItem {
  game_id: string;
  type: ClassicGameType;
  phase: string;
  players: number;
  max_players: number;
  current_round: number;
  total_rounds: number;
  resource_level?: number;
}

export type SpectatorStateView =
  | (Omit<ClassicGameSession, 'pending_choices' | 'messages'> & {
      pending_count: number;
      board_text?: string;
      messages?: Array<{ from: string; content: string; timestamp: number }>;
    })
  | undefined;
