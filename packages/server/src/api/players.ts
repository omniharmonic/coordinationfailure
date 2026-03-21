import { v4 as uuid } from 'uuid';
import { db } from '../persistence/index.js';

export interface Player {
  id: string;
  token: string;
  handle: string;
  email?: string;
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

  async register(handle?: string, email?: string): Promise<Player> {
    const finalHandle = handle ?? `player_${Math.random().toString(36).slice(2, 8)}`;
    return db.players.register(uuid(), uuid(), finalHandle, email);
  }

  async getByToken(token: string): Promise<Player | undefined> {
    return db.players.getByToken(token);
  }

  async getById(id: string): Promise<Player | undefined> {
    return db.players.getById(id);
  }
}
