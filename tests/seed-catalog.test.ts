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
    process.env.FORCE_RESEED = "1";
    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT email FROM users WHERE id=?").get(created.user.id)).toEqual({
      email: "keep-force@example.com",
    });
    expect(getUserMaxes(created.user.id).bench).toBe(100);
    expect(again.prepare("SELECT COUNT(*) AS c FROM wod_results").get()).toEqual({ c: 1 });
    delete process.env.FORCE_RESEED;
  });
});
