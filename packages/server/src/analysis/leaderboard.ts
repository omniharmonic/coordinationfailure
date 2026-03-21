import type { GameOutcome } from '@cf/engine';

export interface LeaderboardEntry {
  player_id: string;
  handle: string;
  games_played: number;
  wins: number;
  total_score: number;
  avg_score: number;
  best_score: number;
  elo: number;
}

export interface GameResult {
  game_id: string;
  role_id: string;
  score: number;
  outcome: GameOutcome | null;
  played_at: Date;
}

export interface PlayerProfile extends LeaderboardEntry {
  game_history: GameResult[];
}

const ELO_K = 32;
const DEFAULT_ELO = 1200;

export class LeaderboardStore {
  private entries = new Map<string, LeaderboardEntry>();
  private gameHistory = new Map<string, GameResult[]>();

  recordGameResult(
    playerId: string,
    handle: string,
    roleId: string,
    score: number,
    outcome: GameOutcome | null,
    gameId: string,
  ): void {
    // Initialize entry if needed
    if (!this.entries.has(playerId)) {
      this.entries.set(playerId, {
        player_id: playerId,
        handle,
        games_played: 0,
        wins: 0,
        total_score: 0,
        avg_score: 0,
        best_score: 0,
        elo: DEFAULT_ELO,
      });
    }
    if (!this.gameHistory.has(playerId)) {
      this.gameHistory.set(playerId, []);
    }

    const entry = this.entries.get(playerId)!;

    // Determine if this is a "win" — aligned_agi or stable_world are positive outcomes
    const isWin = outcome === 'aligned_agi' || outcome === 'stable_world';

    // Update stats
    entry.games_played++;
    if (isWin) entry.wins++;
    entry.total_score += score;
    entry.avg_score = entry.total_score / entry.games_played;
    entry.best_score = Math.max(entry.best_score, score);
    entry.handle = handle; // Update in case it changed

    // ELO calculation: compare actual result vs expected
    // Actual score: 1 for win, 0.5 for draw (timeout), 0 for loss
    const actualScore = isWin ? 1.0 : outcome === 'timeout' ? 0.5 : 0.0;
    // Expected score based on current ELO vs average (1200)
    const expectedScore = 1 / (1 + Math.pow(10, (DEFAULT_ELO - entry.elo) / 400));
    entry.elo = Math.round(entry.elo + ELO_K * (actualScore - expectedScore));

    // Record game history
    this.gameHistory.get(playerId)!.push({
      game_id: gameId,
      role_id: roleId,
      score,
      outcome,
      played_at: new Date(),
    });
  }

  getLeaderboard(sortBy: 'elo' | 'score' | 'wins' = 'elo', limit: number = 20): LeaderboardEntry[] {
    const entries = Array.from(this.entries.values());

    entries.sort((a, b) => {
      switch (sortBy) {
        case 'elo':
          return b.elo - a.elo;
        case 'score':
          return b.avg_score - a.avg_score;
        case 'wins':
          return b.wins - a.wins;
        default:
          return b.elo - a.elo;
      }
    });

    return entries.slice(0, limit);
  }

  getPlayerProfile(playerId: string): PlayerProfile | null {
    const entry = this.entries.get(playerId);
    if (!entry) return null;

    return {
      ...entry,
      game_history: this.gameHistory.get(playerId) ?? [],
    };
  }
}
