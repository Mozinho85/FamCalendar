const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/events.db');

// Ensure the directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL mode - critical for SD card / USB drive longevity.
// WAL batches writes and dramatically reduces wear vs the default journal mode.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = 1000');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS family_members (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      color       TEXT NOT NULL DEFAULT '#8b6fde',
      google_refresh_token TEXT,
      google_calendar_ids  TEXT DEFAULT '[]',
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      start_datetime  TEXT NOT NULL,
      end_datetime    TEXT NOT NULL,
      all_day         INTEGER NOT NULL DEFAULT 0,
      member_id       TEXT,
      color           TEXT,
      location        TEXT,
      notes           TEXT,
      source          TEXT NOT NULL DEFAULT 'local',
      google_event_id TEXT,
      google_cal_id   TEXT,
      recurrence_rule TEXT,
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (member_id) REFERENCES family_members(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS google_sync_state (
      member_id    TEXT NOT NULL,
      calendar_id  TEXT NOT NULL,
      sync_token   TEXT,
      last_sync    TEXT,
      PRIMARY KEY (member_id, calendar_id),
      FOREIGN KEY (member_id) REFERENCES family_members(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_events_start    ON events(start_datetime);
    CREATE INDEX IF NOT EXISTS idx_events_member   ON events(member_id);
    CREATE INDEX IF NOT EXISTS idx_events_source   ON events(source);
    CREATE INDEX IF NOT EXISTS idx_events_google   ON events(google_event_id);
  `);

  // Seed default family members if table is empty
  const count = db.prepare('SELECT COUNT(*) as c FROM family_members').get();
  if (count.c === 0) {
    const insert = db.prepare(
      'INSERT INTO family_members (id, name, color) VALUES (?, ?, ?)'
    );
    const members = [
      ['member-1', 'Mum',  '#e2719a'],
      ['member-2', 'Dad',  '#4fc3a1'],
      ['member-3', 'Ella', '#f0a040'],
      ['member-4', 'Noah', '#5ab4e8'],
    ];
    members.forEach(m => insert.run(...m));
    console.log('Seeded default family members — edit them via the phone UI');
  }

  console.log(`Database ready at ${DB_PATH}`);
}

migrate();

module.exports = db;
