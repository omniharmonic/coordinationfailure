/**
 * Stag Hunt — type definitions.
 *
 * N-player cooperation game: stag pays out only if everyone chooses stag,
 * hare is a safe guaranteed payoff. Optional communication phase each round
 * lets players signal intent (or bluff) before committing.
 */

export type SHChoice = 'stag' | 'hare';

export type SHRoundPhase = 'communication' | 'decision' | 'resolved';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface GameStartAction {
  type: 'game_start';
}

export interface EndCommunicationAction {
  type: 'end_communication';
}

export interface RoundTimeoutAction {
  type: 'round_timeout';
}

export interface SendMessageAction {
  type: 'send_message';
  message: string;
}

export interface SubmitChoiceAction {
  type: 'submit_choice';
  choice: SHChoice;
}

export type SHAction =
  | GameStartAction
  | EndCommunicationAction
  | RoundTimeoutAction
  | SendMessageAction
  | SubmitChoiceAction;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SHConfig {
  rounds: number;
  stagPayoff: number;
  harePayoff: number;
  /** Whether each round starts with a communication phase. */
  communication: boolean;
  /** Seconds of communication before auto end_communication. */
  communicationSeconds: number;
  /** Seconds to decide (after communication, or from round start). */
  decisionSeconds: number;
  /** Max message length in chars (guards state bloat). */
  maxMessageLength: number;
  /** Default choice when a player misses the timer. */
  timeoutDefault: SHChoice;
  seed: string;
  entryCost: number;
  playerIds: string[];
}

export const DEFAULT_SH_CONFIG: SHConfig = {
  rounds: 10,
  stagPayoff: 10,
  harePayoff: 2,
  communication: true,
  communicationSeconds: 30,
  decisionSeconds: 30,
  maxMessageLength: 500,
  timeoutDefault: 'hare',
  seed: 'stag-hunt',
  entryCost: 1,
  playerIds: [],
};

// ---------------------------------------------------------------------------
// Per-round
// ---------------------------------------------------------------------------

export interface SHMessage {
  round: number;
  playerId: string;
  message: string;
}

export interface SHRoundResult {
  round: number;
  choices: Record<string, SHChoice>;
  payoffs: Record<string, number>;
  stagSuccess: boolean;
  messages: SHMessage[];
}

// ---------------------------------------------------------------------------
// Per-player
// ---------------------------------------------------------------------------

export interface SHPlayerState {
  id: string;
  score: number;
  stagChoices: number;
  hareChoices: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface SHState {
  phase: 'waiting' | 'playing' | 'finished';
  roundPhase: SHRoundPhase;
  round: number;
  players: SHPlayerState[];
  pendingChoices: Record<string, SHChoice>;
  /** Messages sent during the current round's communication phase. */
  pendingMessages: SHMessage[];
  history: SHRoundResult[];
  config: SHConfig;
}

export interface SHPlayerRanking {
  id: string;
  score: number;
  stagChoices: number;
  hareChoices: number;
  stagSuccessRate: number;
}

export interface SHOutcome {
  rankings: SHPlayerRanking[];
  rounds: number;
  stagSuccessCount: number;
  hareCount: number;
}
