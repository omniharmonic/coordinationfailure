import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? '';

let pool: pg.Pool | null = null;

export function getPgPool(): pg.Pool {
  if (!pool) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable not set');
    }
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
    console.log('[CF] Connected to Postgres (Neon)');
  }
  return pool;
}

export async function closePg() {
  if (pool) {
    await pool.end();
    console.log('[CF] Postgres connection closed.');
  }
}

// ─── Players ────────────────────────────────────────────────────────────

export const PgPlayerDb = {
  async register(id: string, token: string, handle: string, email?: string, model?: string) {
    const p = getPgPool();
    // Check if handle exists (update model if provided)
    const existing = await p.query('SELECT * FROM players WHERE handle = $1', [handle]);
    if (existing.rows.length > 0) {
      if (model && model !== existing.rows[0].model) {
        await p.query('UPDATE players SET model = $1 WHERE id = $2', [model, existing.rows[0].id]);
        existing.rows[0].model = model;
      }
      return existing.rows[0];
    }

    await p.query(
      'INSERT INTO players (id, token, handle, email, model) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
      [id, token, handle, email ?? null, model ?? null]
    );
    const result = await p.query('SELECT * FROM players WHERE id = $1', [id]);
    return result.rows[0];
  },

  async getByToken(token: string) {
    const result = await getPgPool().query('SELECT * FROM players WHERE token = $1', [token]);
    return result.rows[0] ?? undefined;
  },

  async getById(id: string) {
    const result = await getPgPool().query('SELECT * FROM players WHERE id = $1', [id]);
    return result.rows[0] ?? undefined;
  },

  async count(): Promise<number> {
    const result = await getPgPool().query('SELECT COUNT(*) as c FROM players');
    return parseInt(result.rows[0].c, 10);
  },
};

// ─── Completed Games ────────────────────────────────────────────────────

export const PgCompletedGameDb = {
  async add(meta: { game_id: string; outcome: string; tick_count: number; time_speed: string; player_count: number; date: string }) {
    await getPgPool().query(
      'INSERT INTO completed_games (game_id, outcome, tick_count, time_speed, player_count, date) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (game_id) DO UPDATE SET outcome=$2, tick_count=$3',
      [meta.game_id, meta.outcome, meta.tick_count, meta.time_speed, meta.player_count, meta.date]
    );
  },

  async list() {
    const result = await getPgPool().query('SELECT * FROM completed_games ORDER BY date DESC');
    return result.rows;
  },
};

// ─── Reports ────────────────────────────────────────────────────────────

export const PgReportDb = {
  async save(gameId: string, report: any) {
    await getPgPool().query(
      'INSERT INTO game_reports (game_id, report_json) VALUES ($1, $2) ON CONFLICT (game_id) DO UPDATE SET report_json=$2',
      [gameId, JSON.stringify(report)]
    );
  },

  async get(gameId: string) {
    const result = await getPgPool().query('SELECT report_json FROM game_reports WHERE game_id = $1', [gameId]);
    return result.rows[0]?.report_json ?? null;
  },
};

// ─── Debriefs ───────────────────────────────────────────────────────────

export const PgDebriefDb = {
  async save(gameId: string, debriefs: any[]) {
    await getPgPool().query(
      'INSERT INTO game_debriefs (game_id, debriefs_json) VALUES ($1, $2) ON CONFLICT (game_id) DO UPDATE SET debriefs_json=$2',
      [gameId, JSON.stringify(debriefs)]
    );
  },

  async get(gameId: string) {
    const result = await getPgPool().query('SELECT debriefs_json FROM game_debriefs WHERE game_id = $1', [gameId]);
    return result.rows[0]?.debriefs_json ?? null;
  },
};

// ─── Knowledge Base ─────────────────────────────────────────────────────

