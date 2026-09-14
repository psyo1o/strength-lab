import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerUser } from "../src/lib/auth";
import { resetDbConnection, getSqlite } from "../src/lib/db/client";
import { saveUserMaxes } from "../src/lib/maxes";
import { getDay, getWeekId, resolveWorkout, toggleSetLog } from "../src/lib/programs/queries";
import { computeStreakDays, dashboardProgress, prevDayKey, trainingDayKey } from "../src/lib/progress";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-progress-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

describe("streak math", () => {
  it("counts consecutive KST days from today or yesterday", () => {
    const today = trainingDayKey(1_747_209_600_000);
    const y = prevDayKey(today);
    const y2 = prevDayKey(y);
    expect(computeStreakDays([today, y, y2], 1_747_209_600_000)).toBe(3);
    expect(computeStreakDays([y, y2], 1_747_209_600_000)).toBe(2);
    expect(computeStreakDays([y2], 1_747_209_600_000)).toBe(0);
  });
});

describe("logged PR and recent sessions", () => {
  it("stores completed weight and shows PR, streak, and history", () => {
    const created = registerUser("pr@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    const week1 = getWeekId("jim-wendler-531", 1);
    const friday = getDay(week1!, 4);
    const workout = resolveWorkout({ dayId: friday!.id, userId: created.user.id, unit: "kg" });
    const squat = workout!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    const last = squat!.sets[squat!.sets.length - 1];
    expect(last.weightKg).toBe(152.5);
    toggleSetLog(created.user.id, last.id, true, last.weightKg);

    const row = getSqlite()
      .prepare("SELECT weight_kg FROM set_logs WHERE user_id = ? AND program_set_id = ?")
      .get(created.user.id, last.id) as { weight_kg: number };
    expect(row.weight_kg).toBe(152.5);

    const progress = dashboardProgress(created.user.id);
    expect(progress.streakDays).toBe(1);
    expect(progress.prs.find((p) => p.key === "squat")?.weightKg).toBe(152.5);
    expect(progress.recent[0]?.programNameKo).toMatch(/Wendler|5\/3\/1/);
    expect(progress.recent[0]?.lifts.some((l) => l.nameKo.includes("스쿼트") && l.weightKg === 152.5)).toBe(true);
  });
});
