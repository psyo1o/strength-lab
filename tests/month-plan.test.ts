import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { wendlerMainSets } from "../src/lib/calc/wendler";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { saveUserMaxes, getUserMaxes } from "../src/lib/maxes";
import { toggleSetLog } from "../src/lib/programs/queries";
import { saveWodResult, listWodResults } from "../src/lib/wod/queries";
import { defaultMetconAdapter, serverModelKey } from "../src/lib/month-plan/adapter";
import { buildWeek, dayByKey, dayText, weekText } from "../src/lib/month-plan/build-week";
import { kstParts } from "../src/lib/month-plan/calendar";
import { comparesForDay, listHistoryCards, listTrainingHistory, loadHistoryContext, namedWodComparison } from "../src/lib/month-plan/history";
import {
  cardsOnDate,
  defaultHistoryDate,
  formatHistoryDate,
  formatSetGroups,
  planCalendarDate,
  personalRankLabel,
  samePersonalGroup,
  visibleCompareRows,
  weekOf,
} from "../src/lib/month-plan/history-day";
import { pieceSignature } from "../src/lib/month-plan/signature";
import { MILE_M, TRACK_LAP_M } from "../src/lib/month-plan/distance";
import {
  addPlanScore,
  currentWeekPlan,
  generatePlanForUser,
  getPlan,
  listPlans,
  todayPlanDay,
} from "../src/lib/month-plan/store";
import { METCON_STIMULI, type MetconStimulus, type WeekBuildInput } from "../src/lib/month-plan/types";

const NOW = Date.parse("2026-09-30T01:00:00.000Z");

function input(partial: Partial<WeekBuildInput> & Pick<WeekBuildInput, "weekIndex" | "maxes">): WeekBuildInput {
  return {
    sex: partial.sex ?? null,
    recentMetcons: partial.recentMetcons ?? [],
    trainingDays: partial.trainingDays,
    weekIndex: partial.weekIndex,
    maxes: partial.maxes,
    blockedSignatures: partial.blockedSignatures,
    blockedNames: partial.blockedNames,
  };
}

