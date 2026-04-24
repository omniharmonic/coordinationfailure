/**
 * Prisoner's Dilemma — core game logic.
 *
 * Pure, deterministic functions. Iterated 2-player PD where each round
 * both players simultaneously submit a C/D choice. Round resolves when
 * all players have submitted (or the round timer fires and fills in
 * the configured timeout default).
 */

import type { ActionResult } from '@coordination-games/engine';

import type {
  PDAction,
  PDChoice,
  PDConfig,
  PDPayoffMatrix,
  PDPlayerState,
  PDRoundResult,
  PDState,
} from './types.js';

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function createInitialState(config: PDConfig): PDState {
  const players: PDPlayerState[] = config.playerIds.map((id) => ({
    id,
    score: 0,
    cooperations: 0,
    defections: 0,
  }));

  return {
    phase: 'waiting',
    round: 0,
    players,
    pendingChoices: {},
    history: [],
    config,
  };
}

// ---------------------------------------------------------------------------
// Validate an action
// ---------------------------------------------------------------------------

export function validateAction(
  state: PDState,
  playerId: string | null,
  action: PDAction,
): boolean {
  if (action.type === 'game_start') {
    return playerId === null && state.phase === 'waiting';
  }
  if (action.type === 'round_timeout') {
    return playerId === null && state.phase === 'playing';
  }

  // Player actions
  if (playerId === null) return false;
  if (state.phase !== 'playing') return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  if (action.type === 'submit_choice') {
    if (action.choice !== 'cooperate' && action.choice !== 'defect') return false;
    if (state.pendingChoices[playerId] !== undefined) return false;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Apply action — THE CORE
// ---------------------------------------------------------------------------

export function applyAction(
  state: PDState,
  playerId: string | null,
  action: PDAction,
): ActionResult<PDState, PDAction> {
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
    const filled = fillTimeoutDefaults(state);
    return resolveRound(filled);
  }

  if (action.type === 'submit_choice' && playerId) {
    const pendingChoices = { ...state.pendingChoices, [playerId]: action.choice };
    const newState: PDState = { ...state, pendingChoices };

    if (allPlayersSubmitted(newState)) {
      return resolveRound(newState);
    }
    return { state: newState };
  }

  return { state };
}

// ---------------------------------------------------------------------------
// Resolve a round — apply payoffs, advance or finish
// ---------------------------------------------------------------------------

function resolveRound(state: PDState): ActionResult<PDState, PDAction> {
  const choices = { ...state.pendingChoices };
  const payoffs = computeRoundPayoffs(state.players, choices, state.config.payoffs);

  const players: PDPlayerState[] = state.players.map((p) => ({
    ...p,
    score: p.score + payoffs[p.id],
    cooperations: p.cooperations + (choices[p.id] === 'cooperate' ? 1 : 0),
    defections: p.defections + (choices[p.id] === 'defect' ? 1 : 0),
  }));

  const roundResult: PDRoundResult = {
    round: state.round,
    choices,
    payoffs,
  };

  const nextRound = state.round + 1;
  const finished = nextRound > state.config.rounds;

  const resolved: PDState = {
    ...state,
    players,
    pendingChoices: {},
    history: [...state.history, roundResult],
    round: finished ? state.round : nextRound,
    phase: finished ? 'finished' : 'playing',
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

function allPlayersSubmitted(state: PDState): boolean {
  return state.players.every((p) => state.pendingChoices[p.id] !== undefined);
}

function fillTimeoutDefaults(state: PDState): PDState {
  const pendingChoices = { ...state.pendingChoices };
  for (const p of state.players) {
    if (pendingChoices[p.id] === undefined) {
      pendingChoices[p.id] = state.config.timeoutDefault;
    }
  }
  return { ...state, pendingChoices };
}

function computeRoundPayoffs(
  players: PDPlayerState[],
  choices: Record<string, PDChoice>,
  matrix: PDPayoffMatrix,
): Record<string, number> {
  const payoffs: Record<string, number> = {};

  if (players.length === 2) {
    const [p1, p2] = players;
    const c1 = choices[p1.id];
    const c2 = choices[p2.id];
    const [pay1, pay2] = pairPayoff(c1, c2, matrix);
    payoffs[p1.id] = pay1;
    payoffs[p2.id] = pay2;
    return payoffs;
  }

  // General N-player variant: each player plays against every other player
  // using the standard 2-player matrix, payoffs are averaged.
  for (const me of players) {
    let total = 0;
    for (const other of players) {
      if (other.id === me.id) continue;
      const [mine] = pairPayoff(choices[me.id], choices[other.id], matrix);
      total += mine;
    }
    payoffs[me.id] = total / (players.length - 1);
  }
  return payoffs;
}

function pairPayoff(
  c1: PDChoice,
  c2: PDChoice,
  m: PDPayoffMatrix,
): [number, number] {
  if (c1 === 'cooperate' && c2 === 'cooperate') return [m.R, m.R];
  if (c1 === 'defect' && c2 === 'defect') return [m.P, m.P];
  if (c1 === 'defect' && c2 === 'cooperate') return [m.T, m.S];
  return [m.S, m.T];
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface PDAgentView {
  round: number;
  totalRounds: number;
  phase: PDState['phase'];
  yourScore: number;
  yourSubmitted: boolean;
  yourChoice: PDChoice | null;
  opponents: { id: string; score: number; submitted: boolean }[];
  history: PDRoundResult[];
  config: Omit<PDConfig, 'seed' | 'playerIds'>;
}

export interface PDSpectatorView {
  round: number;
  totalRounds: number;
  phase: PDState['phase'];
  players: {
    id: string;
    score: number;
    cooperations: number;
    defections: number;
    cooperationRate: number;
    hasSubmitted: boolean;
  }[];
  /**
   * Spectator-visible history. Only past rounds (current round's pending
   * choices are hidden).
   */
  history: PDRoundResult[];
}

export function getAgentView(state: PDState, playerId: string): PDAgentView | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;

  return {
    round: state.round,
    totalRounds: state.config.rounds,
    phase: state.phase,
    yourScore: me.score,
    yourSubmitted: state.pendingChoices[me.id] !== undefined,
    yourChoice: state.pendingChoices[me.id] ?? null,
    opponents: state.players
      .filter((p) => p.id !== me.id)
      .map((p) => ({
        id: p.id,
        score: p.score,
        submitted: state.pendingChoices[p.id] !== undefined,
      })),
    history: state.history,
    config: {
      rounds: state.config.rounds,
      payoffs: state.config.payoffs,
      turnTimerSeconds: state.config.turnTimerSeconds,
      timeoutDefault: state.config.timeoutDefault,
      entryCost: state.config.entryCost,
    },
  };
}

export function getSpectatorView(state: PDState): PDSpectatorView {
  return {
    round: state.round,
    totalRounds: state.config.rounds,
    phase: state.phase,
    players: state.players.map((p) => {
      const total = p.cooperations + p.defections;
      return {
        id: p.id,
        score: p.score,
        cooperations: p.cooperations,
        defections: p.defections,
        cooperationRate: total > 0 ? p.cooperations / total : 0,
        hasSubmitted: state.pendingChoices[p.id] !== undefined,
      };
    }),
    history: state.history,
  };
}
