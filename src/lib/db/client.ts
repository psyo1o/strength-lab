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
      current_program TEXT,
      last_session TEXT,
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
  `);
  const userCols = raw.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  const names = new Set(userCols.map((c) => c.name));
  if (!names.has("current_program")) raw.exec("ALTER TABLE users ADD COLUMN current_program TEXT");
  if (!names.has("last_session")) raw.exec("ALTER TABLE users ADD COLUMN last_session TEXT");
  const maxCols = raw.prepare("PRAGMA table_info(user_maxes)").all() as { name: string }[];
  if (!maxCols.some((c) => c.name === "start_kg")) {
    raw.exec("ALTER TABLE user_maxes ADD COLUMN start_kg REAL");
  }
  const exCols = new Set(
    (raw.prepare("PRAGMA table_info(exercises)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!exCols.has("tips_ko")) raw.exec("ALTER TABLE exercises ADD COLUMN tips_ko TEXT NOT NULL DEFAULT ''");
  if (!exCols.has("tips_en")) raw.exec("ALTER TABLE exercises ADD COLUMN tips_en TEXT NOT NULL DEFAULT ''");
  if (!exCols.has("name_en")) raw.exec("ALTER TABLE exercises ADD COLUMN name_en TEXT NOT NULL DEFAULT ''");
  if (!exCols.has("is_max")) raw.exec("ALTER TABLE exercises ADD COLUMN is_max INTEGER NOT NULL DEFAULT 0");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS set_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      program_set_id INTEGER NOT NULL REFERENCES program_sets(id) ON DELETE CASCADE,
      completed INTEGER NOT NULL DEFAULT 1,
      completed_at INTEGER NOT NULL,
      UNIQUE(user_id, program_set_id)
    );
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_throttle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      throttle_key TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS auth_throttle_key_at ON auth_throttle (throttle_key, created_at);
    CREATE TABLE IF NOT EXISTS wod_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      template_slug TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      tier TEXT NOT NULL DEFAULT 'rx',
      score_type TEXT NOT NULL,
      time_sec INTEGER,
      rounds INTEGER,
      extra_reps INTEGER,
      notes_ko TEXT NOT NULL DEFAULT '',
      scale_notes TEXT NOT NULL DEFAULT '',
      substitutions TEXT NOT NULL DEFAULT '',
      equipment_json TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS wod_results_user_at ON wod_results (user_id, completed_at);
    CREATE INDEX IF NOT EXISTS wod_results_user_slug ON wod_results (user_id, template_slug, completed_at);
    -- Unused leftover table. Kept so NAS DBs are not migrated/wiped. No UI reads it.
    CREATE TABLE IF NOT EXISTS user_equipment (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      box_height_cm REAL,
      wall_ball_kg REAL,
      wall_ball_target_m REAL,
      du_rope TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `);
  const logCols = new Set(
    (raw.prepare("PRAGMA table_info(set_logs)").all() as { name: string }[]).map((c) => c.name),
  );
  if (!logCols.has("weight_kg")) raw.exec("ALTER TABLE set_logs ADD COLUMN weight_kg REAL");
  raw.exec("CREATE INDEX IF NOT EXISTS set_logs_user_at ON set_logs (user_id, completed_at)");
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
