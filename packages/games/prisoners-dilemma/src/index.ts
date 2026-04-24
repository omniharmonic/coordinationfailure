export {
  PrisonersDilemmaPlugin,
  PRISONERS_DILEMMA_SYSTEM_ACTION_TYPES,
  computeZeroSumPayouts,
} from './plugin.js';

export {
  createInitialState,
  validateAction,
  applyAction,
  getAgentView,
  getSpectatorView,
} from './game.js';

export type { PDAgentView, PDSpectatorView } from './game.js';

export {
  DEFAULT_PD_CONFIG,
} from './types.js';

export type {
  PDChoice,
  PDAction,
  PDConfig,
  PDPayoffMatrix,
  PDPlayerState,
  PDPlayerRanking,
  PDRoundResult,
  PDState,
  PDOutcome,
  SubmitChoiceAction,
  GameStartAction,
  RoundTimeoutAction,
} from './types.js';
