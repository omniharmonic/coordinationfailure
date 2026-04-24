/**
 * Tragedy of the Commons — core game logic.
 *
 * Logistic-growth resource model: each round players submit an extraction
 * rate r_i ∈ [min, max]. Payoff_i = r_i * resource / N. Then the resource
 * shrinks by the avg extraction and regenerates logistically. If it
 * collapses below the depletion threshold, the game ends early.
 */

import type { ActionResult } from '@coordination-games/engine';

import type {
  TCAction,
  TCConfig,
  TCPlayerState,
  TCRoundResult,
  TCState,
} from './types.js';

const DEPLETION_THRESHOLD = 0.01;

export function createInitialState(config: TCConfig): TCState {
  const players: TCPlayerState[] = config.playerIds.map((id) => ({
    id,
    score: 0,
    totalExtracted: 0,
  }));
  return {
    phase: 'waiting',
    round: 0,
    resourceLevel: config.initialResource,
    players,
    pendingExtractions: {},
    history: [],
    endedByDepletion: false,
    config,
  };
}

export function validateAction(
  state: TCState,
  playerId: string | null,
  action: TCAction,
): boolean {
  if (action.type === 'game_start') {
    return playerId === null && state.phase === 'waiting';
  }
  if (action.type === 'round_timeout') {
    return playerId === null && state.phase === 'playing';
  }

  if (playerId === null) return false;
  if (state.phase !== 'playing') return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  if (action.type === 'set_extraction') {
    if (state.pendingExtractions[playerId] !== undefined) return false;
    if (typeof action.rate !== 'number' || !Number.isFinite(action.rate)) return false;
    const { minExtraction, maxExtraction } = state.config;
    if (action.rate < minExtraction - 1e-9) return false;
    if (action.rate > maxExtraction + 1e-9) return false;
    return true;
  }

  return false;
}

export function applyAction(
  state: TCState,
  playerId: string | null,
  action: TCAction,
): ActionResult<TCState, TCAction> {
  if (action.type === 'game_start') {
    return {
      state: { ...state, phase: 'playing', round: 1 },
      deadline: {
        seconds: state.config.turnTimerSeconds,
        action: { type: 'round_timeout' },
      },
    };
  }

  if (action.type === 'round_timeout') {
    return resolveRound(fillTimeoutDefaults(state));
  }

  if (action.type === 'set_extraction' && playerId) {
    const pendingExtractions = {
      ...state.pendingExtractions,
      [playerId]: clamp(
        action.rate,
        state.config.minExtraction,
        state.config.maxExtraction,
      ),
    };
    const newState: TCState = { ...state, pendingExtractions };
    if (allPlayersSubmitted(newState)) {
      return resolveRound(newState);
    }
    return { state: newState };
  }

  return { state };
}

// ---------------------------------------------------------------------------
// Round resolution
// ---------------------------------------------------------------------------

function resolveRound(state: TCState): ActionResult<TCState, TCAction> {
  const n = state.players.length;
  const extractions = { ...state.pendingExtractions };
  const resourceBefore = state.resourceLevel;

  // Payoff: rate * resource / N
  let totalExtractionRate = 0;
  const payoffs: Record<string, number> = {};
  for (const p of state.players) {
    const rate = extractions[p.id];
    totalExtractionRate += rate;
    payoffs[p.id] = (rate * resourceBefore) / n;
  }

  // Logistic regeneration. Matches the legacy engine's model so the
  // dynamics translate cleanly.
  const afterExtraction = resourceBefore * (1 - totalExtractionRate / n);
  const regen = afterExtraction * state.config.growthRate * (1 - afterExtraction / state.config.capacity);
  const newResource = Math.max(0, regen);

  const players: TCPlayerState[] = state.players.map((p) => ({
    ...p,
    score: p.score + payoffs[p.id],
    totalExtracted: p.totalExtracted + extractions[p.id],
  }));

  const round: TCRoundResult = {
    round: state.round,
    extractions,
    payoffs,
    resourceBefore,
    resourceAfter: newResource,
    totalExtractionRate,
  };

  const depleted = newResource <= DEPLETION_THRESHOLD;
  const reachedLimit = state.round >= state.config.rounds;
  const finished = depleted || reachedLimit;

  const resolved: TCState = {
    ...state,
    players,
    resourceLevel: depleted ? 0 : newResource,
    pendingExtractions: {},
    history: [...state.history, round],
    round: finished ? state.round : state.round + 1,
    phase: finished ? 'finished' : 'playing',
    endedByDepletion: depleted,
  };

  if (finished) {
    return { state: resolved, deadline: null, progressIncrement: true };
  }

  return {
    state: resolved,
    deadline: {
      seconds: state.config.turnTimerSeconds,
      action: { type: 'round_timeout' },
    },
    progressIncrement: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allPlayersSubmitted(state: TCState): boolean {
  return state.players.every((p) => state.pendingExtractions[p.id] !== undefined);
}

function fillTimeoutDefaults(state: TCState): TCState {
  const pendingExtractions = { ...state.pendingExtractions };
  for (const p of state.players) {
    if (pendingExtractions[p.id] === undefined) {
      pendingExtractions[p.id] = clamp(
        state.config.timeoutDefaultRate,
        state.config.minExtraction,
        state.config.maxExtraction,
      );
    }
  }
  return { ...state, pendingExtractions };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface TCAgentView {
  phase: TCState['phase'];
  round: number;
  totalRounds: number;
  yourScore: number;
  yourSubmitted: boolean;
  yourExtraction: number | null;
  resourceLevel: number;
  capacity: number;
  players: { id: string; score: number; submitted: boolean }[];
  history: TCRoundResult[];
  config: Omit<TCConfig, 'seed' | 'playerIds'>;
}

export interface TCSpectatorView {
  phase: TCState['phase'];
  round: number;
  totalRounds: number;
  resourceLevel: number;
  capacity: number;
  endedByDepletion: boolean;
  players: {
    id: string;
    score: number;
    totalExtracted: number;
    hasSubmitted: boolean;
  }[];
  history: TCRoundResult[];
}

export function getAgentView(state: TCState, playerId: string): TCAgentView | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;

  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.config.rounds,
    yourScore: me.score,
    yourSubmitted: state.pendingExtractions[me.id] !== undefined,
    yourExtraction: state.pendingExtractions[me.id] ?? null,
    resourceLevel: state.resourceLevel,
    capacity: state.config.capacity,
    players: state.players.map((p) => ({
      id: p.id,
      score: p.score,
      submitted: state.pendingExtractions[p.id] !== undefined,
    })),
    history: state.history,
    config: {
      rounds: state.config.rounds,
      initialResource: state.config.initialResource,
      capacity: state.config.capacity,
      growthRate: state.config.growthRate,
      minExtraction: state.config.minExtraction,
      maxExtraction: state.config.maxExtraction,
      turnTimerSeconds: state.config.turnTimerSeconds,
      timeoutDefaultRate: state.config.timeoutDefaultRate,
      entryCost: state.config.entryCost,
    },
  };
}

export function getSpectatorView(state: TCState): TCSpectatorView {
  return {
    phase: state.phase,
    round: state.round,
    totalRounds: state.config.rounds,
    resourceLevel: state.resourceLevel,
    capacity: state.config.capacity,
    endedByDepletion: state.endedByDepletion,
    players: state.players.map((p) => ({
      id: p.id,
      score: p.score,
      totalExtracted: p.totalExtracted,
      hasSubmitted: state.pendingExtractions[p.id] !== undefined,
    })),
    history: state.history,
  };
}