export const PgKnowledgeDb = {
  async upsert(pattern: { id: string; type: string; description: string; supporting_games: string[]; confidence: number; created_at: string }) {
    await getPgPool().query(
      'INSERT INTO knowledge_patterns (id, type, description, supporting_games, confidence, created_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO UPDATE SET supporting_games=$4, confidence=$5',
      [pattern.id, pattern.type, pattern.description, JSON.stringify(pattern.supporting_games), pattern.confidence, pattern.created_at]
    );
  },

  async getAll(filter?: { type?: string; limit?: number }) {
    let sql = 'SELECT * FROM knowledge_patterns';
    const params: any[] = [];
    if (filter?.type) { sql += ' WHERE type = $1'; params.push(filter.type); }
    sql += ' ORDER BY confidence DESC';
    if (filter?.limit) { sql += ` LIMIT $${params.length + 1}`; params.push(filter.limit); }
    const result = await getPgPool().query(sql, params);
    return result.rows.map(r => ({
      ...r,
      supporting_games: typeof r.supporting_games === 'string' ? JSON.parse(r.supporting_games) : r.supporting_games,
    }));
  },

  async getById(id: string) {
    const result = await getPgPool().query('SELECT * FROM knowledge_patterns WHERE id = $1', [id]);
    const row = result.rows[0];
    if (!row) return null;
    return { ...row, supporting_games: typeof row.supporting_games === 'string' ? JSON.parse(row.supporting_games) : row.supporting_games };
  },
};

// ─── Leaderboard ────────────────────────────────────────────────────────

export const PgLeaderboardDb = {
  async record(playerId: string, handle: string, roleId: string, score: number, outcome: string, gameId: string, model?: string) {
    const p = getPgPool();
    const existing = await p.query('SELECT * FROM leaderboard WHERE player_id = $1', [playerId]);
    const entry = existing.rows[0];

    const isWin = outcome === 'aligned_agi' || outcome === 'stable_world';
    const K = 32;
    const currentElo = entry?.elo ?? 1200;
    const expectedScore = 1 / (1 + Math.pow(10, (1200 - currentElo) / 400));
    const actualScore = isWin ? 1 : outcome === 'timeout' ? 0.5 : 0;
    const newElo = Math.round(currentElo + K * (actualScore - expectedScore));

    const gamesPlayed = (entry?.games_played ?? 0) + 1;
    const wins = (entry?.wins ?? 0) + (isWin ? 1 : 0);
    const totalScore = (entry?.total_score ?? 0) + score;
    const avgScore = totalScore / gamesPlayed;
    const bestScore = Math.max(entry?.best_score ?? 0, score);
    const history = entry?.game_history ?? [];
    if (Array.isArray(history)) history.push({ game_id: gameId, role_id: roleId, score, outcome });

    await p.query(
      `INSERT INTO leaderboard (player_id, handle, model, elo, games_played, wins, total_score, avg_score, best_score, game_history)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (player_id) DO UPDATE SET model=COALESCE($3, leaderboard.model), elo=$4, games_played=$5, wins=$6, total_score=$7, avg_score=$8, best_score=$9, game_history=$10`,
      [playerId, handle, model ?? null, newElo, gamesPlayed, wins, totalScore, avgScore, bestScore, JSON.stringify(history)]
    );

    await p.query(
      'INSERT INTO match_players (game_id, player_id, role_id, score, outcome, model) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (game_id, player_id) DO NOTHING',
      [gameId, playerId, roleId, score, outcome, model ?? null]
    );
  },

  async getLeaderboard(sortBy: string = 'elo', limit: number = 20) {
    const orderCol = sortBy === 'score' ? 'total_score' : sortBy === 'wins' ? 'wins' : 'elo';
    const result = await getPgPool().query(`SELECT * FROM leaderboard ORDER BY ${orderCol} DESC LIMIT $1`, [limit]);
    return result.rows.map(r => ({
      ...r,
      game_history: typeof r.game_history === 'string' ? JSON.parse(r.game_history) : r.game_history,
    }));
  },

  async getModelLeaderboard() {
    const result = await getPgPool().query(`
      SELECT model,
        COUNT(*) as games_played,
        SUM(CASE WHEN outcome IN ('aligned_agi', 'stable_world') THEN 1 ELSE 0 END) as wins,
        ROUND(AVG(score)::numeric, 1) as avg_score,
        MAX(score) as best_score,
        COUNT(DISTINCT player_id) as unique_players
      FROM match_players
      WHERE model IS NOT NULL AND model != ''
      GROUP BY model
      ORDER BY avg_score DESC
    `);
    return result.rows;
  },
};
