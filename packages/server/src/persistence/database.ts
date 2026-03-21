import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../../../..', 'data');
const DB_PATH = path.join(DATA_DIR, 'coordination-failure.db');

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
    console.log(`[CF] SQLite database: ${DB_PATH}`);
  }
  return db;
}

function initSchema() {
  db.exec(`
    -- Players (persistent accounts)
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      handle TEXT UNIQUE,
      email TEXT,
      elo INTEGER DEFAULT 1200,
      games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Completed games (metadata)
    CREATE TABLE IF NOT EXISTS completed_games (
      game_id TEXT PRIMARY KEY,
      outcome TEXT NOT NULL,
      tick_count INTEGER DEFAULT 0,
      time_speed TEXT DEFAULT 'sprint',
      player_count INTEGER DEFAULT 0,
      date TEXT DEFAULT (datetime('now'))
    );

    -- Game reports (full JSON)
    CREATE TABLE IF NOT EXISTS game_reports (
      game_id TEXT PRIMARY KEY,
      report_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Agent debriefs (full JSON per game)
    CREATE TABLE IF NOT EXISTS game_debriefs (
      game_id TEXT PRIMARY KEY,
      debriefs_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Knowledge base patterns
    CREATE TABLE IF NOT EXISTS knowledge_patterns (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      supporting_games TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Leaderboard entries
    CREATE TABLE IF NOT EXISTS leaderboard (
      player_id TEXT PRIMARY KEY,
      handle TEXT,
      elo INTEGER DEFAULT 1200,
      games_played INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      total_score REAL DEFAULT 0,
      avg_score REAL DEFAULT 0,
      best_score REAL DEFAULT 0,
      game_history TEXT DEFAULT '[]'
    );

    -- Match history (per-player per-game)
    CREATE TABLE IF NOT EXISTS match_players (
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      outcome TEXT,
      PRIMARY KEY (game_id, player_id)
    );

    CREATE INDEX IF NOT EXISTS idx_players_token ON players(token);
    CREATE INDEX IF NOT EXISTS idx_players_handle ON players(handle);
    CREATE INDEX IF NOT EXISTS idx_leaderboard_elo ON leaderboard(elo DESC);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    console.log('[CF] Database closed.');
  }
}
