/**
 * Tragedy of the Commons — type definitions.
 *
 * N-player resource management. Each round, players simultaneously
 * choose an extraction rate in [min_extraction, max_extraction]. Everyone
 * receives `rate * resource_level / N`. The remaining resource regenerates
 * via a logistic growth step. If the resource collapses to ~0 the game
 * ends early.
 */

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface GameStartAction {
  type: 'game_start';
}

export interface RoundTimeoutAction {
  type: 'round_timeout';
}

export interface SetExtractionAction {
  type: 'set_extraction';
  rate: number;
}

export type TCAction = GameStartAction | RoundTimeoutAction | SetExtractionAction;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface TCConfig {
  rounds: number;
  initialResource: number;
  capacity: number;
  growthRate: number;
  minExtraction: number;
  maxExtraction: number;
  /** Seconds per round before the system fills defaults. */
  turnTimerSeconds: number;
  /** Default extraction rate when a player times out. */
  timeoutDefaultRate: number;
  seed: string;
  entryCost: number;
  playerIds: string[];
}

export const DEFAULT_TC_CONFIG: TCConfig = {
  rounds: 20,
  initialResource: 100,
  capacity: 100,
  growthRate: 1.5,
  minExtraction: 0,
  maxExtraction: 1,
  turnTimerSeconds: 60,
  timeoutDefaultRate: 0.5,
  seed: 'tragedy-commons',
  entryCost: 1,
  playerIds: [],
};

// ---------------------------------------------------------------------------
// Round / player state
// ---------------------------------------------------------------------------

export interface TCRoundResult {
  round: number;
  extractions: Record<string, number>;
  payoffs: Record<string, number>;
  resourceBefore: number;
  resourceAfter: number;
  totalExtractionRate: number;
}

export interface TCPlayerState {
  id: string;
  score: number;
  /** Cumulative extraction for analytics. */
  totalExtracted: number;
}

export interface TCState {
  phase: 'waiting' | 'playing' | 'finished';
  round: number;
  resourceLevel: number;
  players: TCPlayerState[];
  pendingExtractions: Record<string, number>;
  history: TCRoundResult[];
  endedByDepletion: boolean;
  config: TCConfig;
}

export interface TCPlayerRanking {
  id: string;
  score: number;
  totalExtracted: number;
  avgExtractionRate: number;
}

export interface TCOutcome {
  rankings: TCPlayerRanking[];
  roundsPlayed: number;
  endedByDepletion: boolean;
  finalResource: number;
}
