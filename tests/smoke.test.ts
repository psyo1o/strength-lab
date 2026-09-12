import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculatePlates } from "../src/lib/calc/plates";
import { wendlerMainSets, trainingMaxKg } from "../src/lib/calc/wendler";
import { roundLoad } from "../src/lib/calc/round";
import { resetDbConnection } from "../src/lib/db/client";
import { loginUser, registerUser } from "../src/lib/auth";
import { getUserMaxes, getUserStarts, saveUserMaxes } from "../src/lib/maxes";
import { findWendlerSquatWeek1MainSets, getWeekId, getDay, resolveWorkout } from "../src/lib/programs/queries";
import { loadSeedFile, seedJsonPath } from "../src/lib/db/seed";
import { resolveSetKg } from "../src/lib/calc/loads";
import { tipDisclaimer, tipFor } from "../src/lib/tips";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-smoke-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  resetDbConnection();
}

beforeEach(freshDb);
afterEach(() => resetDbConnection());

describe("auth + 1RM + 5/3/1", () => {
  it("signs up, logs in, saves 1RM, and computes 531 week 1 squat", () => {
    const created = registerUser("lifter@example.com", "password123");
    expect(created).toHaveProperty("user");
    if ("error" in created) throw new Error(created.error);

    const login = loginUser("lifter@example.com", "password123");
    expect(login).toHaveProperty("user");
    if ("error" in login) throw new Error(login.error);
    expect(login.user.email).toBe("lifter@example.com");

    const bad = loginUser("lifter@example.com", "wrong-pass");
    expect(bad).toHaveProperty("error");

    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    expect(getUserMaxes(created.user.id).squat).toBe(200);

    expect(trainingMaxKg(200)).toBe(180);

    const calc = wendlerMainSets(200, 1, "kg");
    expect(calc.map((s) => s.weightKg)).toEqual([117.5, 135, 152.5]);
    expect(calc[2].amrap).toBe(true);

    const fromSeed = findWendlerSquatWeek1MainSets(created.user.id);
    expect(fromSeed).toHaveLength(3);
    expect(fromSeed.map((s) => s.weightKg)).toEqual([117.5, 135, 152.5]);
    expect(fromSeed.map((s) => s.percent)).toEqual([65, 75, 85]);
  });

  it("rejects short passwords and duplicate emails", () => {
    expect(registerUser("a@b.co", "short")).toHaveProperty("error");
    expect(registerUser("ok@b.co", "password123")).toHaveProperty("user");
    expect(registerUser("ok@b.co", "password123")).toHaveProperty("error");
  });
});

describe("seed schema + weight engine", () => {
  it("reads public seed.json (meta / oneRmFields / loadRules / programs)", () => {
    const raw = JSON.parse(fs.readFileSync(seedJsonPath(), "utf8"));
    expect(raw.meta.units).toBe("kg");
    expect(raw.meta.rounding_kg).toBe(2.5);
    expect(raw.oneRmFields.squat.label).toBe("스쿼트");
    expect(raw.oneRmFields.bench.label).toBe("벤치프레스");
    expect(raw.oneRmFields.deadlift.label).toBe("데드리프트");
    expect(raw.oneRmFields.ohp.label).toBe("오버헤드프레스");
    expect(raw.loadRules.tmFactor).toBe(0.9);
    expect(JSON.stringify(raw)).not.toContain("platePlan");
    const ids = raw.programs.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining(["jim-wendler-531", "starting-strength", "stronglifts-5x5", "madcow-5x5"]));
    const w531 = raw.programs.find((p: { id: string }) => p.id === "jim-wendler-531");
    expect(w531.usesTM).toBe(true);
    expect(w531.tmFactor).toBe(0.9);
    const squatMain = w531.weeks[0].days[3].exercises.find((e: { role: string }) => e.role === "main");
    expect(squatMain.sets.map((s: { percent: number; of: string }) => [s.percent, s.of])).toEqual([
      [65, "TM"],
      [75, "TM"],
      [85, "TM"],
    ]);
    expect(squatMain.sets[2].amrap).toBe(true);
    const squatBbb = w531.weeks[0].days[3].exercises.find((e: { role: string }) => e.role === "bbb");
    expect(squatBbb.sets).toHaveLength(5);
    expect(squatBbb.sets[0]).toEqual(expect.objectContaining({ reps: 10, percent: 50, of: "TM" }));
    expect(w531.weeks[0].days.map((d: { nameKo: string }) => d.nameKo)).toEqual([
      "월요일 — 오버헤드프레스",
      "화요일 — 데드리프트",
      "목요일 — 벤치프레스",
      "금요일 — 스쿼트",
    ]);
    expect(w531.weeks[0].days[0].exercises.map((e: { role: string }) => e.role)).toEqual([
      "warmup",
      "main",
      "bbb",
    ]);
    const deload = w531.weeks[3].days[0].exercises.find((e: { role: string }) => e.role === "main");
    expect(deload.sets.map((s: { percent: number }) => s.percent)).toEqual([40, 50, 60]);
    const sl = raw.programs.find((p: { id: string }) => p.id === "stronglifts-5x5");
    expect(sl.weeks[0].days[0].exercises[0].sets[0].percent).toBe(50);
    const mc = raw.programs.find((p: { id: string }) => p.id === "madcow-5x5");
    expect(mc.weeks[0].days[0].exercises[0].sets.map((s: { percent: number }) => s.percent)).toEqual([
      40, 50, 60, 70, 80,
    ]);
    expect(mc.weeks[1].days[0].exercises[0].sets[4].percent).toBe(82);
    expect(loadSeedFile().programs.some((p) => p.slug === "jim-wendler-531")).toBe(true);
  });

  it("resolves TM percents with 2.5kg rounding; start weight wins on linear", () => {
    expect(resolveSetKg({ oneRmKg: 200, percent: 65, of: "TM" })).toBe(117.5);
    expect(resolveSetKg({ oneRmKg: 200, percent: 75, of: "TM" })).toBe(135);
    expect(resolveSetKg({ oneRmKg: 200, percent: 85, of: "TM" })).toBe(152.5);
    expect(resolveSetKg({ oneRmKg: 155, percent: 85, of: "TM" })).toBe(117.5);
    expect(wendlerMainSets(155, 1, "kg").map((s) => s.weightKg)[2]).toBe(117.5);
    expect(resolveSetKg({ oneRmKg: 200, percent: 70, of: "1RM" })).toBe(140);
    expect(resolveSetKg({ oneRmKg: 40, percent: 50, of: "TM" })).toBe(20);
    expect(
      resolveSetKg({ oneRmKg: 200, startKg: 60, percent: 50, of: "1RM", preferStart: true, topPercent: 50 }),
    ).toBe(60);
    expect(
      resolveSetKg({
        oneRmKg: 200,
        startKg: 80,
        percent: 40,
        of: "1RM",
        preferStart: true,
        topPercent: 80,
      }),
    ).toBe(40);
    expect(
      resolveSetKg({
        oneRmKg: 200,
        startKg: 60,
        percent: 80,
        of: "1RM",
        preferStart: true,
        topPercent: 80,
        addKg: 2.5,
      }),
    ).toBe(62.5);
  });

  it("uses start weight on Stronglifts week 1 squat", () => {
    const created = registerUser("sl@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [
      { exerciseKey: "squat", value: 200, startValue: 60, unit: "kg" },
    ]);
    expect(getUserMaxes(created.user.id).squat).toBe(200);
    expect(getUserStarts(created.user.id).squat).toBe(60);
    const weekId = getWeekId("stronglifts-5x5", 1);
    expect(weekId).toBeTruthy();
    const day = getDay(weekId!, 1);
    const workout = resolveWorkout({ dayId: day!.id, userId: created.user.id, unit: "kg" });
    const squat = workout?.exercises.find((e) => e.exerciseKey === "squat");
    expect(squat?.sets.map((s) => s.weightKg)).toEqual([60, 60, 60, 60, 60]);
  });
});

