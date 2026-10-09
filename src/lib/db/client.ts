import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { FIRST_ADMIN_EMAIL } from "../first-admin";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

let sqlite: Database.Database | null = null;
let db: BetterSQLite3Database<typeof schema> | null = null;

export function databasePath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), "data", "app.db");
}

/** Grants the first admin only when nobody is an admin. Does not delete rows. */
function promoteFirstAdminIfNone(raw: Database.Database) {
  const count = raw.prepare("SELECT COUNT(*) AS c FROM users WHERE is_admin = 1").get() as { c: number };
  if (count.c > 0) return;
  raw.prepare("UPDATE users SET is_admin = 1 WHERE lower(email) = ?").run(FIRST_ADMIN_EMAIL);
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
  if (!names.has("sex")) raw.exec("ALTER TABLE users ADD COLUMN sex TEXT");
  if (!names.has("is_admin")) raw.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  promoteFirstAdminIfNone(raw);
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
  raw.exec(`
    CREATE TABLE IF NOT EXISTS month_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      week_index INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      sex TEXT,
      plan_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS month_plans_user_created ON month_plans (user_id, created_at);
    CREATE TABLE IF NOT EXISTS month_plan_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES month_plans(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      time_sec INTEGER,
      rounds INTEGER,
      extra_reps INTEGER,
      piece_key TEXT NOT NULL DEFAULT '',
      piece_name_ko TEXT NOT NULL DEFAULT '',
      named INTEGER NOT NULL DEFAULT 0,
      signature TEXT NOT NULL DEFAULT '',
      notes_ko TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS month_plan_scores_user_at ON month_plan_scores (user_id, completed_at);
    CREATE INDEX IF NOT EXISTS month_plan_scores_user_sig ON month_plan_scores (user_id, signature, completed_at);
    CREATE INDEX IF NOT EXISTS month_plan_scores_user_piece ON month_plan_scores (user_id, piece_key, completed_at);
    CREATE TABLE IF NOT EXISTS class_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_index INTEGER NOT NULL,
      week_start TEXT NOT NULL UNIQUE,
      sex TEXT,
      plan_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS class_day_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      class_week_id INTEGER NOT NULL REFERENCES class_weeks(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      completed_at INTEGER NOT NULL,
      time_sec INTEGER,
      rounds INTEGER,
      extra_reps INTEGER,
      piece_key TEXT NOT NULL DEFAULT '',
      piece_name_ko TEXT NOT NULL DEFAULT '',
      named INTEGER NOT NULL DEFAULT 0,
      signature TEXT NOT NULL DEFAULT '',
      notes_ko TEXT NOT NULL DEFAULT '',
      scaling TEXT NOT NULL DEFAULT '',
      fatigue INTEGER
    );
    CREATE INDEX IF NOT EXISTS class_day_scores_user ON class_day_scores (user_id, class_week_id, day_key);
    CREATE TABLE IF NOT EXISTS programming_months (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_start TEXT NOT NULL,
      scheme TEXT NOT NULL,
      direction_json TEXT NOT NULL,
      input_summary_json TEXT NOT NULL,
      prior_evaluation_id INTEGER,
      generation_source TEXT NOT NULL,
      fallback_reason TEXT,
      generated_at INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'failed')),
      generation_version INTEGER NOT NULL DEFAULT 1,
      generation_attempt INTEGER NOT NULL DEFAULT 1,
      model_name TEXT,
      prompt_version TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      generation_timestamp INTEGER NOT NULL,
      input_summary_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programming_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_id INTEGER NOT NULL REFERENCES programming_months(id),
      week_index INTEGER NOT NULL,
      week_start TEXT NOT NULL,
      class_week_id INTEGER REFERENCES class_weeks(id),
      intent_json TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      display_json TEXT NOT NULL,
      input_summary_json TEXT NOT NULL,
      generation_source TEXT NOT NULL,
      fallback_reason TEXT,
      generated_at INTEGER NOT NULL,
      engine_version TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'failed')),
      generation_version INTEGER NOT NULL DEFAULT 1,
      generation_attempt INTEGER NOT NULL DEFAULT 1,
      model_name TEXT,
      prompt_version TEXT NOT NULL,
      rules_version TEXT NOT NULL,
      generation_timestamp INTEGER NOT NULL,
      input_summary_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programming_actuals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL UNIQUE REFERENCES programming_weeks(id) ON DELETE CASCADE,
      actual_json TEXT NOT NULL,
      recorded_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programming_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_id INTEGER NOT NULL UNIQUE REFERENCES programming_months(id) ON DELETE CASCADE,
      evaluation_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wod_structures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      week_id INTEGER NOT NULL REFERENCES programming_weeks(id) ON DELETE CASCADE,
      day_key TEXT NOT NULL,
      format TEXT NOT NULL,
      time_domain TEXT NOT NULL,
      stimulus TEXT,
      movement_patterns TEXT NOT NULL,
      movements TEXT NOT NULL,
      equipment TEXT NOT NULL,
      rep_structure TEXT NOT NULL,
      work_rest_structure TEXT NOT NULL,
      duration_min INTEGER NOT NULL,
      volume TEXT NOT NULL,
      intensity TEXT NOT NULL,
      benchmark INTEGER NOT NULL DEFAULT 0,
      long_conditioning INTEGER NOT NULL DEFAULT 0,
      UNIQUE(week_id, day_key)
    );
    CREATE INDEX IF NOT EXISTS programming_weeks_month ON programming_weeks (month_id, week_start);
    CREATE TABLE IF NOT EXISTS programming_generation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL CHECK (scope IN ('month', 'week')),
      scope_key TEXT NOT NULL,
      plan_id INTEGER,
      generation_attempt INTEGER NOT NULL,
      prompt_version TEXT NOT NULL,
      model_name TEXT,
      raw_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      latency_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS programming_generation_logs_scope
      ON programming_generation_logs (scope, scope_key, id);
  `);
  migrateProgrammingGenerations(raw);
  ensureProgrammingActiveIndexes(raw);
  if (!tableColumns(raw, "programming_generation_logs").has("latency_ms")) {
    raw.exec("ALTER TABLE programming_generation_logs ADD COLUMN latency_ms INTEGER");
  }
  const scoreCols = new Set(
    (raw.prepare("PRAGMA table_info(class_day_scores)").all() as { name: string }[]).map((column) => column.name),
  );
  if (!scoreCols.has("scaling")) {
    raw.exec("ALTER TABLE class_day_scores ADD COLUMN scaling TEXT NOT NULL DEFAULT ''");
  }
  if (!scoreCols.has("fatigue")) raw.exec("ALTER TABLE class_day_scores ADD COLUMN fatigue INTEGER");
  raw.exec(`
    CREATE TABLE IF NOT EXISTS programming_syncs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      programming_week_id INTEGER NOT NULL REFERENCES programming_weeks(id) ON DELETE CASCADE,
      class_week_id INTEGER NOT NULL REFERENCES class_weeks(id),
      synced_at INTEGER NOT NULL,
      replaced_days TEXT NOT NULL,
      kept_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS programming_month_proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      month_id INTEGER NOT NULL REFERENCES programming_months(id),
      proposal_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at INTEGER NOT NULL
    );
  `);
}

