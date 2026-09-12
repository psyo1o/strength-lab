import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function databasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");
}

function applySchema(raw: Database.Database) {
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'kg',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_maxes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exercise_key TEXT NOT NULL,
      one_rm_kg REAL NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, exercise_key)
    );
    CREATE TABLE IF NOT EXISTS exercises (
      key TEXT PRIMARY KEY,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      "group" TEXT NOT NULL,
      is_max INTEGER NOT NULL DEFAULT 0,
      tips_ko TEXT NOT NULL DEFAULT '',
      tips_en TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS programs (
      slug TEXT PRIMARY KEY,
      name_ko TEXT NOT NULL,
      name_en TEXT NOT NULL,
      category TEXT NOT NULL,
      completeness TEXT NOT NULL,
      description_ko TEXT NOT NULL,
      description_en TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS program_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_slug TEXT NOT NULL REFERENCES programs(slug) ON DELETE CASCADE,
      week_number INTEGER NOT NULL,
      name_ko TEXT NOT NULL,
      notes_ko TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS program_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
      day_number INTEGER NOT NULL,
      name_ko TEXT NOT NULL,
      notes_ko TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS program_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES program_days(id) ON DELETE CASCADE,
      exercise_key TEXT NOT NULL,
      role TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes_ko TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS program_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_id INTEGER NOT NULL REFERENCES program_exercises(id) ON DELETE CASCADE,
      set_number INTEGER NOT NULL,
      percent_base TEXT NOT NULL,
      percent REAL,
      reps INTEGER NOT NULL,
      amrap INTEGER NOT NULL DEFAULT 0,
      rest_sec INTEGER,
      note_ko TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS set_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_set_id INTEGER NOT NULL REFERENCES program_sets(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 1,
      completed_at INTEGER NOT NULL,
      UNIQUE(user_id, program_set_id)
    );
  `);
}

export function getSqlite(): Database.Database {
  if (sqlite) return sqlite;
  const file = databasePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  sqlite = new Database(file);
  applySchema(sqlite);
  seedIfEmpty(sqlite);
  return sqlite;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  if (db) return db;
  db = drizzle(getSqlite(), { schema });
  return db;
}

export function resetDbConnection() {
  if (sqlite) {
    sqlite.close();
  }
  sqlite = null;
  db = null;
}
