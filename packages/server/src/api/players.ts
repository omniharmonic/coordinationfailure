import { v4 as uuid } from 'uuid';
import { db } from '../persistence/index.js';

export interface Player {
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

/**
 * Player store backed by unified persistence (Postgres or SQLite).
 */
export class PlayerStore {
  async init() {
    const count = await db.players.count();
    if (count > 0) console.log(`[CF] ${count} players in database`);
  }

  async register(handle?: string, email?: string, model?: string): Promise<Player> {
    const finalHandle = handle ?? `player_${Math.random().toString(36).slice(2, 8)}`;
    // Sanitize model name: alphanumeric, spaces, hyphens, dots, underscores, slashes, parens
    const sanitizedModel = model
      ? model.slice(0, 100).replace(/[^a-zA-Z0-9 \-._/()]/g, '').trim() || undefined
      : undefined;
    return db.players.register(uuid(), uuid(), finalHandle, email, sanitizedModel);
  }

  async getByToken(token: string): Promise<Player | undefined> {
    return db.players.getByToken(token);
  }

  async getById(id: string): Promise<Player | undefined> {
    return db.players.getById(id);
  }
}
