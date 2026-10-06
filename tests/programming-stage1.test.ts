import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { MONTH_PLAN_OPENAI_MODEL } from "../src/lib/month-plan/week-model";
import {
  ensureProgrammingMonth,
  ensureProgrammingWeek,
  regenerateProgrammingMonth,
  regenerateProgrammingWeek,
} from "../src/lib/programming/engine";
import { draftForScheme, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { similarityScore, structurallySimilar } from "../src/lib/programming/rules";
import { listProgrammingMonthAttempts, listProgrammingWeekAttempts } from "../src/lib/programming/store";
import {
  INPUT_SUMMARY_VERSION,
  MONTHLY_PROMPT_VERSION,
  RULES_VERSION,
  SIMILARITY_CONFIG,
  WEEKLY_PROMPT_VERSION,
  type StoredStructure,
} from "../src/lib/programming/types";

const KEY = "sk-test-not-a-real-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";
const MONTH = "2026-10-01";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage1-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function structure(overrides: Partial<StoredStructure> = {}): StoredStructure {
  return {
    day: "mon",
    format: "amrap",
    time_domain: "short",
    stimulus: "high_rep",
    movement_patterns: ["engine"],
    movements: [{ key: "row", amount: "250m", name_ko: "로잉" }],
    equipment: ["rower"],
    rep_structure: "10분 amrap",
    work_rest_structure: "쉬지 않고 반복",
    duration_min: 10,
    volume: "low",
    intensity: "moderate",
    benchmark: false,
    long_conditioning: false,
    ...overrides,
  };
}

describe("stage 1 generation guard", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps one active week when the same week is generated twice and at the same time", async () => {
    const first = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const second = await ensureProgrammingWeek(WEEK, { nowMs: NOW + 1, key: null });
    expect(second.id).toBe(first.id);
    expect(listProgrammingWeekAttempts(WEEK)).toHaveLength(1);

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered = 0;
    const fetchImpl = vi.fn(async () => {
      entered += 1;
      if (entered === 2) release();
      await gate;
      return new Response("no", { status: 500 });
    });
    const raced = await Promise.all([
      ensureProgrammingWeek("2026-10-12", { nowMs: NOW + 2, key: KEY, fetchImpl }),
      ensureProgrammingWeek("2026-10-12", { nowMs: NOW + 3, key: KEY, fetchImpl }),
    ]);
    expect(entered).toBeGreaterThanOrEqual(2);
    expect(raced[0].id).toBe(raced[1].id);
    expect(raced[0].status).toBe("active");
    const attempts = listProgrammingWeekAttempts("2026-10-12");
    const active = attempts.filter((row) => row.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(raced[0].id);
    expect(attempts[0]?.status).toBe("active");
    expect(attempts.slice(1).every((row) => row.status === "failed")).toBe(true);

    const months = await Promise.all([
      ensureProgrammingMonth("2026-11-01", { nowMs: NOW + 4, key: null }),
      ensureProgrammingMonth("2026-11-01", { nowMs: NOW + 5, key: null }),
    ]);
    expect(months[0].id).toBe(months[1].id);
    expect(listProgrammingMonthAttempts("2026-11-01").filter((row) => row.status === "active")).toHaveLength(1);

    const again = await regenerateProgrammingWeek("2026-10-12", { nowMs: NOW + 6, key: null });
    const after = listProgrammingWeekAttempts("2026-10-12");
    expect(again.status).toBe("active");
    expect(again.generationVersion).toBe(2);
    expect(again.id).not.toBe(raced[0].id);
    expect(after.find((row) => row.id === raced[0].id)?.status).toBe("superseded");
    expect(after.filter((row) => row.status === "active")).toHaveLength(1);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 0 });
  });

  it("saves tracking fields for a model week and for a fallback week", async () => {
    const month = await ensureProgrammingMonth(MONTH, { nowMs: NOW, key: null });
    expect(month).toMatchObject({
      generationSource: "fallback",
      modelName: null,
      promptVersion: MONTHLY_PROMPT_VERSION,
      rulesVersion: RULES_VERSION,
      generationTimestamp: NOW,
      inputSummaryVersion: INPUT_SUMMARY_VERSION,
      generationAttempt: 1,
      generationVersion: 1,
      status: "active",
    });
    expect(
      getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_generation_logs WHERE scope = 'month'").get(),
    ).toEqual({ c: 0 });

    const direction = fallbackMonth(null);
    const draft = draftForScheme(direction, 1, fallbackIntent(direction, 1, "model"));
    draft.intent.why_ko = "모델이 이번 주 클래스 한 판의 이유를 적습니다. secret@example.com";
    const monday = draft.sessions[0]!.conditioning!;
    monday.movements = [{ key: "ski", amount: "200m", name_ko: "스키" }];
    monday.equipment = ["ski"];
    monday.movement_patterns = ["engine"];
    const payload = { ...draft, email: "secret@example.com", name: "회원이름토큰" };
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const week = await ensureProgrammingWeek(WEEK, { nowMs: NOW + 1, key: KEY, fetchImpl });
    expect(week).toMatchObject({
      generationSource: "model",
      modelName: MONTH_PLAN_OPENAI_MODEL,
      promptVersion: WEEKLY_PROMPT_VERSION,
      rulesVersion: RULES_VERSION,
      generationTimestamp: NOW + 1,
      inputSummaryVersion: INPUT_SUMMARY_VERSION,
      generationAttempt: 1,
      status: "active",
    });
    expect(week.modelName).toBe("gpt-5.4-nano");
    const logs = getSqlite()
      .prepare("SELECT raw_json, model_name, prompt_version FROM programming_generation_logs WHERE scope = 'week'")
      .all() as { raw_json: string; model_name: string; prompt_version: string }[];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ model_name: MONTH_PLAN_OPENAI_MODEL, prompt_version: WEEKLY_PROMPT_VERSION });
    expect(logs[0]?.raw_json).not.toContain("secret@example.com");
    expect(logs[0]?.raw_json).not.toContain("회원이름토큰");
    expect(logs[0]?.raw_json).toContain("[redacted]");
    expect(logs[0]?.raw_json).toContain("스키");

    const failed = vi.fn(async () => new Response("no", { status: 500 }));
    const fallback = await ensureProgrammingWeek("2026-10-12", { nowMs: NOW + 2, key: KEY, fetchImpl: failed });
    expect(failed).toHaveBeenCalledTimes(2);
    expect(fallback).toMatchObject({
      generationSource: "fallback",
      fallbackReason: "http_error",
      modelName: MONTH_PLAN_OPENAI_MODEL,
      promptVersion: WEEKLY_PROMPT_VERSION,
      rulesVersion: RULES_VERSION,
      generationTimestamp: NOW + 2,
      inputSummaryVersion: INPUT_SUMMARY_VERSION,
      generationAttempt: 2,
      status: "active",
    });

    const replaced = await regenerateProgrammingMonth(MONTH, { nowMs: NOW + 3, key: null });
    const monthAttempts = listProgrammingMonthAttempts(MONTH);
    expect(replaced.promptVersion).toBe(MONTHLY_PROMPT_VERSION);
    expect(replaced.generationVersion).toBe(2);
    expect(monthAttempts.find((row) => row.id === month.id)?.status).toBe("superseded");
    expect(monthAttempts.filter((row) => row.status === "active")).toHaveLength(1);
  });

  it("follows the similarity config when the threshold or a feature weight changes", () => {
    const left = structure();
    const right = structure({
      day: "fri",
      format: "for_time",
      volume: "high",
      movements: [{ key: "burpee", amount: "8", name_ko: "버피" }],
    });
    const originalThreshold = SIMILARITY_CONFIG.threshold;
    const originalDuration = SIMILARITY_CONFIG.features.duration;
    try {
      expect(similarityScore(left, right)).toBe(4);
      SIMILARITY_CONFIG.threshold = 4;
      expect(structurallySimilar(left, right)).toBe(true);
      SIMILARITY_CONFIG.threshold = 5;
      expect(structurallySimilar(left, right)).toBe(false);
      SIMILARITY_CONFIG.features.duration = 1;
      expect(similarityScore(left, right)).toBe(5);
      expect(structurallySimilar(left, right)).toBe(true);
      expect(structurallySimilar(left, { ...right, benchmark: true })).toBe(false);
    } finally {
      SIMILARITY_CONFIG.threshold = originalThreshold;
      SIMILARITY_CONFIG.features.duration = originalDuration;
    }
  });
});

