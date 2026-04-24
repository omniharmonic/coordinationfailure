/**
 * Stag Hunt — core game logic.
 *
 * Each round has an optional communication phase and a decision phase.
 * Stag pays out only if EVERY player chose stag (and is split evenly
 * across stag hunters). Hare pays out the safe amount regardless.
 *
 * The decision phase resolves as soon as all players submit, or when
 * the round timer fires and fills in the timeout default.
 */

import type { ActionResult } from '@coordination-games/engine';

import type {
  SHAction,
  SHChoice,
  SHConfig,
  SHMessage,
  SHPlayerState,
  SHRoundResult,
  SHState,
} from './types.js';

export function createInitialState(config: SHConfig): SHState {
  const players: SHPlayerState[] = config.playerIds.map((id) => ({
    id,
    score: 0,
    stagChoices: 0,
    hareChoices: 0,
  }));

  return {
    phase: 'waiting',
    roundPhase: 'resolved',
    round: 0,
    players,
    pendingChoices: {},
    pendingMessages: [],
    history: [],
    config,
  };
}

// ---------------------------------------------------------------------------
// validateAction
// ---------------------------------------------------------------------------

export function validateAction(
  state: SHState,
  playerId: string | null,
  action: SHAction,
): boolean {
  if (action.type === 'game_start') {
    return playerId === null && state.phase === 'waiting';
  }
  if (action.type === 'round_timeout') {
    return playerId === null && state.phase === 'playing';
  }
  if (action.type === 'end_communication') {
    return playerId === null && state.phase === 'playing' && state.roundPhase === 'communication';
  }

  if (playerId === null) return false;
  if (state.phase !== 'playing') return false;

  const player = state.players.find((p) => p.id === playerId);
  if (!player) return false;

  if (action.type === 'send_message') {
    if (!state.config.communication) return false;
    if (state.roundPhase !== 'communication') return false;
    if (typeof action.message !== 'string') return false;
    if (action.message.length === 0) return false;
    if (action.message.length > state.config.maxMessageLength) return false;
    return true;
  }

  if (action.type === 'submit_choice') {
    if (state.roundPhase !== 'decision') return false;
    if (action.choice !== 'stag' && action.choice !== 'hare') return false;
    if (state.pendingChoices[playerId] !== undefined) return false;
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// applyAction
// ---------------------------------------------------------------------------

export function applyAction(
  state: SHState,
  playerId: string | null,
  action: SHAction,
): ActionResult<SHState, SHAction> {
  if (action.type === 'game_start') {
    return startRound(state);
  }

  if (action.type === 'end_communication') {
    return beginDecisionPhase(state);
  }

  if (action.type === 'round_timeout') {
    // Route to whichever phase the timer was waiting on.
    if (state.roundPhase === 'communication') {
      return beginDecisionPhase(state);
    }
    // decision-phase timeout → fill defaults + resolve
    return resolveRound(fillTimeoutDefaults(state));
  }

  if (action.type === 'send_message' && playerId) {
    const msg: SHMessage = {
      round: state.round,
      playerId,
      message: action.message,
    };
    return {
      state: { ...state, pendingMessages: [...state.pendingMessages, msg] },
    };
  }

  if (action.type === 'submit_choice' && playerId) {
    const pendingChoices = { ...state.pendingChoices, [playerId]: action.choice };
    const newState: SHState = { ...state, pendingChoices };
    if (allPlayersSubmitted(newState)) {
      return resolveRound(newState);
    }
    return { state: newState };
  }

  return { state };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

function startRound(state: SHState): ActionResult<SHState, SHAction> {
  const round = state.round + 1;
  if (state.config.communication) {
    return {
      state: {
        ...state,
        phase: 'playing',
        roundPhase: 'communication',
        round,
        pendingChoices: {},
        pendingMessages: [],
      },
      deadline: {
        seconds: state.config.communicationSeconds,
        action: { type: 'round_timeout' },
      },
    };
  }
  return {
    state: {
      ...state,
      phase: 'playing',
      roundPhase: 'decision',
      round,
      pendingChoices: {},
      pendingMessages: [],
    },
    deadline: {
      seconds: state.config.decisionSeconds,
      action: { type: 'round_timeout' },
    },
  };
}

function beginDecisionPhase(state: SHState): ActionResult<SHState, SHAction> {
  return {
    state: { ...state, roundPhase: 'decision' },
    deadline: {
      seconds: state.config.decisionSeconds,
      action: { type: 'round_timeout' },
    },
  };
}

function resolveRound(state: SHState): ActionResult<SHState, SHAction> {
  const choices = { ...state.pendingChoices };
  const allStag = state.players.every((p) => choices[p.id] === 'stag');
  const stagShare = allStag ? state.config.stagPayoff / state.players.length : 0;

  const payoffs: Record<string, number> = {};
  for (const p of state.players) {
    payoffs[p.id] = choices[p.id] === 'stag' ? stagShare : state.config.harePayoff;
  }

  const players: SHPlayerState[] = state.players.map((p) => ({
    ...p,
    score: p.score + payoffs[p.id],
    stagChoices: p.stagChoices + (choices[p.id] === 'stag' ? 1 : 0),
    hareChoices: p.hareChoices + (choices[p.id] === 'hare' ? 1 : 0),
  }));

  const roundResult: SHRoundResult = {
    round: state.round,
    choices,
    payoffs,
    stagSuccess: allStag,
    messages: state.pendingMessages,
  };

  const finished = state.round >= state.config.rounds;
  const resolved: SHState = {
    ...state,
    players,
    pendingChoices: {},
    pendingMessages: [],
    roundPhase: 'resolved',
    history: [...state.history, roundResult],
  };

  if (finished) {
    return {
      state: { ...resolved, phase: 'finished' },
      deadline: null,
      progressIncrement: true,
    };
  }

  // Start next round immediately
  const next = startRound(resolved);
  return { ...next, progressIncrement: true };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allPlayersSubmitted(state: SHState): boolean {
  return state.players.every((p) => state.pendingChoices[p.id] !== undefined);
}

function fillTimeoutDefaults(state: SHState): SHState {
  const pendingChoices = { ...state.pendingChoices };
  for (const p of state.players) {
    if (pendingChoices[p.id] === undefined) {
      pendingChoices[p.id] = state.config.timeoutDefault;
    }
  }
  return { ...state, pendingChoices };
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

export interface SHAgentView {
  phase: SHState['phase'];
  roundPhase: SHState['roundPhase'];
  round: number;
  totalRounds: number;
  yourScore: number;
  yourChoice: SHChoice | null;
  yourSubmitted: boolean;
  players: {
    id: string;
    score: number;
    submitted: boolean;
  }[];
  /**
   * Messages in the current round's communication phase. All players see all
   * messages (stag hunt is about signaling intent).
   */
  currentMessages: SHMessage[];
  history: SHRoundResult[];
  config: Omit<SHConfig, 'seed' | 'playerIds'>;
}

export interface SHSpectatorView {
  phase: SHState['phase'];
  roundPhase: SHState['roundPhase'];
  round: number;
  totalRounds: number;
  players: {
    id: string;
    score: number;
    stagChoices: number;
    hareChoices: number;
    hasSubmitted: boolean;
  }[];
  currentMessages: SHMessage[];
  history: SHRoundResult[];
}

export function getAgentView(state: SHState, playerId: string): SHAgentView | null {
  const me = state.players.find((p) => p.id === playerId);
  if (!me) return null;

  return {
    phase: state.phase,
    roundPhase: state.roundPhase,
    round: state.round,
    totalRounds: state.config.rounds,
    yourScore: me.score,
    yourChoice: state.pendingChoices[me.id] ?? null,
    yourSubmitted: state.pendingChoices[me.id] !== undefined,
    players: state.players.map((p) => ({
      id: p.id,
      score: p.score,
      submitted: state.pendingChoices[p.id] !== undefined,
    })),
    currentMessages: state.pendingMessages,
    history: state.history,
    config: {
      rounds: state.config.rounds,
      stagPayoff: state.config.stagPayoff,
      harePayoff: state.config.harePayoff,
      communication: state.config.communication,
      communicationSeconds: state.config.communicationSeconds,
      decisionSeconds: state.config.decisionSeconds,
      maxMessageLength: state.config.maxMessageLength,
      timeoutDefault: state.config.timeoutDefault,
      entryCost: state.config.entryCost,
    },
  };
}

export function getSpectatorView(state: SHState): SHSpectatorView {
  return {
    phase: state.phase,
    roundPhase: state.roundPhase,
    round: state.round,
    totalRounds: state.config.rounds,
    players: state.players.map((p) => ({
      id: p.id,
      score: p.score,
      stagChoices: p.stagChoices,
      hareChoices: p.hareChoices,
      hasSubmitted: state.pendingChoices[p.id] !== undefined,
    })),
    currentMessages: state.pendingMessages,
    history: state.history,
  };
}
