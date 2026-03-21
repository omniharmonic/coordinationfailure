/**
 * Unified persistence layer.
 * Uses Postgres (Neon) when DATABASE_URL is set, falls back to SQLite for local dev.
 */

const USE_PG = !!process.env.DATABASE_URL;

export async function initDb() {
  if (USE_PG) {
    const { getPgPool, runPgMigrations } = await import('./pg-database.js');
    getPgPool(); // Initialize connection
    await runPgMigrations();
    console.log('[CF] Using Postgres (Neon) for persistence');
  } else {
    const { getDb } = await import('./database.js');
    getDb(); // Initialize SQLite
    console.log('[CF] Using SQLite for local persistence');
  }
}

export async function closeAllDb() {
  if (USE_PG) {
    const { closePg } = await import('./pg-database.js');
    await closePg();
  } else {
    const { closeDb } = await import('./database.js');
    closeDb();
  }
}

// ─── Unified store interface ────────────────────────────────────────────

export const db = {
  players: {
    async register(id: string, token: string, handle: string, email?: string, model?: string) {
      if (USE_PG) {
        const { PgPlayerDb } = await import('./pg-database.js');
        return PgPlayerDb.register(id, token, handle, email, model);
      }
      const { PlayerDb } = await import('./db-stores.js');
      return PlayerDb.register(id, token, handle, email, model);
    },
    async getByToken(token: string) {
      if (USE_PG) {
        const { PgPlayerDb } = await import('./pg-database.js');
        return PgPlayerDb.getByToken(token);
      }
      const { PlayerDb } = await import('./db-stores.js');
      return PlayerDb.getByToken(token);
    },
    async getById(id: string) {
      if (USE_PG) {
        const { PgPlayerDb } = await import('./pg-database.js');
        return PgPlayerDb.getById(id);
      }
      const { PlayerDb } = await import('./db-stores.js');
      return PlayerDb.getById(id);
    },
    async count() {
      if (USE_PG) {
        const { PgPlayerDb } = await import('./pg-database.js');
        return PgPlayerDb.count();
      }
      const { PlayerDb } = await import('./db-stores.js');
      return PlayerDb.count();
    },
  },

  completedGames: {
    async add(meta: { game_id: string; outcome: string; tick_count: number; time_speed: string; player_count: number; date: string }) {
      if (USE_PG) {
        const { PgCompletedGameDb } = await import('./pg-database.js');
        return PgCompletedGameDb.add(meta);
      }
      const { CompletedGameDb } = await import('./db-stores.js');
      return CompletedGameDb.add(meta);
    },
    async list() {
      if (USE_PG) {
        const { PgCompletedGameDb } = await import('./pg-database.js');
        return PgCompletedGameDb.list();
      }
      const { CompletedGameDb } = await import('./db-stores.js');
      return CompletedGameDb.list();
    },
  },

  reports: {
    async save(gameId: string, report: any) {
      if (USE_PG) {
        const { PgReportDb } = await import('./pg-database.js');
        return PgReportDb.save(gameId, report);
      }
      const { ReportDb } = await import('./db-stores.js');
      return ReportDb.save(gameId, report);
    },
    async get(gameId: string) {
      if (USE_PG) {
        const { PgReportDb } = await import('./pg-database.js');
        return PgReportDb.get(gameId);
      }
      const { ReportDb } = await import('./db-stores.js');
      return ReportDb.get(gameId);
    },
  },

  debriefs: {
    async save(gameId: string, debriefs: any[]) {
      if (USE_PG) {
        const { PgDebriefDb } = await import('./pg-database.js');
        return PgDebriefDb.save(gameId, debriefs);
      }
      const { DebriefDb } = await import('./db-stores.js');
      return DebriefDb.save(gameId, debriefs);
    },
    async get(gameId: string) {
      if (USE_PG) {
        const { PgDebriefDb } = await import('./pg-database.js');
        return PgDebriefDb.get(gameId);
      }
      const { DebriefDb } = await import('./db-stores.js');
      return DebriefDb.get(gameId);
    },
  },

  knowledge: {
    async upsert(pattern: { id: string; type: string; description: string; supporting_games: string[]; confidence: number; created_at: string }) {
      if (USE_PG) {
        const { PgKnowledgeDb } = await import('./pg-database.js');
        return PgKnowledgeDb.upsert(pattern);
      }
      const { KnowledgeDb } = await import('./db-stores.js');
      return KnowledgeDb.upsert(pattern);
    },
    async getAll(filter?: { type?: string; limit?: number }) {
      if (USE_PG) {
        const { PgKnowledgeDb } = await import('./pg-database.js');
        return PgKnowledgeDb.getAll(filter);
      }
      const { KnowledgeDb } = await import('./db-stores.js');
      return KnowledgeDb.getAll(filter);
    },
    async getById(id: string) {
      if (USE_PG) {
        const { PgKnowledgeDb } = await import('./pg-database.js');
        return PgKnowledgeDb.getById(id);
      }
      const { KnowledgeDb } = await import('./db-stores.js');
      return KnowledgeDb.getById(id);
    },
  },

  leaderboard: {
    async record(playerId: string, handle: string, roleId: string, score: number, outcome: string, gameId: string, model?: string) {
      if (USE_PG) {
        const { PgLeaderboardDb } = await import('./pg-database.js');
        return PgLeaderboardDb.record(playerId, handle, roleId, score, outcome, gameId, model);
      }
      const { LeaderboardDb } = await import('./db-stores.js');
      return LeaderboardDb.record(playerId, handle, roleId, score, outcome, gameId, model);
    },
    async getLeaderboard(sortBy?: string, limit?: number) {
      if (USE_PG) {
        const { PgLeaderboardDb } = await import('./pg-database.js');
        return PgLeaderboardDb.getLeaderboard(sortBy, limit);
      }
      const { LeaderboardDb } = await import('./db-stores.js');
      return LeaderboardDb.getLeaderboard(sortBy, limit);
    },
    async getModelLeaderboard() {
      if (USE_PG) {
        const { PgLeaderboardDb } = await import('./pg-database.js');
        return PgLeaderboardDb.getModelLeaderboard();
      }
      const { LeaderboardDb } = await import('./db-stores.js');
      return LeaderboardDb.getModelLeaderboard();
    },
  },
};
