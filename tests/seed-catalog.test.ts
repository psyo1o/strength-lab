import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { getUserMaxes, saveUserMaxes } from "../src/lib/maxes";
import { getDay, getWeekId, resolveWorkout, toggleSetLog } from "../src/lib/programs/queries";
import { SEED_REVISION } from "../src/lib/programs/seed-revision";

describe("seed catalog revision", () => {
  const prev = process.env.DATABASE_PATH;
  const prevSecret = process.env.AUTH_SECRET;

  afterEach(() => {
    resetDbConnection();
    delete process.env.FORCE_RESEED;
    if (prev === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prev;
    if (prevSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = prevSecret;
  });

  it("refreshes olympic completeness when seed_revision is stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    resetDbConnection();
    const db = getSqlite();
    expect(db.prepare("SELECT completeness FROM programs WHERE slug='bob-takano'").get()).toEqual({
      completeness: "working",
    });
    expect(db.prepare("SELECT completeness FROM programs WHERE slug='lbeb'").get()).toEqual({
      completeness: "working",
    });
    db.prepare("UPDATE programs SET completeness='template' WHERE slug IN ('bob-takano','catalyst','torokhtiy')").run();
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_revision', 'stale')").run();
    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT value FROM app_meta WHERE key='seed_revision'").get()).toEqual({
      value: SEED_REVISION,
    });
    for (const slug of ["bob-takano", "catalyst", "torokhtiy"]) {
      expect(again.prepare("SELECT completeness FROM programs WHERE slug=?").get(slug)).toEqual({
        completeness: "working",
      });
    }
    expect(again.prepare("SELECT completeness FROM programs WHERE slug='lbeb'").get()).toEqual({
      completeness: "working",
    });
  });

  it("keeps users, 1RMs, and set logs across a catalog revision bump", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    resetDbConnection();
    const created = registerUser("keep-logs@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    const week1 = getWeekId("jim-wendler-531", 1);
    expect(week1).toBeTruthy();
    const friday = getDay(week1!, 4);
    expect(friday).toBeTruthy();
    const before = resolveWorkout({ dayId: friday!.id, userId: created.user.id, unit: "kg" });
    const squat = before!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    const last = squat!.sets[squat!.sets.length - 1];
    toggleSetLog(created.user.id, last.id, true);

    const db = getSqlite();
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_revision', 'stale')").run();
    db.prepare(
      "UPDATE programs SET description_ko='유료 엑셀 그리드는 이 저장소에 없습니다.' WHERE slug='bob-takano'",
    ).run();
    resetDbConnection();

    const again = getSqlite();
    expect(again.prepare("SELECT value FROM app_meta WHERE key='seed_revision'").get()).toEqual({
      value: SEED_REVISION,
    });
    expect(getUserMaxes(created.user.id).squat).toBe(200);
    expect(again.prepare("SELECT email FROM users WHERE id=?").get(created.user.id)).toEqual({
      email: "keep-logs@example.com",
    });
    const week1b = getWeekId("jim-wendler-531", 1);
    const fridayB = getDay(week1b!, 4);
    const after = resolveWorkout({ dayId: fridayB!.id, userId: created.user.id, unit: "kg" });
    const squatAfter = after!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    expect(squatAfter!.sets.map((s) => s.done)).toEqual([false, false, true]);
    const takano = again.prepare("SELECT description_ko FROM programs WHERE slug='bob-takano'").get() as {
      description_ko: string;
    };
    expect(takano.description_ko).not.toMatch(/유료 엑셀/);
    expect(takano.description_ko).toMatch(/진행 가능/);
  });

  it("seed_revision bump keeps set_logs count", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    resetDbConnection();
    const created = registerUser("keep-count@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    const week1 = getWeekId("jim-wendler-531", 1);
    const friday = getDay(week1!, 4);
    const before = resolveWorkout({ dayId: friday!.id, userId: created.user.id, unit: "kg" });
    const squat = before!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    expect(squat).toBeTruthy();
    for (const set of squat!.sets) toggleSetLog(created.user.id, set.id, true);

    const db = getSqlite();
    const logsBefore = db.prepare("SELECT COUNT(*) AS c FROM set_logs").get() as { c: number };
    expect(logsBefore.c).toBeGreaterThan(0);
    const idsBefore = db
      .prepare("SELECT id, program_set_id FROM set_logs ORDER BY id")
      .all() as { id: number; program_set_id: number }[];
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_revision', 'stale')").run();
    resetDbConnection();

    const again = getSqlite();
    expect(again.prepare("SELECT COUNT(*) AS c FROM set_logs").get()).toEqual(logsBefore);
    expect(again.prepare("SELECT id, program_set_id FROM set_logs ORDER BY id").all()).toEqual(idsBefore);
    expect(again.prepare("SELECT value FROM app_meta WHERE key='seed_revision'").get()).toEqual({
      value: SEED_REVISION,
    });
  });

  it("FORCE_RESEED=1 rebuilds catalog without wiping users, maxes, or WOD rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.FORCE_RESEED;
    resetDbConnection();
    const created = registerUser("keep-force@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "bench", value: 100, unit: "kg" }]);
    const db = getSqlite();
    db.prepare(
      `INSERT INTO wod_results (user_id, template_slug, completed_at, tier, score_type, time_sec, notes_ko, scale_notes, substitutions, equipment_json)
       VALUES (?, 'fran', ?, 'rx', 'time_sec', 214, '', '', '', '')`,
    ).run(created.user.id, Date.now());
    const week1 = getWeekId("jim-wendler-531", 1);
    const friday = getDay(week1!, 4);
    const workout = resolveWorkout({ dayId: friday!.id, userId: created.user.id, unit: "kg" });
    const squat = workout!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    toggleSetLog(created.user.id, squat!.sets[0].id, true);
    const logsBefore = db.prepare("SELECT COUNT(*) AS c FROM set_logs").get() as { c: number };
    expect(logsBefore.c).toBe(1);

    db.prepare(
      `INSERT INTO programs (slug, name_ko, name_en, category, completeness, description_ko, description_en, sort_order)
       VALUES ('ghost-program', '고스트', 'Ghost', 'test', 'template', '', '', 999)`,
    ).run();
    const ghostWeek = db
      .prepare(`INSERT INTO program_weeks (program_slug, week_number, name_ko, notes_ko) VALUES ('ghost-program', 1, '1', '')`)
      .run();
    const ghostDay = db
      .prepare(`INSERT INTO program_days (week_id, day_number, name_ko, notes_ko) VALUES (?, 1, '1', '')`)
      .run(Number(ghostWeek.lastInsertRowid));
    const ghostPe = db
      .prepare(
        `INSERT INTO program_exercises (day_id, exercise_key, role, sort_order, notes_ko) VALUES (?, 'squat', 'main', 0, '')`,
      )
      .run(Number(ghostDay.lastInsertRowid));
    db.prepare(
      `INSERT INTO program_sets (exercise_id, set_number, percent_base, percent, reps, amrap, rest_sec, note_ko)
       VALUES (?, 1, 'none', NULL, 5, 0, NULL, '')`,
    ).run(Number(ghostPe.lastInsertRowid));
    expect(db.prepare("SELECT slug FROM programs WHERE slug='ghost-program'").get()).toBeTruthy();

    process.env.FORCE_RESEED = "1";
    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT email FROM users WHERE id=?").get(created.user.id)).toEqual({
      email: "keep-force@example.com",
    });
    expect(getUserMaxes(created.user.id).bench).toBe(100);
    expect(again.prepare("SELECT COUNT(*) AS c FROM wod_results").get()).toEqual({ c: 1 });
    expect(again.prepare("SELECT COUNT(*) AS c FROM set_logs").get()).toEqual(logsBefore);
    expect(again.prepare("SELECT slug FROM programs WHERE slug='ghost-program'").get()).toBeUndefined();
    delete process.env.FORCE_RESEED;
  });

  it("FORCE_RESEED keeps orphaned set_logs attached to unused catalog rows", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.FORCE_RESEED;
    resetDbConnection();
    const created = registerUser("orphan-logs@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    const db = getSqlite();
    db.prepare(
      `INSERT INTO programs (slug, name_ko, name_en, category, completeness, description_ko, description_en, sort_order)
       VALUES ('ghost-logged', '고스트기록', 'GhostLogged', 'test', 'template', '', '', 998)`,
    ).run();
    const ghostWeek = db
      .prepare(`INSERT INTO program_weeks (program_slug, week_number, name_ko, notes_ko) VALUES ('ghost-logged', 1, '1', '')`)
      .run();
    const ghostDay = db
      .prepare(`INSERT INTO program_days (week_id, day_number, name_ko, notes_ko) VALUES (?, 1, '1', '')`)
      .run(Number(ghostWeek.lastInsertRowid));
    const ghostPe = db
      .prepare(
        `INSERT INTO program_exercises (day_id, exercise_key, role, sort_order, notes_ko) VALUES (?, 'squat', 'main', 0, '')`,
      )
      .run(Number(ghostDay.lastInsertRowid));
    const ghostSet = db
      .prepare(
        `INSERT INTO program_sets (exercise_id, set_number, percent_base, percent, reps, amrap, rest_sec, note_ko)
         VALUES (?, 1, 'none', NULL, 5, 0, NULL, '')`,
      )
      .run(Number(ghostPe.lastInsertRowid));
    toggleSetLog(created.user.id, Number(ghostSet.lastInsertRowid), true);
    const logsBefore = db.prepare("SELECT COUNT(*) AS c FROM set_logs").get() as { c: number };
    expect(logsBefore.c).toBe(1);

    process.env.FORCE_RESEED = "1";
    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT COUNT(*) AS c FROM set_logs").get()).toEqual(logsBefore);
    expect(again.prepare("SELECT slug FROM programs WHERE slug='ghost-logged'").get()).toEqual({
      slug: "ghost-logged",
    });
    delete process.env.FORCE_RESEED;
  });
});