describe("month plan rules", () => {
  it("builds week-1 strength sets from a known 1RM", () => {
    const week = buildWeek(
      input({
        weekIndex: 1,
        sex: "m",
        maxes: { squat: 200, ohp: 100, bench: 140, deadlift: 220 },
      }),
    );
    const squat = dayByKey(week, "mon")!.lift!;
    expect(squat.sets).toHaveLength(3);
    expect(squat.trainingMaxKg).toBe(180);
    expect(squat.sets.map((set) => set.percentOfTm)).toEqual([65, 75, 85]);
    expect(squat.sets.map((set) => set.reps)).toEqual([5, 5, 5]);
    expect(squat.sets.map((set) => set.weightKg)).toEqual([117.5, 135, 152.5]);
    expect(squat.sets.map((set) => set.weightKg)).toEqual(wendlerMainSets(200, 1, "kg").map((set) => set.weightKg));
    expect(squat.sets[2]?.amrap).toBe(true);

    const press = dayByKey(week, "tue")!.lift!;
    expect(press.exerciseKey).toBe("ohp");
    expect(press.sets.map((set) => set.weightKg)).toEqual(wendlerMainSets(100, 1, "kg").map((set) => set.weightKg));

    const dead = dayByKey(week, "fri")!.lift!;
    expect(dead.exerciseKey).toBe("deadlift");
    expect(dead.sets.map((set) => set.weightKg)).toEqual(wendlerMainSets(220, 1, "kg").map((set) => set.weightKg));

    const week2 = buildWeek(input({ weekIndex: 2, maxes: { bench: 120, squat: 200, deadlift: 220, ohp: 80 } }));
    const bench = dayByKey(week2, "tue")!.lift!;
    expect(bench.exerciseKey).toBe("bench");
    expect(bench.sets.map((set) => [set.percentOfTm, set.reps, set.weightKg])).toEqual(
      wendlerMainSets(120, 2, "kg").map((set) => [set.percentOfTm, set.reps, set.weightKg]),
    );

    const week4 = buildWeek(input({ weekIndex: 4, maxes: { squat: 200 } }));
    expect(dayByKey(week4, "mon")!.lift!.sets.map((set) => set.percentOfTm)).toEqual([40, 50, 60]);
    expect(dayByKey(week4, "thu")!.piece?.id).toBe("sl-month-benchmark");
    expect(dayByKey(week4, "thu")!.piece?.named).toBe(true);
  });

  it("does not invent kg when the 1RM is missing", () => {
    const week = buildWeek(input({ weekIndex: 1, sex: null, maxes: { deadlift: 220 } }));
    const squat = dayByKey(week, "mon")!.lift!;
    expect(squat.missingOneRm).toBe(true);
    expect(squat.oneRmKg).toBeNull();
    expect(squat.trainingMaxKg).toBeNull();
    expect(squat.sets.map((set) => set.weightKg)).toEqual([null, null, null]);
    expect(squat.noteKo).toMatch(/무거운 단수/);
    expect(JSON.stringify(squat)).not.toMatch(/"weightKg":\s*\d/);
    expect(JSON.stringify(squat)).not.toMatch(/"trainingMaxKg":\s*\d/);
    expect(dayText(dayByKey(week, "mon")!)).not.toMatch(/\d+(\.\d+)?\s*kg/);

    const empty = buildWeek(input({ weekIndex: 4, sex: null, maxes: {} }));
    expect(weekText(empty)).not.toMatch(/\d+(\.\d+)?\s*kg/i);
    expect(dayByKey(empty, "fri")!.lift!.weightKg).toBeUndefined();
    expect(dayByKey(empty, "fri")!.lift!.sets.every((set) => set.weightKg == null)).toBe(true);
  });

  it("keeps saturday optional, long pieces on week 2 and 4 wednesday, and run meters", () => {
    expect(TRACK_LAP_M).toBe(400);
    expect(MILE_M).toBe(1600);
    for (const weekIndex of [1, 2, 3, 4] as const) {
      const week = buildWeek(input({ weekIndex, sex: "f", maxes: { squat: 100, ohp: 40, bench: 50, deadlift: 120 } }));
      const wed = dayByKey(week, "wed")!;
      const sat = dayByKey(week, "sat")!;
      const sun = dayByKey(week, "sun")!;
      expect(wed.longPiece).toBe(weekIndex === 2 || weekIndex === 4);
      expect(sat.optional).toBe(true);
      expect(dayText(sat)).toMatch(/선택/);
      expect(dayText(sat)).toMatch(/월요일로 옮기지/);
      expect(sun.rest).toBe(true);
      expect(weekText(week)).not.toMatch(/km/i);
      expect(weekText(week)).not.toMatch(/HWPO|CrossFit|Fran|Murph/i);
      expect(dayText(dayByKey(week, "fri")!)).not.toMatch(/스쿼트|스윙|클린/);
      expect(dayText(wed)).not.toMatch(/스내치/);
      expect(dayByKey(week, "mon")!.longPiece).toBe(false);
      expect(dayByKey(week, "mon")!.piece!.minutes).toBeLessThan(30);
      if (wed.longPiece) {
        expect(wed.piece!.minutes).toBeGreaterThanOrEqual(30);
        expect(wed.piece!.minutes).toBeLessThanOrEqual(40);
        expect(wed.blocks.some((block) => block.role === "extra_conditioning")).toBe(false);
        expect(wed.piece!.bodyKo).toMatch(/1600m/);
        expect(wed.piece!.bodyKo).toMatch(/트랙 4바퀴/);
        expect(wed.piece!.bodyKo).toMatch(/팬바이크/);
        expect(wed.piece!.bodyKo).toMatch(/스키/);
      } else {
        expect(wed.piece!.bodyKo).toMatch(/400m/);
        expect(wed.piece!.bodyKo).toMatch(/트랙 1바퀴/);
      }
      const mon = dayByKey(week, "mon")!;
      expect(mon.blocks.map((block) => block.role)).toEqual([
        "warmup",
        "main",
        "metcon",
        "skill",
        "assistance",
        "extra_conditioning",
      ]);
      expect(mon.blocks.find((block) => block.role === "warmup")!.kept).toBe(true);
      expect(mon.blocks.find((block) => block.role === "warmup")!.cuttable).toBe(false);
      expect(mon.blocks.find((block) => block.role === "metcon")!.kept).toBe(true);
      expect(mon.blocks.find((block) => block.role === "extra_conditioning")!.kept).toBe(false);
    }

    const male = buildWeek(input({ weekIndex: 4, sex: "m", maxes: { squat: 200 } }));
    const female = buildWeek(input({ weekIndex: 4, sex: "f", maxes: { squat: 200 } }));
    expect(dayByKey(male, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual(
      dayByKey(female, "mon")!.lift!.sets.map((set) => set.weightKg),
    );
    expect(dayByKey(male, "thu")!.piece!.bodyKo).toMatch(/9kg/);
    expect(dayByKey(female, "thu")!.piece!.bodyKo).toMatch(/6kg/);
    expect(dayByKey(male, "tue")!.piece!.bodyKo).toMatch(/60cm/);
    expect(dayByKey(female, "tue")!.piece!.bodyKo).toMatch(/50cm/);
    expect(dayByKey(male, "sat")!.piece!.id).toBe("sat-reps");
    expect(dayByKey(male, "sat")!.piece!.minutes).toBe(12);
    expect(dayByKey(female, "sat")!.piece!.bodyKo).toBe(dayByKey(male, "sat")!.piece!.bodyKo);
    expect(dayByKey(male, "sat")!.piece!.bodyKo).not.toMatch(/스쿼트|스러스터|월볼/);

    const plain = buildWeek(input({ weekIndex: 1, maxes: {}, recentMetcons: [] }));
    const avoided = buildWeek(input({ weekIndex: 1, maxes: {}, recentMetcons: [{ pattern: "engine" }] }));
    expect(dayByKey(plain, "mon")!.piece!.signature).not.toBe(dayByKey(avoided, "mon")!.piece!.signature);
    const latestOnly = buildWeek(input({ weekIndex: 1, maxes: {}, recentMetcons: [{ pattern: "squat" }] }));
    const olderEngine = buildWeek(
      input({ weekIndex: 1, maxes: {}, recentMetcons: [{ pattern: "squat" }, { pattern: "engine" }] }),
    );
    expect(dayByKey(latestOnly, "mon")!.piece!.id).toBe("mon-engine");
    expect(dayByKey(olderEngine, "mon")!.piece!.id).toBe("mon-gym");

    expect(pieceSignature("amrap", [
      { key: "run", amount: "400m" },
      { key: "burpee", amount: "8" },
    ])).toBe(pieceSignature("amrap", [
      { key: "burpee", amount: "8" },
      { key: "run", amount: "400m" },
    ]));
    expect(pieceSignature("amrap", [{ key: "run", amount: "400m" }])).not.toBe(
      pieceSignature("for_time", [{ key: "run", amount: "400m" }]),
    );
    expect(pieceSignature("amrap", [{ key: "run", amount: "400m" }])).not.toBe(
      pieceSignature("amrap", [{ key: "run", amount: "800m" }]),
    );

    const adapterSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/month-plan/adapter.ts"), "utf8");
    expect(adapterSrc).not.toMatch(/\bfetch\s*\(/);
    expect(adapterSrc).not.toMatch(/api\.openai\.com/);
    const previous = process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.MONTH_PLAN_MODEL_KEY;
    expect(serverModelKey()).toBeNull();
    expect(defaultMetconAdapter().id).toBe("rules");
    process.env.MONTH_PLAN_MODEL_KEY = "server-only";
    expect(defaultMetconAdapter().id).toBe("model");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const filled = defaultMetconAdapter().fill({
      weekIndex: 1,
      day: "mon",
      sex: null,
      avoidPatterns: [],
      longPiece: false,
      forbid: ["squat"],
    });
    expect(filled.bodyKo).toMatch(/400m/);
    expect(filled.signature).not.toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    if (previous == null) delete process.env.MONTH_PLAN_MODEL_KEY;
    else process.env.MONTH_PLAN_MODEL_KEY = previous;
  });

  it("chips only 고중량, 고반복, or 기술, and leaves engine pieces unlabeled", () => {
    const allowed = new Set<MetconStimulus>(METCON_STIMULI);
    for (const weekIndex of [1, 2, 3, 4] as const) {
      for (const recentMetcons of [[], [{ pattern: "engine" as const }]]) {
        const week = buildWeek(
          input({
            weekIndex,
            sex: "m",
            maxes: { squat: 200, deadlift: 220 },
            recentMetcons,
          }),
        );
        const training = week.days.filter((day) => !day.rest);
        expect(training).toHaveLength(6);
        expect(JSON.stringify(week)).not.toContain("숨차는");
        for (const day of training) {
          const stimulus = day.piece!.stimulus;
          expect(stimulus == null || allowed.has(stimulus)).toBe(true);
        }
        for (let index = 1; index < training.length; index += 1) {
          const previous = training[index - 1]!.piece!.stimulus;
          const current = training[index]!.piece!.stimulus;
          if (previous && current) expect(current).not.toBe(previous);
        }
        expect(dayByKey(week, "tue")!.piece!.stimulus).not.toBe("고중량");
        expect(dayByKey(week, "sat")!.piece!.stimulus).not.toBe("고중량");
        const wed = dayByKey(week, "wed")!;
        expect(wed.piece!.stimulus).toBeNull();
        if (weekIndex === 2 || weekIndex === 4) {
          expect(wed.piece!.minutes).toBeGreaterThanOrEqual(30);
          expect(wed.piece!.minutes).toBeLessThanOrEqual(40);
        }
      }
    }
    const heavy = dayByKey(buildWeek(input({ weekIndex: 1, sex: null, maxes: {} })), "thu")!.piece!;
    expect(heavy.stimulus).toBe("고중량");
    expect(heavy.bodyKo).not.toMatch(/\d+(\.\d+)?\s*kg/i);
    const engine = dayByKey(buildWeek(input({ weekIndex: 1, maxes: {} })), "mon")!.piece!;
    expect(engine.stimulus).toBeNull();
  });
});

describe("generated week is the plan, and history keeps scores", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-plan-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  afterEach(() => {
    resetDbConnection();
  });

  it("publishes the week immediately and keeps loads, times, and earlier scores", async () => {
    const created = registerUser("plan@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    const userId = created.user.id;
    saveUserMaxes(userId, [
      { exerciseKey: "squat", value: 200, unit: "kg" },
      { exerciseKey: "ohp", value: 80, unit: "kg" },
      { exerciseKey: "bench", value: 100, unit: "kg" },
      { exerciseKey: "deadlift", value: 180, unit: "kg" },
    ]);
    saveWodResult(userId, { templateSlug: "fran", tier: "rx", timeSec: 300, completedAt: NOW - 86_400_000 });
    saveWodResult(userId, { templateSlug: "fran", tier: "rx", timeSec: 250, completedAt: NOW - 3_600_000 });
    const set = getSqlite().prepare("SELECT id FROM program_sets LIMIT 1").get() as { id: number };
    toggleSetLog(userId, set.id, true, 100);
    const maxesBefore = getUserMaxes(userId);
    const wodBefore = listWodResults(userId).length;
    const logsBefore = (
      getSqlite().prepare("SELECT COUNT(*) AS c FROM set_logs WHERE user_id = ?").get(userId) as { c: number }
    ).c;

    const first = await generatePlanForUser(userId, { weekIndex: 1, sex: "m", nowMs: NOW });
    if ("error" in first) throw new Error(first.error);
    expect(currentWeekPlan(userId, NOW)?.id).toBe(first.id);
    const today = todayPlanDay(userId, NOW);
    expect(today?.planId).toBe(first.id);
    expect(today?.day.day).toBe(kstParts(NOW).day);
    expect(JSON.stringify(first.week)).not.toMatch(/"status"\s*:\s*"draft"/);
    expect(dayByKey(first.week, "mon")!.lift!.sets.map((setRow) => setRow.weightKg)).toEqual([117.5, 135, 152.5]);

    const second = await generatePlanForUser(userId, { weekIndex: 1, sex: "m", nowMs: NOW + 2_000 });
    if ("error" in second) throw new Error(second.error);
    expect(currentWeekPlan(userId, NOW + 2_000)?.id).toBe(second.id);
    expect(listPlans(userId)).toHaveLength(2);
    expect(getPlan(userId, first.id)?.week.days.find((day) => day.day === "mon")?.lift?.sets.map((setRow) => setRow.weightKg)).toEqual([
      117.5, 135, 152.5,
    ]);

    const logged = addPlanScore(userId, {
      planId: first.id,
      day: "mon",
      rounds: 8,
      extraReps: 2,
      completedAt: NOW + 1_000,
    });
    if ("error" in logged) throw new Error(logged.error);

    saveUserMaxes(userId, [{ exerciseKey: "squat", value: 100, unit: "kg" }]);
    expect(getPlan(userId, first.id)?.week.days.find((day) => day.day === "mon")?.lift?.sets[2]?.weightKg).toBe(152.5);

    const secondMonday = second.week.days.find((day) => day.day === "mon")!;
    const metconCompare = comparesForDay(loadHistoryContext(userId), second, secondMonday).find((row) => row.reason === "same_metcon");
    expect(secondMonday.piece?.signature).toBe(first.week.days.find((day) => day.day === "mon")?.piece?.signature);
    expect(metconCompare?.reasonKo).toMatch(/같은 동작 · 같은 형식/);
    expect(metconCompare?.summaryKo).toMatch(/8R \+ 2/);

    const third = await generatePlanForUser(userId, { weekIndex: 1, sex: "m", nowMs: NOW + 6_000 });
    if ("error" in third) throw new Error(third.error);
    const thirdMonday = third.week.days.find((day) => day.day === "mon")!;
    expect(thirdMonday.piece?.signature).not.toBe(secondMonday.piece?.signature);
    expect(comparesForDay(loadHistoryContext(userId), third, thirdMonday).some((row) => row.reason === "same_metcon")).toBe(false);

    const changed = buildWeek(
      input({
        weekIndex: 1,
        sex: "m",
        maxes: { squat: 200 },
        recentMetcons: [{ pattern: "engine" }],
      }),
    );
    expect(changed.days.find((day) => day.day === "mon")?.piece?.signature).not.toBe(secondMonday.piece?.signature);

    const benchmark = await generatePlanForUser(userId, { weekIndex: 4, sex: "m", nowMs: NOW + 3_000 });
    if ("error" in benchmark) throw new Error(benchmark.error);
    const benchScore = addPlanScore(userId, {
      planId: benchmark.id,
      day: "thu",
      timeSec: 720,
      completedAt: NOW + 4_000,
    });
    if ("error" in benchScore) throw new Error(benchScore.error);
    const benchmarkAgain = await generatePlanForUser(userId, { weekIndex: 4, sex: "m", nowMs: NOW + 5_000 });
    if ("error" in benchmarkAgain) throw new Error(benchmarkAgain.error);
    const thu = benchmarkAgain.week.days.find((day) => day.day === "thu")!;
    const named = comparesForDay(loadHistoryContext(userId), benchmarkAgain, thu).find((row) => row.reason === "named");
    expect(named?.reasonKo).toMatch(/같은 벤치마크/);
    expect(named?.summaryKo).toMatch(/12:00/);
    expect(thu.piece?.id).toBe("sl-month-benchmark");

    const history = listTrainingHistory(userId);
    expect(new Set(history.map((item) => item.kind))).toEqual(new Set(["plan", "wod", "session"]));
    const frans = history.filter((item) => item.href === "/wod/fran");
    expect(frans[0]?.compares[0]?.reason).toBe("named");
    expect(frans[0]?.compares[0]?.summaryKo).toMatch(/5:00/);
    expect(frans[0]?.compares[0]?.summaryKo).toMatch(/4:10/);
    expect(frans[0]?.compares[0]?.reasonKo).toMatch(/같은 벤치마크/);
    expect(frans[1]?.compares).toEqual([]);
    expect(namedWodComparison(userId, "fran")?.summaryKo).toMatch(/50초 빠름/);

    const mondayLog = history.find((item) => item.key === `plan:${first.id}:mon`);
    expect(mondayLog?.scores.map((score) => score.label)).toContain("8R + 2");
    expect(mondayLog?.line).toMatch(/117\.5kg/);

    const session = history.find((item) => item.kind === "session");
    expect(session?.line).toMatch(/100kg/);

    expect(getUserMaxes(userId).squat).toBe(100);
    expect(getUserMaxes(userId).ohp).toBe(maxesBefore.ohp);
    expect(listWodResults(userId)).toHaveLength(wodBefore);
    expect((getSqlite().prepare("SELECT COUNT(*) AS c FROM set_logs WHERE user_id = ?").get(userId) as { c: number }).c).toBe(
      logsBefore,
    );
    const tables = getSqlite().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const names = tables.map((table) => table.name);
    expect(names).toContain("user_equipment");
    expect(names).toContain("month_plans");
    expect(names).toContain("wod_results");
    expect(listPlans(userId).length).toBeGreaterThanOrEqual(2);

    const cards = listHistoryCards(userId, "kg");
    const newerFran = cards.find((card) => card.href === "/wod/fran" && card.score === "4:10");
    const olderFran = cards.find((card) => card.href === "/wod/fran" && card.score === "5:00");
    expect(newerFran?.date).toBe("2026-09-30");
    expect(newerFran?.badge).toBe("벤치마크");
    expect(newerFran?.stimulus).toBeNull();
    expect(olderFran?.stimulus).toBeNull();
    expect(newerFran?.rankKo).toBe("내 기록 1 / 2");
    expect(olderFran?.rankKo).toBe("내 기록 2 / 2");
    expect(newerFran?.compares).toEqual([
      expect.objectContaining({ labelKo: "같은 이름", date: "2026-09-29", score: "5:00" }),
    ]);
    expect(olderFran?.compares).toEqual([]);
    expect(cardsOnDate(cards, "2020-01-01")).toEqual([]);
    expect(cardsOnDate(cards, "2026-09-30").every((card) => card.date === "2026-09-30")).toBe(true);

    expect(planCalendarDate(first.weekStart, "mon")).toBe("2026-09-28");
    const squatCard = cards.find((card) => card.key === `plan:${first.id}:mon:lift`);
    expect(squatCard?.date).toBe("2026-09-28");
    expect(squatCard?.sets).toEqual(["1×5 · 117.5kg", "1×5 · 135kg", "1×5+ · 152.5kg"]);
    expect(squatCard?.compares).toEqual([]);
    expect(squatCard?.rankKo).toBeNull();
    expect(squatCard?.stimulus).toBeNull();

    const secondMetcon = cards.find((card) => card.key === `plan:${second.id}:mon:metcon`);
    expect(secondMetcon?.badge).toBe("메트콘");
    expect(secondMetcon?.stimulus).toBeNull();
    expect(cards.some((card) => card.stimulus === ("숨차는" as never))).toBe(false);
    expect(cards.find((card) => card.badge === "메트콘" && card.name === "맨몸 서킷")?.stimulus).toBe("고반복");
    expect(secondMetcon?.compares.some((row) => row.labelKo === "같은 구성" && row.score === "8R + 2")).toBe(true);
    expect(secondMetcon?.rankKo).toBeNull();
    expect(cards.find((card) => card.score === "8R + 2")?.rankKo).toBeNull();
    expect(cards.filter((card) => card.key === `plan:${second.id}:mon:metcon`)).toHaveLength(1);

    const laterBenchmark = cards.find((card) => card.key === `plan:${benchmarkAgain.id}:thu:metcon`);
    expect(laterBenchmark?.badge).toBe("벤치마크");
    expect(laterBenchmark?.stimulus).toBeNull();
    expect(laterBenchmark?.compares.some((row) => row.labelKo === "같은 이름" && row.score === "12:00")).toBe(true);

    const sessionCard = cards.find((card) => card.badge === "리프트" && card.href.startsWith("/session/"));
    expect(sessionCard?.sets.join("\n")).toMatch(/100kg/);
    expect(sessionCard?.sets.join("\n")).not.toMatch(/…|\.\.\./);
    expect(sessionCard?.compares).toEqual([]);
    expect(sessionCard?.stimulus).toBeNull();
  });
});

describe("history day screen", () => {
  it("defaults to today, otherwise the nearest past logged day", () => {
    expect(defaultHistoryDate(["2026-09-28", "2026-09-30", "2026-10-02"], "2026-09-30")).toBe("2026-09-30");
    expect(defaultHistoryDate(["2026-09-28", "2026-09-29", "2026-10-02"], "2026-09-30")).toBe("2026-09-29");
    expect(defaultHistoryDate(["2026-10-02"], "2026-09-30")).toBe("2026-09-30");
    expect(defaultHistoryDate([], "2026-09-30")).toBe("2026-09-30");
    expect(formatHistoryDate("2026-09-30")).toBe("9월 30일");
    const franEarlier = [
      { labelKo: "같은 이름" as const, date: "2026-09-29", score: "5:00" },
      { labelKo: "같은 이름" as const, date: "2026-09-25", score: "5:10" },
      { labelKo: "같은 이름" as const, date: "2026-09-22", score: "5:20" },
      { labelKo: "같은 이름" as const, date: "2026-09-20", score: "5:40" },
    ];
    expect(visibleCompareRows(franEarlier, false).map((row) => row.date)).toEqual(["2026-09-29", "2026-09-25", "2026-09-22"]);
    expect(visibleCompareRows(franEarlier, true).map((row) => row.date)).toEqual([
      "2026-09-29",
      "2026-09-25",
      "2026-09-22",
      "2026-09-20",
    ]);
    const sameShape = [
      { labelKo: "같은 구성" as const, date: "2026-09-01", score: "1R" },
      { labelKo: "같은 구성" as const, date: "2026-09-02", score: "2R" },
      { labelKo: "같은 구성" as const, date: "2026-09-03", score: "3R" },
      { labelKo: "같은 구성" as const, date: "2026-09-04", score: "4R" },
    ];
    expect(visibleCompareRows(sameShape, false)).toHaveLength(3);
    expect(visibleCompareRows(sameShape, false).map((row) => row.date)).not.toContain("2026-09-04");
    expect(personalRankLabel(250, [340, 320, 310, 300, 250], "time")).toBe("내 기록 1 / 5");
    expect(personalRankLabel(300, [340, 320, 310, 300, 250], "time")).toBe("내 기록 2 / 5");
    expect(personalRankLabel(8002, [7000, 8002, 9000], "rounds")).toBe("내 기록 2 / 3");
    expect(personalRankLabel(120, [90, 100, 120], "load")).toBe("내 기록 1 / 3");
    expect(personalRankLabel(100, [100], "load")).toBeNull();
    expect(personalRankLabel(250, [250, 250], "time")).toBe("내 기록 1 / 2");
    expect(
      samePersonalGroup(
        { named: true, pieceKey: "named:fran", signature: "for_time|thruster" },
        { pieceKey: "named:helen", signature: "for_time|thruster" },
      ),
    ).toBe(false);
    expect(
      samePersonalGroup(
        { named: false, pieceKey: "sig:amrap|burpee", signature: "amrap|burpee" },
        { pieceKey: "sig:amrap|run", signature: "amrap|run" },
      ),
    ).toBe(false);
    expect(weekOf("2026-09-30")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("keeps other days out of an empty day and does not invent kg", () => {
    expect(cardsOnDate([{ date: "2026-09-28" }, { date: "2026-09-30" }], "2026-09-29")).toEqual([]);
    expect(
      formatSetGroups(
        [
          { reps: 5, amrap: false, weightKg: 100 },
          { reps: 5, amrap: false, weightKg: 100 },
          { reps: 5, amrap: false, weightKg: 100 },
          { reps: 5, amrap: false, weightKg: 100 },
          { reps: 5, amrap: false, weightKg: 100 },
        ],
        "kg",
      ),
    ).toEqual(["5×5 · 100kg"]);
    expect(formatSetGroups([{ reps: 5, amrap: true, weightKg: 152.5 }], "kg")).toEqual(["1×5+ · 152.5kg"]);
    const missing = formatSetGroups(dayByKey(buildWeek(input({ weekIndex: 1, maxes: { squat: 200 } })), "fri")!.lift!.sets, "kg");
    expect(missing.join("\n")).not.toMatch(/kg|lb/);
    expect(missing).toEqual(["2×5", "1×5+"]);

    const screen = fs.readFileSync(path.join(process.cwd(), "src/components/HistoryScreen.tsx"), "utf8");
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/history/page.tsx"), "utf8");
    const historySrc = fs.readFileSync(path.join(process.cwd(), "src/lib/month-plan/history.ts"), "utf8");
    expect(screen).toContain("이 날에는 저장된 운동이 없어요.");
    expect(screen).toContain("visibleCompareRows");
    const metcon = screen.slice(screen.indexOf("function MetconCard"));
    expect(metcon.indexOf("{card.stimulus}")).toBeLessThan(metcon.indexOf("{card.score}"));
    expect(metcon.indexOf("{card.score}")).toBeLessThan(metcon.indexOf("{card.rankKo}"));
    expect(metcon.indexOf("{card.rankKo}")).toBeLessThan(metcon.indexOf("visible.map"));
    expect(metcon.indexOf("{card.rankKo}")).toBeLessThan(metcon.indexOf("더 보기"));
    expect(metcon).toMatch(/<p[^>]*>\{card\.rankKo\}<\/p>/);
    expect(metcon).toContain('card.badge === "메트콘"');
    expect(screen.match(/\{card\.stimulus\}/g)).toHaveLength(1);
    const chip = metcon.slice(Math.max(0, metcon.indexOf("{card.stimulus}") - 160), metcon.indexOf("{card.stimulus}"));
    expect(chip).toContain("<span");
    expect(chip).not.toContain("<button");
    const lift = screen.slice(screen.indexOf("function LiftCard"), screen.indexOf("function MetconCard"));
    expect(lift).not.toContain("stimulus");
    expect(screen).not.toContain("숨차는");
    expect(fs.readFileSync(path.join(process.cwd(), "src/lib/month-plan/pieces.ts"), "utf8")).not.toContain("숨차는");
    expect(fs.readFileSync(path.join(process.cwd(), "src/lib/month-plan/types.ts"), "utf8")).not.toContain("숨차는");
    expect(screen).toContain("더 보기");
    expect(screen).not.toMatch(/<Link[^>]*>\s*더 보기/);
    expect(screen).not.toMatch(/truncate/);
    expect(historySrc).toContain('labelKo: "같은 이름" | "같은 구성"');
    expect(page).toContain("listHistoryCards");
    expect(page).not.toContain("listTrainingHistory");
  });
});
