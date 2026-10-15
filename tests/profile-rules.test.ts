import { describe, expect, it } from "vitest";
import { buildGoalTable, expectedRestDays, profileTrainingDayCount, weekCapsFor } from "../src/lib/programming/coaching/goal-table";
import { buildSessionFrame } from "../src/lib/programming/coaching/slot-choices";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { dayBoundsFromSkeleton } from "../src/lib/programming/coaching/week-bounds";
import { withCoachingPlan } from "../src/lib/programming/coaching/monthly";
import type { WeekSkeleton } from "../src/lib/programming/direction/contract";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";

function month531() {
  return withCoachingPlan(fallbackMonth({ summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531", strength_method: "531" }));
}

function skeleton(input: {
  weekId: string;
  weekIndex: 1 | 2 | 3 | 4;
  start: string;
  rows: Array<{ day: DayKey; rest?: boolean; intensity: number; pattern: "squat" | "hinge" | "press" | "pull"; load: "heavy" | "moderate" | "light"; body?: "lower" | "upper" | "full" }>;
}): WeekSkeleton {
  return {
    weekId: input.weekId,
    monthId: "2099-07",
    weekIndex: input.weekIndex,
    directionHash: "hash",
    rulesVersion: "direction-v1",
    lock: { status: "locked", lockedAt: null, skeletonHash: "hash", lockedBy: "test", version: 1, previousHash: null, reason: null },
    days: input.rows.map((row, index) => ({
      date: row.day === "sun" && input.start ? addDate(input.start, index) : addDate(input.start, DAY_ORDER.indexOf(row.day)),
      day: row.day,
      weekIndex: input.weekIndex,
      dayType: row.rest ? "rest" : "train",
      direction: {
        focus: null,
        intensity: row.rest ? null : row.intensity,
        targets: { bodyParts: [], movementPatterns: row.rest ? [] : [row.pattern], energySystems: [] },
        stimulus: { type: null, timeDomain: "short" as const },
        purpose: "x",
      },
      slots: row.rest
        ? []
        : [{ role: "main" as const, pattern: row.pattern, bodyPart: row.body ?? (row.pattern === "press" || row.pattern === "pull" ? "upper" : "lower"), loadClass: row.load, durationBudgetMin: 12 }],
      totalBudgetMin: row.rest ? 0 : 12,
    })),
  };
}

function addDate(start: string, offset: number): string {
  const date = new Date(`${start}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function squatCombos(bounds: NonNullable<ReturnType<typeof dayBoundsFromSkeleton>>, day: DayKey): string[] {
  return (bounds.find((row) => row.day === day)?.combinations ?? []).filter((combo) => combo.startsWith("squat:"));
}

describe("프로필 훈련일 수", () => {
  const base = month531();

  it("주 2일부터 7일까지 휴식일은 7에서 훈련일을 뺀 수와 정확히 같다", () => {
    expect(profileTrainingDayCount(base)).toBe(6);
    expect(expectedRestDays(base)).toBe(1);
    const six = buildGoalTable({ month: base });
    expect(six.ok).toBe(true);
    if (six.ok) {
      for (const week of six.table.weeks) expect(week.days.filter((day) => day.rest)).toHaveLength(1);
    }
    for (const count of [2, 3, 4, 5, 6, 7] as const) {
      const month = { ...base, available_days: DAY_ORDER.slice(0, count) };
      expect(profileTrainingDayCount(month)).toBe(count);
      expect(expectedRestDays(month)).toBe(7 - count);
      const built = buildGoalTable({ month });
      expect(built.ok, `${count}일 표`).toBe(true);
      if (!built.ok) continue;
      for (const week of built.table.weeks) {
        const rests = week.days.filter((day) => day.rest).length;
        expect(rests).toBe(7 - count);
        const high = week.days.filter((day) => (day.intensity ?? 0) >= 4).length;
        const deload = week.week_index === 4;
        const cap = deload ? weekCapsFor(count).maxHighIntensityDeload : weekCapsFor(count).maxHighIntensity;
        expect(high).toBeLessThanOrEqual(cap);
      }
      expect(extractWeekRules({ month, weekIndex: 1 }).max_high_intensity_days).toBe(weekCapsFor(count).maxHighIntensity);
      expect(extractWeekRules({ month, weekIndex: 1 }).min_rest_days).toBe(7 - count);
      expect(extractWeekRules({ month, weekIndex: 4 }).max_high_intensity_days).toBe(1);
    }
    expect(weekCapsFor(4).maxHighIntensity).toBe(3);
    expect(weekCapsFor(5).maxHighIntensity).toBe(3);
    expect(weekCapsFor(6).maxHighIntensity).toBe(3);
    expect(weekCapsFor(6).maxLowerLifts).toBe(2);
    expect(weekCapsFor(2).maxHighIntensity).toBe(1);
    expect(extractWeekRules({ month: base, weekIndex: 1 }).max_high_intensity_days).toBe(3);
    expect(extractWeekRules({ month: base, weekIndex: 1 }).max_lower_lifts).toBe(2);
  });

  it("주 2일 연속 훈련일도 표를 만든다", () => {
    const built = buildGoalTable({ month: { ...base, available_days: ["mon", "tue"] } });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    for (const week of built.table.weeks) {
      expect(week.days.filter((day) => day.rest)).toHaveLength(5);
      const long = week.days.filter((day) => day.time_domain === "long");
      if (base.long_conditioning_weeks.includes(week.week_index)) expect(long).toHaveLength(1);
      else expect(long).toHaveLength(0);
    }
  });
});

describe("데드리프트 다음 날 헤비 스쿠트 조합", () => {
  const week = (start: string, weekIndex: 1 | 2 | 3 | 4, rows: Parameters<typeof skeleton>[0]["rows"]) =>
    skeleton({ weekId: `${start}:w${weekIndex}`, weekIndex, start, rows });

  it("같은 주에서 헤비 스쿠트 조합을 만들지 않는다", () => {
    const bounds = dayBoundsFromSkeleton(
      week("2099-07-06", 1, [
        { day: "mon", intensity: 4, pattern: "hinge", load: "heavy" },
        { day: "tue", intensity: 4, pattern: "squat", load: "heavy" },
        { day: "wed", intensity: 3, pattern: "press", load: "moderate" },
        { day: "thu", intensity: 3, pattern: "press", load: "moderate" },
        { day: "fri", intensity: 3, pattern: "press", load: "moderate" },
        { day: "sat", intensity: 3, pattern: "press", load: "moderate" },
        { day: "sun", intensity: 1, pattern: "press", load: "light", rest: true },
      ]),
      2,
      { method: "531" },
    );
    expect(bounds).not.toBeNull();
    expect(bounds!.find((day) => day.day === "tue")?.strength_lift).not.toContain("squat");
    expect(squatCombos(bounds!, "tue")).toEqual([]);
    expect(bounds!.find((day) => day.day === "mon")?.combinations.some((combo) => combo.startsWith("deadlift:"))).toBe(true);
  });

  it("월요일은 지난주 일요일 데드리프트 뒤를 본다", () => {
    const previous = week("2099-07-20", 3, [
      { day: "mon", intensity: 3, pattern: "press", load: "moderate" },
      { day: "tue", intensity: 3, pattern: "press", load: "moderate" },
      { day: "wed", intensity: 3, pattern: "press", load: "moderate" },
      { day: "thu", intensity: 3, pattern: "press", load: "moderate" },
      { day: "fri", intensity: 3, pattern: "press", load: "moderate" },
      { day: "sat", intensity: 3, pattern: "press", load: "moderate" },
      { day: "sun", intensity: 4, pattern: "hinge", load: "heavy" },
    ]);
    const current = week("2099-07-27", 4, [
      { day: "mon", intensity: 4, pattern: "squat", load: "heavy" },
      { day: "tue", intensity: 3, pattern: "press", load: "moderate" },
      { day: "wed", intensity: 3, pattern: "press", load: "moderate" },
      { day: "thu", intensity: 3, pattern: "press", load: "moderate" },
      { day: "fri", intensity: 3, pattern: "press", load: "moderate" },
      { day: "sat", intensity: 3, pattern: "press", load: "moderate" },
      { day: "sun", intensity: 1, pattern: "press", load: "light", rest: true },
    ]);
    const heavyWeek = { ...current, weekIndex: 1 as const, days: current.days.map((day) => ({ ...day, weekIndex: 1 as const })) };
    const blocked = dayBoundsFromSkeleton(heavyWeek, 2, { method: "531", previousWeek: previous });
    expect(blocked!.find((day) => day.day === "mon")?.strength_lift).not.toContain("squat");
    expect(squatCombos(blocked!, "mon")).toEqual([]);
    const open = dayBoundsFromSkeleton(heavyWeek, 2, { method: "531" });
    expect(open!.find((day) => day.day === "mon")?.strength_lift).toContain("squat");
    expect(squatCombos(open!, "mon")).toContain("squat:heavy");
  });
});

describe("세션 enum은 뼈대 조합에서만 나온다", () => {
  it("deadlift 키가 잠긴 조합에 없으면 컨디셔닝 목록에 없다", () => {
    const month = month531();
    const plan = planCoachedWeek({ month, weekIndex: 1 });
    const day = plan.days.find((row) => row.primary_training !== "rest" && row.recovery_role !== "rest");
    if (!day) throw new Error("no training day");
    const slot = {
      format: "for_time" as const,
      time_domain: "short" as const,
      duration_min: 12,
      stimulus: "heavy" as const,
      movement_pattern: "hinge" as const,
      primary_key: "deadlift",
      volume: "moderate" as const,
      metcon: false,
      movement_count: 2,
      companions: [] as string[],
      stretch: false,
      from_goal: false,
      primary_keys: [] as string[],
    };
    const open = buildSessionFrame({ area: "conditioning", day: { ...day, strength_lift: "none" }, slot });
    const closed = buildSessionFrame({
      area: "conditioning",
      day: { ...day, strength_lift: "none" },
      slot,
      skeletonCombo: { strengthLifts: ["ohp", "bench", "none"], deadliftConditioning: false },
    });
    const openKeys = open!.slots.flatMap((row) => row.movements.map((movement) => movement.key));
    const closedKeys = closed!.slots.flatMap((row) => row.movements.map((movement) => movement.key));
    expect(openKeys).toContain("deadlift");
    expect(closedKeys).not.toContain("deadlift");
    expect(closedKeys).not.toContain("romanian_deadlift");
    const strength = buildSessionFrame({
      area: "strength",
      day: { ...day, strength_lift: "squat" },
      slot,
      skeletonCombo: { strengthLifts: ["ohp", "bench", "none"], deadliftConditioning: false },
    });
    const strengthKeys = strength!.slots.flatMap((row) => row.movements.map((movement) => movement.key));
    expect(strengthKeys).not.toContain("back_squat");
    expect(strengthKeys).not.toContain("front_squat");
  });
});
