import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../..', 'data');
const COMPLETED_GAMES_FILE = path.join(DATA_DIR, 'completed-games.json');

export interface CompletedGameMeta {
  game_id: string;
  outcome: string;
  tick_count: number;
  date: string;
  time_speed: string;
  player_count: number;
}

/**
 * Persistent store for completed game metadata.
 * Games survive server restarts via a JSON file, similar to PlayerStore.
 */
export class CompletedGameStore {
  private games: CompletedGameMeta[] = [];
  private index = new Set<string>(); // game_id lookup for dedup

  constructor() {
    this.load();
  }

  add(meta: CompletedGameMeta): void {
    if (this.index.has(meta.game_id)) return; // already stored
    this.games.push(meta);
    this.index.add(meta.game_id);
    this.save();
  }

  list(): CompletedGameMeta[] {
    return [...this.games];
  }

  /** Save to disk */
  private save(): void {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(COMPLETED_GAMES_FILE, JSON.stringify(this.games, null, 2));
    } catch (e) {
      console.error('[CF] Failed to save completed games:', e);
    }
  }

  /** Load from disk */
  private load(): void {
    try {
      if (!fs.existsSync(COMPLETED_GAMES_FILE)) return;
      const data: CompletedGameMeta[] = JSON.parse(fs.readFileSync(COMPLETED_GAMES_FILE, 'utf8'));
      for (const g of data) {
        if (!this.index.has(g.game_id)) {
          this.games.push(g);
          this.index.add(g.game_id);
        }
      }
      console.log(`[CF] Loaded ${data.length} completed games from disk`);
    } catch (e) {
      console.error('[CF] Failed to load completed games:', e);
    }
  }
}