describe("canonical exercises", () => {
  it("lists required P0 ids and squat/bench oneRm fields", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "exercises.canonical.json"), "utf8"));
    expect(raw.exercises.back_squat.oneRmField).toBe("squat");
    expect(raw.exercises.bench_press.oneRmField).toBe("bench");
    expect(Object.keys(raw.exercises)).toEqual(
      expect.arrayContaining([
        "back_squat",
        "bench_press",
        "deadlift",
        "ohp",
        "front_squat",
        "power_clean",
        "close_grip_bench",
        "incline_bench",
        "stiff_leg_deadlift",
        "barbell_row",
        "chin_up",
        "pull_up",
        "abs",
        "free_accessory",
      ]),
    );
  });
});

describe("seed schema example", () => {
  it("documents meta / oneRmFields / P0 programs without set platePlan", () => {
    const raw = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "data", "seed.schema.example.json"), "utf8"),
    );
    expect(raw.meta.units).toBe("kg");
    expect(raw.meta.rounding_kg).toBe(2.5);
    expect(raw.oneRmFields.squat.label).toBe("스쿼트");
    expect(raw.oneRmFields.ohp.label).toBe("오버헤드프레스");
    expect(raw.loadRules.noPlatePlanOnSets).toBe(true);
    expect(raw.loadRules.tmDefault.roundTM).toBe(false);
    expect(raw.programs.map((p: { id: string }) => p.id)).toEqual([
      "jim-wendler-531",
      "starting-strength",
      "stronglifts-5x5",
      "madcow-5x5",
    ]);
    expect(raw.programs[0].usesTM).toBe(true);
    expect(raw.programs[0].tmFactor).toBe(0.9);
    expect(JSON.stringify(raw.programs)).not.toMatch(/"platePlan"\s*:/);
  });
});

describe("korean exercise tips", () => {
  it("loads official tips with cue/mistake/alternative/sheet and disclaimer", () => {
    expect(tipDisclaimer()).toContain("전문가");
    const squat = tipFor("squat");
    const canonical = tipFor("back_squat");
    expect(squat?.cue).toBeTruthy();
    expect(squat?.mistake).toBeTruthy();
    expect(squat?.alternative).toBeTruthy();
    expect(squat?.sheet.split(/[.。]/).filter(Boolean).length).toBeGreaterThanOrEqual(1);
    expect(canonical?.sheet).toBe(squat?.sheet);
    expect(tipFor("ohp")?.name).toBe("오버헤드프레스");
    expect(tipFor("bench")?.exerciseId).toBe("bench_press");
  });
});

describe("plate calculator", () => {
  it("calculates kg plates per side and rounds to loadable", () => {
    const r = calculatePlates(100, "kg", 20);
    expect(r.loadable).toBe(100);
    expect(r.perSide).toEqual([
      { weight: 25, count: 1 },
      { weight: 15, count: 1 },
    ]);
    const odd = calculatePlates(101, "kg", 20);
    expect(odd.loadable).toBe(100);
  });

  it("calculates lb plates per side", () => {
    const r = calculatePlates(225, "lb", 45);
    expect(r.loadable).toBe(225);
    expect(r.perSide).toEqual([{ weight: 45, count: 2 }]);
    expect(roundLoad(100, "lb")).toBe(220);
  });
});
