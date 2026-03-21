// Stag Hunt - N-player classic game theory engine

export type SHChoice = 'stag' | 'hare';

export interface SHConfig {
  rounds: number;
  min_players: number;
  max_players: number;
  stag_payoff: number;      // total payoff split among stag hunters if ALL choose stag
  hare_payoff: number;      // guaranteed payoff for choosing hare
  communication_rounds: boolean; // whether to allow communication between rounds
}

export interface SHMessage {
  player_id: string;
  round: number;
  message: string;
}

export interface SHRoundResult {
  round: number;
  choices: Record<string, SHChoice>;
  payoffs: Record<string, number>;
  stag_success: boolean;
}

export interface SHGameState {
  game_id: string;
  player_ids: string[];
  current_round: number;
  total_rounds: number;
  history: SHRoundResult[];
  scores: Record<string, number>;
  pending_choices: Record<string, SHChoice>;
  messages: SHMessage[];
  pending_messages: SHMessage[];
  complete: boolean;
  phase: 'communication' | 'decision' | 'resolved';
}

export interface SHPlayerView {
  player_id: string;
  current_round: number;
  total_rounds: number;
  player_count: number;
  history: SHRoundResult[];
  my_score: number;
  messages: SHMessage[];
  complete: boolean;
  phase: 'communication' | 'decision' | 'resolved';
}

const DEFAULT_SH_CONFIG: SHConfig = {
  rounds: 10,
  min_players: 2,
  max_players: 8,
  stag_payoff: 10,
  hare_payoff: 2,
  communication_rounds: false,
};

function createDefaultSHConfig(overrides?: Partial<SHConfig>): SHConfig {
  return { ...DEFAULT_SH_CONFIG, ...overrides };
}

export class StagHuntEngine {
  private games: Map<string, SHGameState> = new Map();
  private config: SHConfig;
  private nextGameId = 0;

  constructor(config?: Partial<SHConfig>) {
    this.config = createDefaultSHConfig(config);
  }

  createGame(playerIds: string[]): string {
    if (playerIds.length < this.config.min_players || playerIds.length > this.config.max_players) {
      throw new Error(`Player count must be between ${this.config.min_players} and ${this.config.max_players}`);
    }

    const gameId = `sh_${this.nextGameId++}`;
    const scores: Record<string, number> = {};
    for (const id of playerIds) {
      scores[id] = 0;
    }

    const state: SHGameState = {
      game_id: gameId,
      player_ids: [...playerIds],
      current_round: 1,
      total_rounds: this.config.rounds,
      history: [],
      scores,
      pending_choices: {},
      messages: [],
      pending_messages: [],
      complete: false,
      phase: this.config.communication_rounds ? 'communication' : 'decision',
    };

    this.games.set(gameId, state);
    return gameId;
  }

  submitMessage(gameId: string, playerId: string, message: string): void {
    const state = this.getGameState(gameId);
    if (!this.config.communication_rounds) {
      throw new Error('Communication rounds are not enabled');
    }
    if (state.phase !== 'communication') {
      throw new Error('Not in communication phase');
    }
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }
    const msg: SHMessage = { player_id: playerId, round: state.current_round, message };
    state.pending_messages.push(msg);
    state.messages.push(msg);
  }

  endCommunication(gameId: string): void {
    const state = this.getGameState(gameId);
    if (state.phase !== 'communication') {
      throw new Error('Not in communication phase');
    }
    state.phase = 'decision';
    state.pending_messages = [];
  }

  submitChoice(gameId: string, playerId: string, choice: SHChoice): void {
    const state = this.getGameState(gameId);
    if (state.complete) {
      throw new Error('Game is already complete');
    }
    if (state.phase !== 'decision') {
      throw new Error('Not in decision phase');
    }
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }
    if (state.pending_choices[playerId] !== undefined) {
      throw new Error(`Player ${playerId} has already submitted a choice this round`);
    }
    state.pending_choices[playerId] = choice;
  }

  resolveRound(gameId: string): SHRoundResult {
    const state = this.getGameState(gameId);

    for (const pid of state.player_ids) {
      if (state.pending_choices[pid] === undefined) {
        throw new Error(`All players must submit choices before resolving`);
      }
    }

    const choices = { ...state.pending_choices };
    const allChoseStag = state.player_ids.every(pid => choices[pid] === 'stag');
    const payoffs: Record<string, number> = {};

    for (const pid of state.player_ids) {
      if (choices[pid] === 'hare') {
        payoffs[pid] = this.config.hare_payoff;
      } else {
        // stag only pays off if everyone chose stag
        payoffs[pid] = allChoseStag ? this.config.stag_payoff / state.player_ids.length : 0;
      }
    }

    const result: SHRoundResult = {
      round: state.current_round,
      choices,
      payoffs,
      stag_success: allChoseStag,
    };

    state.history.push(result);
    for (const pid of state.player_ids) {
      state.scores[pid] += payoffs[pid];
    }
    state.pending_choices = {};
    state.current_round++;

    if (state.current_round > state.total_rounds) {
      state.complete = true;
      state.phase = 'resolved';
    } else {
      state.phase = this.config.communication_rounds ? 'communication' : 'decision';
    }

    return result;
  }

  getState(gameId: string, playerId: string): SHPlayerView {
    const state = this.getGameState(gameId);
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }

    return {
      player_id: playerId,
      current_round: state.current_round,
      total_rounds: state.total_rounds,
      player_count: state.player_ids.length,
      history: state.history,
      my_score: state.scores[playerId],
      messages: state.messages.filter(m => m.round <= state.current_round),
      complete: state.complete,
      phase: state.phase,
    };
  }

  isComplete(gameId: string): boolean {
    return this.getGameState(gameId).complete;
  }

  getScores(gameId: string): Record<string, number> {
    return { ...this.getGameState(gameId).scores };
  }

  private getGameState(gameId: string): SHGameState {
    const state = this.games.get(gameId);
    if (!state) {
      throw new Error(`Game ${gameId} not found`);
    }
    return state;
  }
}
