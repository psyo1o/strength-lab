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
import {
  findWendlerSquatWeek1MainSets,
  getWeekId,
  getDay,
  resolveWorkout,
  toggleSetLog,
} from "../src/lib/programs/queries";
import { loadSeedFile, seedDraftsP1Path, seedJsonPath } from "../src/lib/db/seed";
import { resolveSetKg } from "../src/lib/calc/loads";
import { START_REF_PERCENT } from "../src/lib/calc/linear";
import { loadTips, tipDisclaimer, tipFor } from "../src/lib/tips";
import { isLocalAssetUrl, localExerciseImagePath, parseVideoUrl, resolveTipMedia } from "../src/lib/media";

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

  it("bumps Wendler TM +5kg lower after each completed 4-week cycle", () => {
    const created = registerUser("cycle@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    expect(findWendlerSquatWeek1MainSets(created.user.id).map((s) => s.weightKg)).toEqual([
      117.5, 135, 152.5,
    ]);

    const week4 = getWeekId("jim-wendler-531", 4);
    expect(week4).toBeTruthy();
    const friday = getDay(week4!, 4);
    expect(friday).toBeTruthy();
    const workout = resolveWorkout({ dayId: friday!.id, userId: created.user.id, unit: "kg" });
    const squat = workout!.exercises.find((e) => e.exerciseKey === "squat" && e.role === "main");
    const last = squat!.sets[squat!.sets.length - 1];
    toggleSetLog(created.user.id, last.id, true);

    expect(getUserMaxes(created.user.id).squat).toBe(200);
    expect(findWendlerSquatWeek1MainSets(created.user.id).map((s) => s.weightKg)).toEqual([
      120, 140, 157.5,
    ]);
    expect(resolveSetKg({ oneRmKg: 200, percent: 85, of: "TM", tmAddKg: 5 })).toBe(157.5);
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
      43.5, 54.38, 65.25, 76.13, 87,
    ]);
    expect(mc.weeks[1].days[0].exercises[0].sets[4].percent).toBe(89.18);
    expect(mc.estimated5RM.formula).toBe("0.87 * 1RM");
    expect(mc.weeklyProgression.factor).toBe(1.025);
    const wedSquat = mc.weeks[0].days[1].exercises[0];
    expect(wedSquat.sets.map((s: { percent: number }) => s.percent)).toEqual([43.5, 54.38, 65.25, 65.25]);
    const friSquat = mc.weeks[0].days[2].exercises.find((e: { exerciseId: string }) => e.exerciseId === "squat");
    expect(friSquat.sets[4]).toEqual(expect.objectContaining({ percent: 89.18, reps: 3 }));
    expect(friSquat.sets[5]).toEqual(expect.objectContaining({ percent: 65.25, reps: 8 }));
    expect(mc.weeks[0].days[2].exercises.find((e: { exerciseId: string }) => e.exerciseId === "barbell_row").sets).toHaveLength(6);
    expect(START_REF_PERCENT["madcow-5x5"]).toBe(87);
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
        "pause_squat",
        "pin_squat",
        "deficit_deadlift",
        "spoto_press",
        "floor_press",
        "face_pull",
      ]),
    );
    expect(raw.exercises.pause_squat.name).toBe("퍼즈 스쿼트");
    expect(raw.exercises.deficit_deadlift.name).toBe("데피짓 데드리프트");
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

  it("treats imageUrl videoUrl credit as optional and prefers local /exercises/{id}.webp", () => {
    const squat = tipFor("squat");
    expect(squat).toBeTruthy();
    expect(squat?.imageUrl === undefined || typeof squat?.imageUrl === "string").toBe(true);
    expect(squat?.videoUrl == null || typeof squat?.videoUrl === "string").toBe(true);
    expect(squat?.credit === undefined || typeof squat?.credit === "string").toBe(true);
    expect(localExerciseImagePath("back_squat")).toBe("/exercises/back_squat.webp");
    expect(localExerciseImagePath("squat")).toBe("/exercises/back_squat.webp");
    expect(squat?.hasDeclaredUrl).toBeFalsy();
    expect(squat?.media?.imageUrl == null || squat?.media?.imageUrl === "").toBe(true);
    expect(squat?.media?.videoUrl == null || squat?.media?.videoUrl === "").toBe(true);
    expect(JSON.stringify(loadTips().tips)).not.toMatch(/https?:\/\/[^"]*(wikimedia|commons|tjstrength)/i);
    expect(isLocalAssetUrl("https://commons.wikimedia.org/foo.jpg")).toBe(false);
    expect(isLocalAssetUrl("/exercises/back_squat.webp")).toBe(true);
    const media = resolveTipMedia({ imageUrl: "", videoUrl: "", credit: "" }, "back_squat");
    expect(media.imageUrl).toBe("/exercises/back_squat.webp");
    expect(media.hasDeclaredUrl).toBe(false);
    expect(media.videoUrl).toBeUndefined();
    const credited = resolveTipMedia(
      { imageUrl: "/exercises/back_squat.webp", videoUrl: null, credit: "본인 촬영", license: "self_shot" },
      "back_squat",
    );
    expect(credited.hasDeclaredUrl).toBe(true);
    expect(credited.credit).toBe("본인 촬영");
    expect(parseVideoUrl("")).toBeNull();
    const yt = parseVideoUrl("https://youtu.be/abcdefghijk");
    expect(yt?.kind).toBe("youtube");
    if (yt?.kind === "youtube") {
      expect(yt.embedSrc).toContain("autoplay=0");
      expect(yt.embedSrc).toContain("fs=0");
    }
    expect(parseVideoUrl("/exercises/back_squat.mp4")?.kind).toBe("mp4");
    expect(seedDraftsP1Path()).toMatch(/seed-drafts[/\\]seed\.p1\.json$/);
  });
});