function tableColumns(raw: Database.Database, table: string): Set<string> {
  const rows = raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

/** True when a column is unique for every row, not only for status = 'active'. */
function unconditionalUnique(raw: Database.Database, table: string, column: string): boolean {
  const indexes = raw.prepare(`PRAGMA index_list(${table})`).all() as { name: string; unique: number }[];
  for (const index of indexes) {
    if (!index.unique) continue;
    const cols = raw.prepare(`PRAGMA index_info(${index.name})`).all() as { name: string }[];
    if (cols.length !== 1 || cols[0]?.name !== column) continue;
    const meta = raw.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?").get(index.name) as
      | { sql: string | null }
      | undefined;
    const partial = (meta?.sql ?? "").toLowerCase().includes("where");
    if (!partial) return true;
  }
  return false;
}

function needsProgrammingRebuild(raw: Database.Database): boolean {
  const months = tableColumns(raw, "programming_months");
  const weeks = tableColumns(raw, "programming_weeks");
  if (!months.has("status") || !months.has("prompt_version") || !months.has("generation_timestamp")) return true;
  if (!weeks.has("status") || !weeks.has("prompt_version") || !weeks.has("input_summary_version")) return true;
  if (unconditionalUnique(raw, "programming_months", "month_start")) return true;
  if (unconditionalUnique(raw, "programming_weeks", "week_start")) return true;
  return false;
}

function colExpr(columns: Set<string>, name: string, fallback: string): string {
  return columns.has(name) ? name : fallback;
}

/**
 * Live DBs from the first engine have one row per month and per week (column UNIQUE).
 * Rebuild keeps every id and every class_weeks row, then allows older attempts to stay.
 */
function migrateProgrammingGenerations(raw: Database.Database) {
  if (!needsProgrammingRebuild(raw)) return;
  raw.pragma("foreign_keys = OFF");
  try {
    const rebuild = raw.transaction(() => {
      const months = tableColumns(raw, "programming_months");
      raw.exec(`DROP TABLE IF EXISTS programming_months_mig`);
      raw.exec(`
        CREATE TABLE programming_months_mig (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          month_start TEXT NOT NULL,
          scheme TEXT NOT NULL,
          direction_json TEXT NOT NULL,
          input_summary_json TEXT NOT NULL,
          prior_evaluation_id INTEGER,
          generation_source TEXT NOT NULL,
          fallback_reason TEXT,
          generated_at INTEGER NOT NULL,
          engine_version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'failed')),
          generation_version INTEGER NOT NULL DEFAULT 1,
          generation_attempt INTEGER NOT NULL DEFAULT 1,
          model_name TEXT,
          prompt_version TEXT NOT NULL,
          rules_version TEXT NOT NULL,
          generation_timestamp INTEGER NOT NULL,
          input_summary_version TEXT NOT NULL
        )
      `);
      raw.exec(`
        INSERT INTO programming_months_mig (
          id, month_start, scheme, direction_json, input_summary_json, prior_evaluation_id,
          generation_source, fallback_reason, generated_at, engine_version, created_at,
          status, generation_version, generation_attempt, model_name, prompt_version,
          rules_version, generation_timestamp, input_summary_version
        )
        SELECT
          id, month_start, scheme, direction_json, input_summary_json, prior_evaluation_id,
          generation_source, fallback_reason, generated_at, engine_version, created_at,
          ${colExpr(months, "status", "'active'")},
          ${colExpr(months, "generation_version", "1")},
          ${colExpr(months, "generation_attempt", "1")},
          ${colExpr(months, "model_name", "NULL")},
          ${colExpr(months, "prompt_version", "'monthly-program-v1'")},
          ${colExpr(months, "rules_version", "engine_version")},
          ${colExpr(months, "generation_timestamp", "generated_at")},
          ${colExpr(months, "input_summary_version", "'summary-v1'")}
        FROM programming_months
      `);
      raw.exec("DROP TABLE programming_months");
      raw.exec("ALTER TABLE programming_months_mig RENAME TO programming_months");

      const weeks = tableColumns(raw, "programming_weeks");
      raw.exec(`DROP TABLE IF EXISTS programming_weeks_mig`);
      raw.exec(`
        CREATE TABLE programming_weeks_mig (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          month_id INTEGER NOT NULL REFERENCES programming_months(id),
          week_index INTEGER NOT NULL,
          week_start TEXT NOT NULL,
          class_week_id INTEGER REFERENCES class_weeks(id),
          intent_json TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          display_json TEXT NOT NULL,
          input_summary_json TEXT NOT NULL,
          generation_source TEXT NOT NULL,
          fallback_reason TEXT,
          generated_at INTEGER NOT NULL,
          engine_version TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'failed')),
          generation_version INTEGER NOT NULL DEFAULT 1,
          generation_attempt INTEGER NOT NULL DEFAULT 1,
          model_name TEXT,
          prompt_version TEXT NOT NULL,
          rules_version TEXT NOT NULL,
          generation_timestamp INTEGER NOT NULL,
          input_summary_version TEXT NOT NULL
        )
      `);
      raw.exec(`
        INSERT INTO programming_weeks_mig (
          id, month_id, week_index, week_start, class_week_id, intent_json, plan_json, display_json,
          input_summary_json, generation_source, fallback_reason, generated_at, engine_version, created_at,
          status, generation_version, generation_attempt, model_name, prompt_version,
          rules_version, generation_timestamp, input_summary_version
        )
        SELECT
          id, month_id, week_index, week_start, class_week_id, intent_json, plan_json, display_json,
          input_summary_json, generation_source, fallback_reason, generated_at, engine_version, created_at,
          ${colExpr(weeks, "status", "'active'")},
          ${colExpr(weeks, "generation_version", "1")},
          ${colExpr(weeks, "generation_attempt", "1")},
          ${colExpr(weeks, "model_name", "NULL")},
          ${colExpr(weeks, "prompt_version", "'weekly-program-v1'")},
          ${colExpr(weeks, "rules_version", "engine_version")},
          ${colExpr(weeks, "generation_timestamp", "generated_at")},
          ${colExpr(weeks, "input_summary_version", "'summary-v1'")}
        FROM programming_weeks
      `);
      raw.exec("DROP TABLE programming_weeks");
      raw.exec("ALTER TABLE programming_weeks_mig RENAME TO programming_weeks");
      raw.exec("CREATE INDEX IF NOT EXISTS programming_weeks_month ON programming_weeks (month_id, week_start)");
    });
    rebuild();
  } finally {
    raw.pragma("foreign_keys = ON");
  }
  for (const table of [
    "programming_months",
    "programming_weeks",
    "programming_actuals",
    "programming_evaluations",
    "wod_structures",
  ]) {
    const broken = raw.prepare(`PRAGMA foreign_key_check(${table})`).all() as unknown[];
    if (broken.length) throw new Error(`programming generation migration left a broken foreign key on ${table}`);
  }
}

function ensureProgrammingActiveIndexes(raw: Database.Database) {
  raw.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS programming_months_one_active
      ON programming_months (month_start) WHERE status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS programming_weeks_one_active_start
      ON programming_weeks (week_start) WHERE status = 'active';
    CREATE UNIQUE INDEX IF NOT EXISTS programming_weeks_one_active_slot
      ON programming_weeks (month_id, week_index) WHERE status = 'active';
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
