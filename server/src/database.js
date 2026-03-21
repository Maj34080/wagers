const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(path.join(dataDir, 'wagers.db'));

db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      balance REAL DEFAULT 100.00,
      created_at TEXT DEFAULT (datetime('now')),
      avatar_color TEXT DEFAULT '#7c3aed'
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      captain_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (captain_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      PRIMARY KEY (team_id, user_id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS wagers (
      id TEXT PRIMARY KEY,
      team1_id TEXT,
      team2_id TEXT,
      buy_in_per_player REAL NOT NULL,
      total_pot REAL DEFAULT 0,
      status TEXT DEFAULT 'open',
      winner_team_id TEXT,
      game_mode TEXT DEFAULT 'CvC Standard',
      map_name TEXT DEFAULT 'Los Santos',
      created_at TEXT DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (team1_id) REFERENCES teams(id),
      FOREIGN KEY (team2_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS wager_players (
      wager_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      team_id TEXT NOT NULL,
      paid INTEGER DEFAULT 0,
      PRIMARY KEY (wager_id, user_id),
      FOREIGN KEY (wager_id) REFERENCES wagers(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      wager_id TEXT NOT NULL,
      match_number INTEGER NOT NULL,
      team1_score INTEGER DEFAULT 0,
      team2_score INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (wager_id) REFERENCES wagers(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount REAL NOT NULL,
      type TEXT NOT NULL,
      reference_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  console.log('✅ Database initialized successfully');
};

initDb();

// Add new columns if they don't exist (migration)
const alterColumns = [
  "ALTER TABLE users ADD COLUMN discord_id TEXT",
  "ALTER TABLE users ADD COLUMN discord_username TEXT",
  "ALTER TABLE users ADD COLUMN discord_avatar TEXT",
  "ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"
];
for (const sql of alterColumns) {
  try { db.exec(sql); } catch (e) { /* column already exists */ }
}

module.exports = db;
