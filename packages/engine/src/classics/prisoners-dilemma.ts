// Prisoner's Dilemma - Classic iterated game theory engine

export type PDChoice = 'cooperate' | 'defect';

export interface PDPayoffMatrix {
  both_cooperate: [number, number];
  both_defect: [number, number];
  p1_defects: [number, number]; // [defector payoff, cooperator payoff]
}

export interface PDConfig {
  rounds: number;
  payoff_matrix: PDPayoffMatrix;
}

export interface PDRoundResult {
  round: number;
  choices: Record<string, PDChoice>;
  payoffs: Record<string, number>;
}

export interface PDGameState {
  player_ids: [string, string];
  current_round: number;
  total_rounds: number;
  history: PDRoundResult[];
  scores: Record<string, number>;
  pending_choices: Record<string, PDChoice>;
  complete: boolean;
}

export interface PDPlayerView {
  player_id: string;
  current_round: number;
  total_rounds: number;
  history: PDRoundResult[];
  my_score: number;
  opponent_score: number;
  complete: boolean;
}

export interface PDTournamentResult {
  standings: { player_id: string; total_score: number; games_played: number; avg_score: number }[];
  match_results: { players: [string, string]; scores: Record<string, number> }[];
}

const DEFAULT_PAYOFF_MATRIX: PDPayoffMatrix = {
  both_cooperate: [3, 3],
  both_defect: [1, 1],
  p1_defects: [5, 0],
};

function createDefaultPDConfig(overrides?: Partial<PDConfig>): PDConfig {
  return {
    rounds: 100,
    payoff_matrix: DEFAULT_PAYOFF_MATRIX,
    ...overrides,
  };
}

export class PrisonersDilemmaEngine {
  private games: Map<string, PDGameState> = new Map();
  private config: PDConfig;

  constructor(config?: Partial<PDConfig>) {
    this.config = createDefaultPDConfig(config);
  }

  createGame(player1: string, player2: string): string {
    const gameId = `pd_${player1}_${player2}`;
    const state: PDGameState = {
      player_ids: [player1, player2],
      current_round: 1,
      total_rounds: this.config.rounds,
      history: [],
      scores: { [player1]: 0, [player2]: 0 },
      pending_choices: {},
      complete: false,
    };
    this.games.set(gameId, state);
    return gameId;
  }

  submitChoice(gameId: string, playerId: string, choice: PDChoice): void {
    const state = this.getGameState(gameId);
    if (state.complete) {
      throw new Error('Game is already complete');
    }
    if (!state.player_ids.includes(playerId)) {
      throw new Error(`Player ${playerId} is not in this game`);
    }
    if (state.pending_choices[playerId] !== undefined) {
      throw new Error(`Player ${playerId} has already submitted a choice this round`);
    }
    state.pending_choices[playerId] = choice;
  }

  resolveRound(gameId: string): PDRoundResult {
    const state = this.getGameState(gameId);
    const [p1, p2] = state.player_ids;

    if (state.pending_choices[p1] === undefined || state.pending_choices[p2] === undefined) {
      throw new Error('Both players must submit choices before resolving');
    }

    const c1 = state.pending_choices[p1];
    const c2 = state.pending_choices[p2];
    const payoffs = this.calculatePayoffs(c1, c2, p1, p2);

    const result: PDRoundResult = {
      round: state.current_round,
      choices: { [p1]: c1, [p2]: c2 },
      payoffs,
    };

    state.history.push(result);
    state.scores[p1] += payoffs[p1];
    state.scores[p2] += payoffs[p2];
    state.pending_choices = {};
    state.current_round++;

    if (state.current_round > state.total_rounds) {
      state.complete = true;
    }

    return result;
  }

  getState(gameId: string, playerId: string): PDPlayerView {
    const state = this.getGameState(gameId);
    const [p1, p2] = state.player_ids;
    const opponentId = playerId === p1 ? p2 : p1;

    return {
      player_id: playerId,
      current_round: state.current_round,
      total_rounds: state.total_rounds,
      history: state.history,
      my_score: state.scores[playerId],
      opponent_score: state.scores[opponentId],
      complete: state.complete,
    };
  }

  isComplete(gameId: string): boolean {
    return this.getGameState(gameId).complete;
  }

  getScores(gameId: string): Record<string, number> {
    return { ...this.getGameState(gameId).scores };
  }

  runTournament(playerIds: string[], strategies: Record<string, (history: PDRoundResult[], playerId: string) => PDChoice>): PDTournamentResult {
    const totalScores: Record<string, number> = {};
    const gamesPlayed: Record<string, number> = {};
    const matchResults: PDTournamentResult['match_results'] = [];

    for (const id of playerIds) {
      totalScores[id] = 0;
      gamesPlayed[id] = 0;
    }

    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const p1 = playerIds[i];
        const p2 = playerIds[j];
        const gameId = this.createGame(p1, p2);

        while (!this.isComplete(gameId)) {
          const state = this.getGameState(gameId);
          const c1 = strategies[p1](state.history, p1);
          const c2 = strategies[p2](state.history, p2);
          this.submitChoice(gameId, p1, c1);
          this.submitChoice(gameId, p2, c2);
          this.resolveRound(gameId);
        }

        const scores = this.getScores(gameId);
        totalScores[p1] += scores[p1];
        totalScores[p2] += scores[p2];
        gamesPlayed[p1]++;
        gamesPlayed[p2]++;
        matchResults.push({ players: [p1, p2], scores });
      }
    }

    const standings = playerIds
      .map(id => ({
        player_id: id,
        total_score: totalScores[id],
        games_played: gamesPlayed[id],
        avg_score: gamesPlayed[id] > 0 ? totalScores[id] / gamesPlayed[id] : 0,
      }))
      .sort((a, b) => b.total_score - a.total_score);

    return { standings, match_results: matchResults };
  }

  private getGameState(gameId: string): PDGameState {
    const state = this.games.get(gameId);
    if (!state) {
      throw new Error(`Game ${gameId} not found`);
    }
    return state;
  }

  private calculatePayoffs(c1: PDChoice, c2: PDChoice, p1: string, p2: string): Record<string, number> {
    const matrix = this.config.payoff_matrix;

    if (c1 === 'cooperate' && c2 === 'cooperate') {
      return { [p1]: matrix.both_cooperate[0], [p2]: matrix.both_cooperate[1] };
    }
    if (c1 === 'defect' && c2 === 'defect') {
      return { [p1]: matrix.both_defect[0], [p2]: matrix.both_defect[1] };
    }
    if (c1 === 'defect' && c2 === 'cooperate') {
      return { [p1]: matrix.p1_defects[0], [p2]: matrix.p1_defects[1] };
    }
    // c1 cooperate, c2 defect
    return { [p1]: matrix.p1_defects[1], [p2]: matrix.p1_defects[0] };
  }
}
