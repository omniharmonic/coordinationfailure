import { v4 as uuid } from 'uuid';
import { PlayerDb, type DbPlayer } from '../persistence/db-stores.js';

export type Player = DbPlayer;

/**
 * Player store backed by SQLite.
 * Players persist across server restarts.
 */
export class PlayerStore {
  constructor() {
    const count = PlayerDb.count();
    if (count > 0) console.log(`[CF] ${count} players in database`);
  }

  register(handle?: string, email?: string): Player {
    const finalHandle = handle ?? `player_${Math.random().toString(36).slice(2, 8)}`;
    return PlayerDb.register(uuid(), uuid(), finalHandle, email);
  }

  getByToken(token: string): Player | undefined {
    return PlayerDb.getByToken(token);
  }

  getById(id: string): Player | undefined {
    return PlayerDb.getById(id);
  }
}