describe("stage 1 migration", () => {
  afterEach(() => {
    resetDbConnection();
  });

  it("keeps live programming rows and does not touch class_weeks", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-legacy-"));
    const file = path.join(dir, "app.db");
    const raw = new Database(file);
    raw.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        unit TEXT NOT NULL DEFAULT 'kg',
        created_at INTEGER NOT NULL
      );
      INSERT INTO users (id, email, password_hash, created_at) VALUES (4, 'keep@example.com', 'hash', 10);
      CREATE TABLE class_weeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_index INTEGER NOT NULL,
        week_start TEXT NOT NULL UNIQUE,
        sex TEXT,
        plan_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO class_weeks (id, week_index, week_start, sex, plan_json, created_at)
      VALUES (11, 1, '2026-10-05', 'm', '{"days":[{"day":"mon","kept":true}]}', 10);
      CREATE TABLE class_day_scores (
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
        notes_ko TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO class_day_scores (id, user_id, class_week_id, day_key, completed_at, rounds, extra_reps, notes_ko)
      VALUES (8, 4, 11, 'mon', 10, 4, 2, 'score-stays');
      CREATE TABLE programming_months (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_start TEXT NOT NULL UNIQUE,
        scheme TEXT NOT NULL,
        direction_json TEXT NOT NULL,
        input_summary_json TEXT NOT NULL,
        prior_evaluation_id INTEGER,
        generation_source TEXT NOT NULL,
        fallback_reason TEXT,
        generated_at INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO programming_months (
        id, month_start, scheme, direction_json, input_summary_json, generation_source, generated_at, engine_version, created_at
      ) VALUES (3, '2026-10-01', '531', '{}', '{}', 'fallback', 50, 'programming-1', 50);
      CREATE TABLE programming_weeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        month_id INTEGER NOT NULL REFERENCES programming_months(id),
        week_index INTEGER NOT NULL,
        week_start TEXT NOT NULL UNIQUE,
        class_week_id INTEGER REFERENCES class_weeks(id),
        intent_json TEXT NOT NULL,
        plan_json TEXT NOT NULL,
        display_json TEXT NOT NULL,
        input_summary_json TEXT NOT NULL,
        generation_source TEXT NOT NULL,
        fallback_reason TEXT,
        generated_at INTEGER NOT NULL,
        engine_version TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO programming_weeks (
        id, month_id, week_index, week_start, class_week_id, intent_json, plan_json, display_json,
        input_summary_json, generation_source, generated_at, engine_version, created_at
      ) VALUES (
        7, 3, 1, '2026-10-05', 11, '{}', '{"sessions":[]}', '{"days":[]}', '{}', 'fallback', 50, 'programming-1', 50
      );
      CREATE TABLE programming_actuals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_id INTEGER NOT NULL UNIQUE REFERENCES programming_weeks(id) ON DELETE CASCADE,
        actual_json TEXT NOT NULL,
        recorded_at INTEGER NOT NULL
      );
      INSERT INTO programming_actuals (id, week_id, actual_json, recorded_at)
      VALUES (5, 7, '{"note_ko":"kept-actual","days":[]}', 50);
      CREATE TABLE wod_structures (
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
      INSERT INTO wod_structures (
        id, week_id, day_key, format, time_domain, movement_patterns, movements, equipment,
        rep_structure, work_rest_structure, duration_min, volume, intensity
      ) VALUES (
        4, 7, 'mon', 'amrap', 'short', '[]', '[]', '[]', 'reps', 'rest', 10, 'low', 'moderate'
      );
    `);
    raw.close();

    process.env.DATABASE_PATH = file;
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    resetDbConnection();
    const db = getSqlite();
    const classWeek = db.prepare("SELECT id, plan_json FROM class_weeks WHERE id = 11").get() as {
      id: number;
      plan_json: string;
    };
    expect(classWeek.plan_json).toBe('{"days":[{"day":"mon","kept":true}]}');
    const score = db.prepare("SELECT notes_ko FROM class_day_scores WHERE id = 8").get() as { notes_ko: string };
    expect(score.notes_ko).toBe("score-stays");
    const week = db.prepare("SELECT id, status, prompt_version, generation_timestamp, class_week_id FROM programming_weeks WHERE id = 7").get() as {
      id: number;
      status: string;
      prompt_version: string;
      generation_timestamp: number;
      class_week_id: number;
    };
    expect(week).toMatchObject({
      id: 7,
      status: "active",
      prompt_version: "weekly-program-v1",
      generation_timestamp: 50,
      class_week_id: 11,
    });
    expect(db.prepare("SELECT week_id FROM wod_structures WHERE id = 4").get()).toEqual({ week_id: 7 });
    expect(db.prepare("SELECT actual_json FROM programming_actuals WHERE id = 5").get()).toEqual({
      actual_json: '{"note_ko":"kept-actual","days":[]}',
    });

    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT COUNT(*) AS c FROM programming_weeks").get()).toEqual({ c: 1 });
    expect(again.prepare("SELECT plan_json FROM class_weeks WHERE id = 11").get()).toEqual({
      plan_json: '{"days":[{"day":"mon","kept":true}]}',
    });
  });
});
