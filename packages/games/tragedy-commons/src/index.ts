export { TragedyCommonsPlugin, TRAGEDY_COMMONS_SYSTEM_ACTION_TYPES } from './plugin.js';
export {
  createInitialState,
  validateAction,
  applyAction,
  getAgentView,
  getSpectatorView,
} from './game.js';
export type { TCAgentView, TCSpectatorView } from './game.js';
export { DEFAULT_TC_CONFIG } from './types.js';
export type {
  TCAction,
  TCConfig,
  TCRoundResult,
  TCPlayerState,
  TCPlayerRanking,
  TCState,
  TCOutcome,
  GameStartAction,
  RoundTimeoutAction,
  SetExtractionAction,
} from './types.js';
