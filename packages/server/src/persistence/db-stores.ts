import { getDb } from './database.js';

// ─── Players ────────────────────────────────────────────────────────────

export interface DbPlayer {
  id: string;
  token: string;
  handle: string;
  email?: string;
  model?: string;
  elo: number;
  games_played: number;
  wins: number;
  created_at: string;
}

export const PlayerDb = {
  register(id: string, token: string, handle: string, email?: string, model?: string): DbPlayer {
    const db = getDb();
    // Return existing player if handle matches (update model if provided)
    const existing = db.prepare('SELECT * FROM players WHERE handle = ?').get(handle) as DbPlayer | undefined;
    if (existing) {
      if (model && model !== existing.model) {
        db.prepare('UPDATE players SET model = ? WHERE id = ?').run(model, existing.id);
        existing.model = model;
      }
      return existing;
    }

    const player: DbPlayer = { id, token, handle, email: email ?? null as any, model: model ?? null as any, elo: 1200, games_played: 0, wins: 0, created_at: new Date().toISOString() };
    db.prepare('INSERT OR IGNORE INTO players (id, token, handle, email, model, elo, games_played, wins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      player.id, player.token, player.handle, player.email, player.model, player.elo, player.games_played, player.wins, player.created_at
    );
    return player;
  },

  getByToken(token: string): DbPlayer | undefined {
    return getDb().prepare('SELECT * FROM players WHERE token = ?').get(token) as DbPlayer | undefined;
  },

  getById(id: string): DbPlayer | undefined {
    return getDb().prepare('SELECT * FROM players WHERE id = ?').get(id) as DbPlayer | undefined;
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) as c FROM players').get() as { c: number };
    return row.c;
  },
};

// ─── Completed Games ────────────────────────────────────────────────────

export interface CompletedGameMeta {
  game_id: string;
  outcome: string;
  tick_count: number;
  time_speed: string;
  player_count: number;
  date: string;
}

export const CompletedGameDb = {
  add(meta: CompletedGameMeta) {
    const db = getDb();
    db.prepare('INSERT OR REPLACE INTO completed_games (game_id, outcome, tick_count, time_speed, player_count, date) VALUES (?, ?, ?, ?, ?, ?)').run(
      meta.game_id, meta.outcome, meta.tick_count, meta.time_speed, meta.player_count, meta.date
    );
  },

  list(): CompletedGameMeta[] {
    return getDb().prepare('SELECT * FROM completed_games ORDER BY date DESC').all() as CompletedGameMeta[];
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) as c FROM completed_games').get() as { c: number };
    return row.c;
  },
};

// ─── Reports ────────────────────────────────────────────────────────────

export const ReportDb = {
  save(gameId: string, report: any) {
    getDb().prepare('INSERT OR REPLACE INTO game_reports (game_id, report_json) VALUES (?, ?)').run(
      gameId, JSON.stringify(report)
    );
  },

  get(gameId: string): any | null {
    const row = getDb().prepare('SELECT report_json FROM game_reports WHERE game_id = ?').get(gameId) as { report_json: string } | undefined;
    return row ? JSON.parse(row.report_json) : null;
  },
};

// ─── Debriefs ───────────────────────────────────────────────────────────

export const DebriefDb = {
  save(gameId: string, debriefs: any[]) {
    getDb().prepare('INSERT OR REPLACE INTO game_debriefs (game_id, debriefs_json) VALUES (?, ?)').run(
      gameId, JSON.stringify(debriefs)
    );
  },

  get(gameId: string): any[] | null {
    const row = getDb().prepare('SELECT debriefs_json FROM game_debriefs WHERE game_id = ?').get(gameId) as { debriefs_json: string } | undefined;
    return row ? JSON.parse(row.debriefs_json) : null;
  },
};

// ─── Knowledge Base ─────────────────────────────────────────────────────

export interface DbPattern {
  id: string;
  type: string;
  description: string;
  supporting_games: string; // JSON array
  confidence: number;
  created_at: string;
}

