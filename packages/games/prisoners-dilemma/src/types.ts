/**
 * Prisoner's Dilemma — type definitions for the CoordinationGame plugin.
 *
 * Classic 2-player iterated PD with a fixed payoff matrix. Each round,
 * both players simultaneously choose to cooperate (C) or defect (D).
 * The round resolves as soon as both submit. System fills defaults on
 * timeout (default: cooperate).
 */

export type PDChoice = 'cooperate' | 'defect';

export interface SubmitChoiceAction {
  type: 'submit_choice';
  choice: PDChoice;
}

export interface GameStartAction {
  type: 'game_start';
}

export interface RoundTimeoutAction {
  type: 'round_timeout';
}

export type PDAction = GameStartAction | SubmitChoiceAction | RoundTimeoutAction;

/**
 * Row-major payoff matrix for the single-round PD game.
 * Standard values: T=5 (temptation), R=3 (reward), P=1 (punishment), S=0 (sucker).
 * Must satisfy T > R > P > S and 2R > T + S for the game to be a "true" PD.
 */
export interface PDPayoffMatrix {
  /** Both cooperate → reward for both */
  R: number;
  /** Both defect → punishment for both */
  P: number;
  /** Defector's payoff when opponent cooperates */
  T: number;
  /** Cooperator's payoff when opponent defects */
  S: number;
}

export interface PDConfig {
  rounds: number;
  payoffs: PDPayoffMatrix;
  /** Seconds per round before the system fills defaults (cooperate). */
  turnTimerSeconds: number;
  /** Default choice when a player times out. */
  timeoutDefault: PDChoice;
  seed: string;
  entryCost: number;
  playerIds: string[];
}

export const DEFAULT_PD_CONFIG: PDConfig = {
  rounds: 20,
  payoffs: { R: 3, P: 1, T: 5, S: 0 },
  turnTimerSeconds: 60,
  timeoutDefault: 'cooperate',
  seed: 'prisoners-dilemma',
  entryCost: 1,
  playerIds: [],
};

export interface PDRoundResult {
  round: number;
  choices: Record<string, PDChoice>;
  payoffs: Record<string, number>;
}

export interface PDPlayerState {
  id: string;
  score: number;
  cooperations: number;
  defections: number;
}

export interface PDState {
  phase: 'waiting' | 'playing' | 'finished';
  round: number;
  players: PDPlayerState[];
  /** Pending choices for the current round, keyed by player id. */
  pendingChoices: Record<string, PDChoice>;
  history: PDRoundResult[];
  config: PDConfig;
}

export interface PDPlayerRanking {
  id: string;
  score: number;
  cooperations: number;
  defections: number;
  cooperationRate: number;
}

export interface PDOutcome {
  rankings: PDPlayerRanking[];
  rounds: number;
  totalCooperations: number;
  totalDefections: number;
}