describe("P1 programs", () => {
  it("loads each P1 program week 1 without platePlan", () => {
    const raw = JSON.parse(fs.readFileSync(seedJsonPath(), "utf8"));
    const ids = [
      "daily-undulating",
      "juggernaut",
      "cowboy",
      "rehab",
      "bob-takano",
      "catalyst",
      "torokhtiy",
      "lbeb",
    ];
    const loaded = loadSeedFile();
    for (const id of ids) {
      const p = raw.programs.find((row: { id: string }) => row.id === id);
      expect(p, id).toBeTruthy();
      expect(p.weeks[0].days.length).toBeGreaterThan(0);
      const hasPercent = JSON.stringify(p.weeks[0]).includes('"percent"');
      expect(hasPercent, id).toBe(true);
      expect(JSON.stringify(p)).not.toMatch(/"platePlan"\s*:/);
      expect(loaded.programs.some((row) => row.slug === id)).toBe(true);
    }
    const j = raw.programs.find((p: { id: string }) => p.id === "juggernaut");
    const squatMain = j.weeks[0].days[0].exercises.find((e: { role: string }) => e.role === "main");
    expect(squatMain.sets).toHaveLength(5);
    expect(squatMain.sets[0]).toEqual(expect.objectContaining({ percent: 60, of: "1RM", reps: 10 }));
    const jInt = j.weeks[1].days[0].exercises.find((e: { role: string }) => e.role === "main");
    expect(jInt.sets[0]).toEqual(expect.objectContaining({ percent: 67.5, of: "1RM" }));
    const cow = raw.programs.find((p: { id: string }) => p.id === "cowboy");
    expect(cow.weeks).toHaveLength(13);
    expect(cow.weeks[0].days).toHaveLength(6);
    expect(cow.completeness).toBe("working");
    expect(cow.coverage).toBe("w1-13_full_sets");
    expect(cow.weekRules).toHaveLength(13);
    const mon = cow.weeks[0].days[0].exercises.find((e: { role: string }) => e.role === "main");
    expect(mon.sets).toEqual(expect.arrayContaining([expect.objectContaining({ percent: 60, reps: 5, of: "1RM" })]));
    expect(mon.sets).toHaveLength(10);
    const fri = cow.weeks[0].days.find((d: { day?: number }) => d.day === 5);
    expect(fri.exercises.find((e: { role: string }) => e.role === "main").sets).toEqual([]);
    expect(fri.exercises.find((e: { role: string }) => e.role === "main").notesKo).toMatch(/to_10RM/);
    const wedDay = cow.weeks[0].days.find(
      (d: { nameKo?: string; day?: number }) => d.day === 3 || String(d.nameKo).includes("프론트"),
    );
    const wed = wedDay.exercises.find((e: { role: string }) => e.role === "main");
    expect(wed.sets.map((s: { percent: number }) => s.percent)).toEqual([55, 60, 65, 70, 75]);
    const dup = raw.programs.find((p: { id: string }) => p.id === "daily-undulating");
    expect(dup.weeks).toHaveLength(12);
    expect(dup.weeks[0].days).toHaveLength(6);
    expect(dup.extraOneRmFields.front_squat.label).toBe("프론트 스쿼트");
    const wu = dup.weeks[0].days[0].exercises.find((e: { role: string }) => e.role === "warmup");
    expect(wu.sets.map((s: { percent: number; reps: number }) => [s.percent, s.reps])).toEqual([
      [35, 8],
      [42, 5],
      [49, 3],
      [56, 1],
      [63, 1],
    ]);
    const rehab = raw.programs.find((p: { id: string }) => p.id === "rehab");
    expect(rehab.weeks).toHaveLength(8);
    const delorme = rehab.weeks[0].days[0].exercises.find((e: { exerciseId: string }) => e.exerciseId === "rehab_target");
    expect(delorme.sets.map((s: { percent: number; reps: number; of: string }) => [s.percent, s.reps, s.of])).toEqual([
      [50, 10, "10RM"],
      [75, 10, "10RM"],
      [100, 10, "10RM"],
    ]);
    const dapre = rehab.weeks[0].days[1].exercises.find((e: { exerciseId: string }) => e.exerciseId === "rehab_target");
    expect(dapre.sets.map((s: { percent: number; reps: number }) => [s.percent, s.reps])).toEqual([
      [50, 10],
      [75, 6],
      [100, 6],
    ]);
    const wendler = raw.programs.find((p: { id: string }) => p.id === "jim-wendler-531");
    expect(wendler.progression.afterEachCycle.upperKg).toBe(2.5);
    expect(wendler.progression.afterEachCycle.lowerKg).toBe(5);
    expect(wendler.progression.ohp.addKg).toBe(2.5);
    expect(wendler.progression.bench.addKg).toBe(2.5);
    expect(wendler.progression.squat.addKg).toBe(5);
    expect(wendler.progression.deadlift.addKg).toBe(5);
    const jug = raw.programs.find((p: { id: string }) => p.id === "juggernaut");
    expect(jug.weeks).toHaveLength(16);
    expect(jug.weeks[0].days).toHaveLength(6);
    expect(jug.completeness).toBe("working");
    expect(jug.coverage).toBe("w1-16_full_sets_plus_peaking");
    expect(jug.weekRules.at(-1)).toMatch(/peakingBlock/);
    const madcow = raw.programs.find((p: { id: string }) => p.id === "madcow-5x5");
    expect(madcow.fridayTriple).toBe(true);
    expect(madcow.prWeekDefault).toBeNull();
    expect(madcow.usesEstimated5RM).toBe(true);
    expect(madcow.copy.help).toMatch(/트리플은 매주/);
    for (const week of madcow.weeks) {
      const fri = week.days[week.days.length - 1];
      const squat = fri.exercises.find((e: { exerciseId: string }) => e.exerciseId === "squat");
      expect(squat.sets.some((s: { reps: number; noteKo?: string }) => s.reps === 3)).toBe(true);
    }
    expect(madcow.weeks[0].days[2].exercises[0].sets[4].percent).toBe(
      madcow.weeks[1].days[0].exercises[0].sets[4].percent,
    );
    const ss = raw.programs.find((p: { id: string }) => p.id === "starting-strength");
    const ohp = ss.weeks[0].days
      .flatMap((d: { exercises: { exerciseId: string; notesKo?: string; sets: { reps: number }[] }[] }) => d.exercises)
      .find((e: { exerciseId: string }) => e.exerciseId === "ohp");
    expect(ohp.sets).toHaveLength(3);
    expect(ohp.sets.every((s: { reps: number }) => s.reps === 5)).toBe(true);
    expect(ohp.notesKo).toMatch(/sheetAlt 5×3/);
    expect(ss.progression.squat.addKg).toBe(2.5);
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").weeks[0].nameKo).toMatch(/Class III/);
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").weeks).toHaveLength(12);
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").coverage).toBe("seeded_sample_not_full_cycle");
    expect(raw.programs.find((p: { id: string }) => p.id === "bob-takano").descriptionKo).toMatch(/샘플/);
    expect(raw.programs.find((p: { id: string }) => p.id === "catalyst").weeks).toHaveLength(12);
    expect(raw.programs.find((p: { id: string }) => p.id === "catalyst").completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "catalyst").coverage).toBe("seeded_sample_not_full_cycle");
    expect(raw.programs.find((p: { id: string }) => p.id === "catalyst").descriptionKo).not.toMatch(/공식 12주 기본 블록/);
    expect(JSON.stringify(raw.programs.find((p: { id: string }) => p.id === "catalyst"))).not.toMatch(/미확장/);
    const toro = raw.programs.find((p: { id: string }) => p.id === "torokhtiy");
    expect(toro.weeks.length).toBeGreaterThanOrEqual(13);
    expect(toro.weeks[0].days).toHaveLength(5);
    expect(toro.completeness).toBe("working");
    expect(raw.programs.find((p: { id: string }) => p.id === "lbeb").weeks[6].days).toHaveLength(0);
    expect(raw.programs.find((p: { id: string }) => p.id === "lbeb").completeness).toBe("template");
    expect(raw.programs.find((p: { id: string }) => p.id === "lbeb").coverage).toBe("excel-w1-6-only");
    expect(typeof seedDraftsP1Path()).toBe("string");
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