export const KnowledgeDb = {
  upsert(pattern: { id: string; type: string; description: string; supporting_games: string[]; confidence: number; created_at: string }) {
    getDb().prepare('INSERT OR REPLACE INTO knowledge_patterns (id, type, description, supporting_games, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      pattern.id, pattern.type, pattern.description, JSON.stringify(pattern.supporting_games), pattern.confidence, pattern.created_at
    );
  },

  getAll(filter?: { type?: string; limit?: number }): any[] {
    let sql = 'SELECT * FROM knowledge_patterns';
    const params: any[] = [];
    if (filter?.type) { sql += ' WHERE type = ?'; params.push(filter.type); }
    sql += ' ORDER BY confidence DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    const rows = getDb().prepare(sql).all(...params) as DbPattern[];
    return rows.map(r => ({ ...r, supporting_games: JSON.parse(r.supporting_games) }));
  },

  getById(id: string): any | null {
    const row = getDb().prepare('SELECT * FROM knowledge_patterns WHERE id = ?').get(id) as DbPattern | undefined;
    return row ? { ...row, supporting_games: JSON.parse(row.supporting_games) } : null;
  },

  count(): number {
    const row = getDb().prepare('SELECT COUNT(*) as c FROM knowledge_patterns').get() as { c: number };
    return row.c;
  },
};

// ─── Leaderboard ────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  player_id: string;
  handle: string;
  model?: string;
  elo: number;
  games_played: number;
  wins: number;
  total_score: number;
  avg_score: number;
  best_score: number;
  game_history: string; // JSON
}

export const LeaderboardDb = {
  record(playerId: string, handle: string, roleId: string, score: number, outcome: string, gameId: string, model?: string) {
    const db = getDb();

    // Get or create leaderboard entry
    let entry = db.prepare('SELECT * FROM leaderboard WHERE player_id = ?').get(playerId) as LeaderboardEntry | undefined;

    const isWin = outcome === 'aligned_agi' || outcome === 'stable_world';
    const K = 32;
    const expectedScore = 1 / (1 + Math.pow(10, (1200 - (entry?.elo ?? 1200)) / 400));
    const actualScore = isWin ? 1 : outcome === 'timeout' ? 0.5 : 0;
    const newElo = Math.round((entry?.elo ?? 1200) + K * (actualScore - expectedScore));

    const gamesPlayed = (entry?.games_played ?? 0) + 1;
    const wins = (entry?.wins ?? 0) + (isWin ? 1 : 0);
    const totalScore = (entry?.total_score ?? 0) + score;
    const avgScore = totalScore / gamesPlayed;
    const bestScore = Math.max(entry?.best_score ?? 0, score);

    const history = entry ? JSON.parse(entry.game_history) : [];
    history.push({ game_id: gameId, role_id: roleId, score, outcome });

    db.prepare(`INSERT OR REPLACE INTO leaderboard (player_id, handle, model, elo, games_played, wins, total_score, avg_score, best_score, game_history)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      playerId, handle, model ?? entry?.model ?? null, newElo, gamesPlayed, wins, totalScore, avgScore, bestScore, JSON.stringify(history)
    );

    // Also record in match_players (with model for per-game model tracking)
    db.prepare('INSERT OR REPLACE INTO match_players (game_id, player_id, role_id, score, outcome, model) VALUES (?, ?, ?, ?, ?, ?)').run(
      gameId, playerId, roleId, score, outcome, model ?? null
    );
  },

  getLeaderboard(sortBy: string = 'elo', limit: number = 20): any[] {
    const orderCol = sortBy === 'score' ? 'total_score' : sortBy === 'wins' ? 'wins' : 'elo';
    const rows = getDb().prepare(`SELECT * FROM leaderboard ORDER BY ${orderCol} DESC LIMIT ?`).all(limit) as LeaderboardEntry[];
    return rows.map(r => ({ ...r, game_history: JSON.parse(r.game_history) }));
  },

  getPlayer(playerId: string): any | null {
    const row = getDb().prepare('SELECT * FROM leaderboard WHERE player_id = ?').get(playerId) as LeaderboardEntry | undefined;
    return row ? { ...row, game_history: JSON.parse(row.game_history) } : null;
  },

  reset() {
    getDb().prepare('DELETE FROM leaderboard').run();
    getDb().prepare('DELETE FROM match_players').run();
  },

  getModelLeaderboard(): any[] {
    const rows = getDb().prepare(`
      SELECT model,
        COUNT(*) as games_played,
        SUM(CASE WHEN outcome IN ('aligned_agi', 'stable_world') THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(score), 1) as avg_score,
        MAX(score) as best_score,
        COUNT(DISTINCT player_id) as unique_players
      FROM match_players
      WHERE model IS NOT NULL AND model != ''
      GROUP BY model
      ORDER BY avg_score DESC
    `).all();
    return rows;
  },
};
