// Tragedy of the Commons - N-player resource management game theory engine

export interface TCConfig {
  rounds: number;
  min_players: number;
  max_players: number;
  initial_resource: number;
  capacity: number;
  growth_rate: number;        // logistic regeneration rate
  min_extraction: number;     // minimum extraction rate per player
  max_extraction: number;     // maximum extraction rate per player
}

export interface TCRoundResult {
  round: number;
  extractions: Record<string, number>;  // player_id -> extraction rate
  payoffs: Record<string, number>;
  resource_before: number;
  resource_after: number;
  total_extraction_rate: number;
}

export interface TCGameState {
  game_id: string;
  player_ids: string[];
  current_round: number;
  total_rounds: number;
  resource_level: number;
  capacity: number;
  history: TCRoundResult[];
  scores: Record<string, number>;
  pending_extractions: Record<string, number>;
  complete: boolean;
  ended_by_depletion: boolean;
}

export interface TCPlayerView {
  player_id: string;
  current_round: number;
  total_rounds: number;
  player_count: number;
  resource_level: number;
  capacity: number;
  history: TCRoundResult[];
  my_score: number;
  complete: boolean;
  ended_by_depletion: boolean;
}

const DEFAULT_TC_CONFIG: TCConfig = {
  rounds: 20,
  min_players: 2,
  max_players: 8,
  initial_resource: 100,
  capacity: 100,
  growth_rate: 1.5,
  min_extraction: 0.0,
  max_extraction: 1.0,
};

function createDefaultTCConfig(overrides?: Partial<TCConfig>): TCConfig {
  return { ...DEFAULT_TC_CONFIG, ...overrides };
}

export class TragedyOfCommonsEngine {
  private games: Map<string, TCGameState> = new Map();
  private config: TCConfig;
  private nextGameId = 0;

  constructor(config?: Partial<TCConfig>) {
    this.config = createDefaultTCConfig(config);
  }

  createGame(playerIds: string[]): string {
    if (playerIds.length < this.config.min_players || playerIds.length > this.config.max_players) {
      throw new Error(`Player count must be between ${this.config.min_players} and ${this.config.max_players}`);
    }

    const gameId = `tc_${this.nextGameId++}`;
    const scores: Record<string, number> = {};
    for (const id of playerIds) {
      scores[id] = 0;
    }

    const state: TCGameState = {
      game_id: gameId,
      player_ids: [...playerIds],
      current_round: 1,
      total_rounds: this.config.rounds,
      resource_level: this.config.initial_resource,
      capacity: this.config.capacity,
      history: [],
      scores,
      pending_extractions: {},
      complete: false,
      ended_by_depletion: false,
    };

    this.games.set(gameId, state);
    return gameId;
  }

  submitChoice(gameId: string, playerId: string, extractionRate: number): void {
    const state = this.getGameState(gameId);
    if (state.complete) {
      throw new Error('Game is already complete');
    }
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }
    if (state.pending_extractions[playerId] !== undefined) {
      throw new Error(`Player ${playerId} has already submitted an extraction rate this round`);
    }
    if (extractionRate < this.config.min_extraction || extractionRate > this.config.max_extraction) {
      throw new Error(`Extraction rate must be between ${this.config.min_extraction} and ${this.config.max_extraction}`);
    }
    state.pending_extractions[playerId] = extractionRate;
  }

  resolveRound(gameId: string): TCRoundResult {
    const state = this.getGameState(gameId);

    for (const pid of state.player_ids) {
      if (state.pending_extractions[pid] === undefined) {
        throw new Error('All players must submit extraction rates before resolving');
      }
    }

    const n = state.player_ids.length;
    const extractions = { ...state.pending_extractions };
    const resourceBefore = state.resource_level;

    // Calculate payoffs: extraction_rate * resource_level / N
    const payoffs: Record<string, number> = {};
    let totalExtractionRate = 0;

    for (const pid of state.player_ids) {
      const rate = extractions[pid];
      totalExtractionRate += rate;
      payoffs[pid] = rate * state.resource_level / n;
    }

    // Resource regeneration with logistic growth
    // new_level = resource * (1 - total_extraction) * growth_rate * (1 - resource/capacity)
    const afterExtraction = state.resource_level * (1 - totalExtractionRate / n);
    const newResource = Math.max(
      0,
      afterExtraction * this.config.growth_rate * (1 - afterExtraction / this.config.capacity)
    );

    const result: TCRoundResult = {
      round: state.current_round,
      extractions,
      payoffs,
      resource_before: resourceBefore,
      resource_after: newResource,
      total_extraction_rate: totalExtractionRate,
    };

    state.history.push(result);
    for (const pid of state.player_ids) {
      state.scores[pid] += payoffs[pid];
    }

    state.resource_level = newResource;
    state.pending_extractions = {};
    state.current_round++;

    // Check end conditions
    if (state.resource_level <= 0.01) {
      state.resource_level = 0;
      state.complete = true;
      state.ended_by_depletion = true;
    } else if (state.current_round > state.total_rounds) {
      state.complete = true;
    }

    return result;
  }

  getState(gameId: string, playerId: string): TCPlayerView {
    const state = this.getGameState(gameId);
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }

    return {
      player_id: playerId,
      current_round: state.current_round,
      total_rounds: state.total_rounds,
      player_count: state.player_ids.length,
      resource_level: state.resource_level,
      capacity: state.capacity,
      history: state.history,
      my_score: state.scores[playerId],
      complete: state.complete,
      ended_by_depletion: state.ended_by_depletion,
    };
  }

  isComplete(gameId: string): boolean {
    return this.getGameState(gameId).complete;
  }

  getScores(gameId: string): Record<string, number> {
    return { ...this.getGameState(gameId).scores };
  }

  getResourceLevel(gameId: string): number {
    return this.getGameState(gameId).resource_level;
  }

  private getGameState(gameId: string): TCGameState {
    const state = this.games.get(gameId);
    if (!state) {
      throw new Error(`Game ${gameId} not found`);
    }
    return state;
  }
}
