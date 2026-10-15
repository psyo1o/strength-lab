import { describe, expect, it } from "vitest";
import { buildGoalTable, GOAL_TABLE_RULES } from "../src/lib/programming/coaching/goal-table";
import { weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { shortMetconErrors } from "../src/lib/programming/coaching/short-metcon";
import { zone2SlotSchema } from "../src/lib/programming/coaching/slot-choices";
import { dayBoundsFromSkeleton } from "../src/lib/programming/coaching/week-bounds";
import { attachZone2, lowerAdjacentRunErrors, pinZone2, placeZone2, previousZone2Modality, zone2Form, zone2Modalities, zone2RuleErrors, zone2SlotSpec } from "../src/lib/programming/coaching/zone2";
import { evaluateWeek } from "../src/lib/programming/evaluate-week";
import { withCoachingPlan } from "../src/lib/programming/coaching/monthly";
import { skeletonContentHash, type SkeletonDay, type WeekSkeleton } from "../src/lib/programming/direction/contract";
import { lockedSkeletonDrift } from "../src/lib/programming/direction/skeleton";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";
import type { WeeklyIntentPlan } from "../src/lib/programming/types";

function month() {
  return withCoachingPlan(fallbackMonth({ summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531", strength_method: "531" }));
}

function addDate(start: string, index: number): string {
  return new Date(Date.parse(`${start}T00:00:00.000Z`) + index * 86400000).toISOString().slice(0, 10);
}

function dayOf(input: {
  date: string;
  day: DayKey;
  rest?: boolean;
  intensity: number;
  pattern: "squat" | "hinge" | "press" | "engine" | "gymnastic";
  load: "heavy" | "moderate" | "light";
  body?: "lower" | "upper" | "full";
  focus?: SkeletonDay["direction"]["focus"];
  timeDomain?: "short" | "medium" | "long";
  weekIndex?: 1 | 2 | 3 | 4;
}): SkeletonDay {
  const rest = input.rest === true;
  const body = input.body ?? (input.pattern === "press" ? "upper" : input.pattern === "engine" || input.pattern === "gymnastic" ? "full" : "lower");
  return {
    date: input.date,
    day: input.day,
    weekIndex: input.weekIndex ?? 1,
    dayType: rest ? "rest" : "train",
    direction: {
      focus: rest ? null : (input.focus ?? (body === "lower" ? "lower_strength" : input.pattern === "engine" ? "engine_endurance" : "upper_strength")),
      intensity: rest ? null : input.intensity,
      targets: { bodyParts: rest ? [] : [body], movementPatterns: rest ? [] : [input.pattern], energySystems: [] },
      stimulus: { type: null, timeDomain: rest ? "n/a" : (input.timeDomain ?? "short") },
      purpose: "x",
    },
    slots: rest ? [] : [{ role: "main", pattern: input.pattern, bodyPart: body, loadClass: input.load, durationBudgetMin: 12 }],
    totalBudgetMin: rest ? 0 : 12,
  };
}

function week(input: { id: string; start: string; weekIndex?: 1 | 2 | 3 | 4; days: SkeletonDay[] }): WeekSkeleton {
  return {
    weekId: input.id,
    monthId: "2099-03",
    weekIndex: input.weekIndex ?? 1,
    directionHash: "hash",
    rulesVersion: "direction-v1",
    days: input.days,
    lock: { status: "locked", lockedAt: null, skeletonHash: "kept", lockedBy: "test", version: 1, previousHash: null, reason: null },
  };
}

function six(start: string, weekIndex: 1 | 2 | 3 | 4 = 1): WeekSkeleton {
  const rows: Array<Parameters<typeof dayOf>[0]> = [
    { date: addDate(start, 0), day: "mon", intensity: 5, pattern: "hinge", load: "heavy" },
    { date: addDate(start, 1), day: "tue", intensity: 3, pattern: "press", load: "moderate" },
    { date: addDate(start, 2), day: "wed", intensity: 4, pattern: "squat", load: "heavy" },
    { date: addDate(start, 3), day: "thu", intensity: 3, pattern: "press", load: "moderate" },
    { date: addDate(start, 4), day: "fri", intensity: 3, pattern: "engine", load: "moderate", timeDomain: "long" },
    { date: addDate(start, 5), day: "sat", intensity: 2, pattern: "press", load: "light" },
    { date: addDate(start, 6), day: "sun", intensity: 1, pattern: "press", load: "light", rest: true },
  ];
  return week({ id: start, start, weekIndex, days: rows.map((row) => dayOf({ ...row, weekIndex })) });
}

function planDays(marks: Partial<Record<DayKey, { zone2: "none" | "addon" | "day"; modality?: string; duration?: number; effort?: string; hr?: string; intensity?: string }>>) {
  return DAY_ORDER.map((day) => {
    const mark = marks[day];
    return {
      day,
      zone2: mark?.zone2 ?? "none",
      zone2_modality: mark?.modality ?? "none",
      zone2_duration: mark?.duration ?? 0,
      zone2_effort: mark?.effort ?? "none",
      zone2_hr: mark?.hr ?? "none",
      intensity_profile: mark?.intensity ?? "moderate",
    };
  });
}

describe("zone2 rules", () => {
  it("주 6일 존 2는 항상 별도 하루이고 블록은 하나다", () => {
    for (const days of [2, 3, 4, 5, 6, 7]) expect(zone2Form(days)).toBe("day");
    expect(GOAL_TABLE_RULES.zone2.form).toBe("day");
    expect(GOAL_TABLE_RULES.zone2.blocks.day).toBe(1);
    expect(GOAL_TABLE_RULES.zone2.duration.day).toEqual([40, 45]);
    expect(GOAL_TABLE_RULES.zone2.duration.deload).toEqual([30]);
    expect(GOAL_TABLE_RULES.zone2.effort).toEqual(["conversational"]);
    expect(GOAL_TABLE_RULES.zone2.countsTowardHighIntensity).toBe(false);
  });

  it("day는 heavy 하체 다음 날을 우선하고 주 경계를 본다", () => {
    const current = six("2099-03-02");
    const next = week({
      id: "next",
      start: "2099-03-09",
      days: [dayOf({ date: "2099-03-09", day: "mon", intensity: 5, pattern: "squat", load: "heavy" })],
    });
    const sundayTrain = week({
      id: "sun",
      start: "2099-03-02",
      days: current.days.map((day) => (day.day === "sun" ? dayOf({ date: "2099-03-08", day: "sun", intensity: 2, pattern: "press", load: "light", body: "upper" }) : day)),
    });
    const placed = placeZone2({ skeleton: sundayTrain, trainingDays: 7, previous: null, next, deload: false });
    expect(placed.form).toBe("day");
    expect(placed.blockedNext).toContain("tue");
    expect(placed.blockedNext).toContain("sun");
    expect(placed.allowedDays).toEqual(["thu"]);
    expect(placed.allowedDays).not.toContain("tue");
    expect(placed.allowedDays).not.toContain("sun");
  });

  it("지난주 일요일 heavy 하체 다음인 월요일이 day 우선이다", () => {
    const previous = week({
      id: "prev",
      start: "2099-02-23",
      days: DAY_ORDER.map((day, index) =>
        dayOf({
          date: addDate("2099-02-23", index),
          day,
          intensity: day === "sun" ? 5 : 2,
          pattern: day === "sun" ? "hinge" : "press",
          load: day === "sun" ? "heavy" : "light",
          rest: day !== "sun" && day !== "mon",
        }),
      ),
    });
    const current = week({
      id: "cur",
      start: "2099-03-02",
      days: DAY_ORDER.map((day, index) =>
        dayOf({
          date: addDate("2099-03-02", index),
          day,
          rest: day === "sun",
          intensity: 3,
          pattern: "press",
          load: "moderate",
          body: "upper",
        }),
      ),
    });
    const placed = placeZone2({ skeleton: current, trainingDays: 6, previous, next: null, deload: false });
    expect(placed.allowedDays).toContain("mon");
    expect(placed.blockedNext).not.toContain("mon");
  });

  it("heavy 하체 다음 날은 run을 뺀 뒤 직전 주 모달만 뺀다", () => {
    const skeleton = week({
      id: "day-host",
      start: "2099-04-06",
      days: [
        dayOf({ date: "2099-04-06", day: "mon", intensity: 5, pattern: "hinge", load: "heavy" }),
        dayOf({ date: "2099-04-07", day: "tue", intensity: 3, pattern: "press", load: "moderate", body: "upper" }),
        dayOf({ date: "2099-04-08", day: "wed", intensity: 1, pattern: "press", load: "light", rest: true }),
        dayOf({ date: "2099-04-09", day: "thu", intensity: 3, pattern: "press", load: "moderate", body: "upper" }),
        dayOf({ date: "2099-04-10", day: "fri", intensity: 5, pattern: "engine", load: "heavy", timeDomain: "long" }),
        dayOf({ date: "2099-04-11", day: "sat", intensity: 1, pattern: "press", load: "light", rest: true }),
        dayOf({ date: "2099-04-12", day: "sun", intensity: 1, pattern: "press", load: "light", rest: true }),
      ],
    });
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, previous: null, next: null, deload: false });
    expect(skeleton.zone2.form).toBe("day");
    expect(skeleton.zone2.allowedDays).toEqual(["tue"]);
    expect(skeleton.zone2.lowerAdjacent).toContain("tue");
    const bounds = dayBoundsFromSkeleton(skeleton, 2, { previousModality: "row_erg" })!;
    const host = bounds.find((day) => day.day === "tue");
    expect(host?.zone2).toEqual(["day"]);
    expect(host?.zone2_modality).toEqual(["bike_erg", "assault_bike", "ski_erg"]);
    expect(host?.zone2_modality).not.toContain("run");
    expect(host?.zone2_duration).toEqual(["40", "45"]);
    expect(host?.zone2_effort).toEqual(["conversational"]);
    expect(bounds.find((day) => day.day === "fri")?.zone2).toEqual(["none"]);
    expect(bounds.filter((day) => day.zone2?.includes("day"))).toHaveLength(1);
    expect(zone2Modalities("bike_erg")).toEqual(["row_erg", "assault_bike", "run", "ski_erg"]);
    expect(zone2Modalities("row_erg", { dropRun: true })).toEqual(["bike_erg", "assault_bike", "ski_erg"]);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ tue: { zone2: "day", modality: "run", duration: 40, effort: "conversational", hr: "60-70", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/must be one of row_erg\|bike_erg\|assault_bike\|ski_erg/);
  });

  it("day 허용 요일은 light만이고 존 2는 고강도 상한에 안 들어간다", () => {
    const skeleton = six("2099-03-02");
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, deload: false });
    const before = skeleton.lock.skeletonHash;
    skeleton.lock.skeletonHash = skeletonContentHash(skeleton);
    expect(skeletonContentHash(skeleton)).toBe(skeleton.lock.skeletonHash);
    expect(lockedSkeletonDrift(skeleton)).toBeNull();
    expect(before).toBe("kept");
    const bounds = dayBoundsFromSkeleton(skeleton, 2)!;
    const host = bounds.find((day) => day.zone2?.includes("day"));
    expect(host?.intensity_profile).toEqual(["light"]);
    expect(host?.intensity_band).toBe("1-2");
    const heavy = bounds.filter((day) => day.heavy).length;
    const rules = extractWeekRules({ month: month(), weekIndex: 1 });
    const days = bounds.map((bound) => ({
      day: bound.day,
      primary_training: bound.day === "sun" ? "rest" : "upper_strength",
      secondary_training: "none",
      intensity_profile: bound.intensity_profile[0],
      volume_profile: "moderate",
      strength_lift: "none",
      benchmark: false,
      recovery_role: bound.day === "sun" ? "rest" : "train",
    }));
    const errors = weekPlanErrors(
      { strength_method: rules.strength_method, block_phase: "accumulation", days } as WeeklyIntentPlan,
      rules,
    );
    expect(errors.some((error) => error.includes("high intensity"))).toBe(false);
    expect(heavy).toBeLessThanOrEqual(rules.max_high_intensity_days);
  });

  it("딜로드도 별도 하루이고 30분 대화 가능 페이스다", () => {
    const skeleton = six("2099-03-23", 4);
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, deload: true });
    expect(skeleton.zone2.form).toBe("day");
    const bounds = dayBoundsFromSkeleton(skeleton, 2)!;
    const host = bounds.find((day) => day.zone2?.includes("day"))!;
    expect(host.zone2).toEqual(["day"]);
    expect(host.zone2_duration).toEqual(["30"]);
    expect(host.zone2_effort).toEqual(["conversational"]);
    const hostDay = host.day;
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [hostDay]: { zone2: "day", modality: "bike_erg", duration: 30, effort: "conversational", hr: "unspecified", intensity: "light" } }),
      }),
    ).toEqual([]);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [hostDay]: { zone2: "day", modality: "bike_erg", duration: 45, effort: "conversational", hr: "60-70", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/duration/);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [hostDay]: { zone2: "day", modality: "bike_erg", duration: 30, effort: "1", hr: "unspecified", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/effort/);
  });

  it("블록 수, 단일 모달, 시간, 인접 금지를 공유 규칙으로 거절한다", () => {
    const skeleton = six("2099-03-02");
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, deload: false });
    const host = skeleton.zone2.allowedDays[0]!;
    const legal = zone2RuleErrors({
      trainingDays: 6,
      zone2: skeleton.zone2,
      planDays: planDays({ [host]: { zone2: "day", modality: "row_erg", duration: 40, effort: "conversational", hr: "60-70", intensity: "light" } }),
    });
    expect(legal).toEqual([]);
    const stillDay = placeZone2({ skeleton, trainingDays: 2, deload: false });
    expect(stillDay.form).toBe("day");
    expect(zone2RuleErrors({ trainingDays: 6, zone2: stillDay, planDays: planDays({}) }).join(" ")).toMatch(/blocks 0/);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [host]: { zone2: "day", modality: "row_erg", duration: 30, effort: "conversational", hr: "60-70", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/duration/);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({}),
      }).join(" "),
    ).toMatch(/blocks 0/);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        previousModality: "bike_erg",
        planDays: planDays({ [host]: { zone2: "day", modality: "bike_erg", duration: 40, effort: "conversational", hr: "60-70", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/modality/);
    const blocked = skeleton.zone2.blockedNext[0];
    if (blocked) {
      expect(
        zone2RuleErrors({
          trainingDays: 6,
          zone2: { ...skeleton.zone2, allowedDays: [blocked] },
          planDays: planDays({ [blocked]: { zone2: "day", modality: "row_erg", duration: 40, effort: "conversational", hr: "unspecified", intensity: "light" } }),
        }).join(" "),
      ).toMatch(/heavy lower/);
    }
  });

  it("연속 4주 하체 인접 A enum은 run을 뺀 뒤 직전 주 run·row_erg·bike_erg를 뺀다", () => {
    const withoutRun = ["row_erg", "bike_erg", "assault_bike", "ski_erg"];
    const picksBySeed: Record<string, string[]> = {};
    for (const seed of ["run", "row_erg", "bike_erg"] as const) {
      const plans: WeeklyIntentPlan[] = [
        { days: planDays({ tue: { zone2: "day", modality: seed, duration: 40, effort: "conversational", hr: "60-70", intensity: "light" } }) } as WeeklyIntentPlan,
      ];
      const picks: string[] = [];
      for (let index = 0; index < 4; index += 1) {
        const start = addDate("2099-04-06", index * 7);
        const weekIndex = ((index % 4) + 1) as 1 | 2 | 3 | 4;
        const skeleton = week({
          id: `${seed}-${start}`,
          start,
          weekIndex,
          days: [
            dayOf({ date: addDate(start, 0), day: "mon", intensity: 5, pattern: "hinge", load: "heavy", weekIndex }),
            dayOf({ date: addDate(start, 1), day: "tue", intensity: 3, pattern: "press", load: "moderate", body: "upper", weekIndex }),
            dayOf({ date: addDate(start, 2), day: "wed", intensity: 1, pattern: "press", load: "light", rest: true, weekIndex }),
            dayOf({ date: addDate(start, 3), day: "thu", intensity: 3, pattern: "press", load: "moderate", body: "upper", weekIndex }),
            dayOf({ date: addDate(start, 4), day: "fri", intensity: 5, pattern: "engine", load: "heavy", timeDomain: "long", weekIndex }),
            dayOf({ date: addDate(start, 5), day: "sat", intensity: 1, pattern: "press", load: "light", rest: true, weekIndex }),
            dayOf({ date: addDate(start, 6), day: "sun", intensity: 1, pattern: "press", load: "light", rest: true, weekIndex }),
          ],
        });
        skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, previous: null, next: null, deload: index === 3 });
        const previous = previousZone2Modality(plans);
        const spec = zone2SlotSpec({
          zone2: "day",
          blockPhase: index === 3 ? "deload" : "accumulation",
          weekIndex,
          recentPlans: plans,
          dropRun: skeleton.zone2.lowerAdjacent.includes("tue"),
        });
        expect(spec?.dropRun).toBe(true);
        expect(spec?.previousModality ?? null).toBe(previous);
        const bounds = dayBoundsFromSkeleton(skeleton, 2, { previousModality: previous })!;
        const host = bounds.find((day) => day.zone2?.includes("day"))!;
        expect(host.day).toBe("tue");
        expect(skeleton.zone2.lowerAdjacent).toContain("tue");
        const schema = zone2SlotSchema({ deload: spec!.deload, previousModality: spec!.previousModality, dropRun: spec!.dropRun });
        const properties = schema.properties as {
          primary: { properties: { modality: { enum: string[] } } };
          alternate: { properties: { ergo: { anyOf: Array<{ properties: { movement_id: { enum: string[] } } }> } } };
        };
        const allowed = properties.primary.properties.modality.enum;
        const ergo = properties.alternate.properties.ergo.anyOf.map((branch) => branch.properties.movement_id.enum[0]);
        expect(allowed).toEqual(host.zone2_modality);
        expect(allowed.length).toBeGreaterThan(0);
        expect(allowed).not.toContain("run");
        expect(ergo).not.toContain("run");
        if (previous && previous !== "run") expect(allowed).not.toContain(previous);
        if (previous === "run") expect(allowed).toEqual(withoutRun);
        const pick = allowed[0]!;
        picks.push(pick);
        plans.push({ days: planDays({ tue: { zone2: "day", modality: pick, duration: index === 3 ? 30 : 40, effort: "conversational", hr: "60-70", intensity: "light" } }) } as WeeklyIntentPlan);
      }
      picksBySeed[seed] = picks;
    }
    expect(picksBySeed.run).toEqual(["row_erg", "bike_erg", "row_erg", "bike_erg"]);
    expect(picksBySeed.row_erg).toEqual(["bike_erg", "row_erg", "bike_erg", "row_erg"]);
    expect(picksBySeed.bike_erg).toEqual(["row_erg", "bike_erg", "row_erg", "bike_erg"]);
    expect(zone2Modalities("run", { dropRun: true })).toEqual(withoutRun);
    expect(zone2Modalities("row_erg", { dropRun: true, catalog: ["run", "row_erg"] })).toEqual(["row_erg"]);
    expect(zone2Modalities("run", { dropRun: true, catalog: ["run"] })).toEqual([]);
    expect(zone2Modalities("bike_erg", { dropRun: true, catalog: ["run"] })).toEqual(["bike_erg"]);
    expect(zone2Modalities("row_erg", { catalog: [] })).toEqual(["row_erg"]);
    expect(zone2Modalities("run", { catalog: [] })).toEqual([]);
    expect(
      shortMetconErrors({
        deload: false,
        dropRun: true,
        format: "amrap",
        duration: 12,
        rpe: "4",
        intensity: 2,
        ergo: "run",
        bodyweight: "push_up",
      }).join(" "),
    ).toMatch(/run/);
  });

  it("하체 날의 존 2는 run을 빼고 하체가 아닌 날은 run을 남긴다", () => {
    const lower = week({
      id: "lower-host",
      start: "2099-05-04",
      days: DAY_ORDER.map((day, index) =>
        dayOf({
          date: addDate("2099-05-04", index),
          day,
          rest: day === "sun",
          intensity: 3,
          pattern: day === "mon" ? "squat" : "press",
          load: "moderate",
          body: day === "mon" ? "lower" : "upper",
        }),
      ),
    });
    lower.zone2 = placeZone2({ skeleton: lower, trainingDays: 6, previous: null, next: null, deload: false });
    expect(lower.zone2.allowedDays).toEqual(["mon"]);
    expect(lower.zone2.lowerAdjacent).toContain("mon");
    const lowerHost = dayBoundsFromSkeleton(lower, 2, { previousModality: "ski_erg" })!.find((day) => day.day === "mon");
    expect(lowerHost?.zone2_modality).toEqual(["row_erg", "bike_erg", "assault_bike"]);
    expect(lowerHost?.zone2_modality).not.toContain("run");
    const upper = week({
      id: "upper-host",
      start: "2099-05-11",
      days: DAY_ORDER.map((day, index) =>
        dayOf({
          date: addDate("2099-05-11", index),
          day,
          rest: day === "sun",
          intensity: 3,
          pattern: "press",
          load: "moderate",
          body: "upper",
        }),
      ),
    });
    upper.zone2 = placeZone2({ skeleton: upper, trainingDays: 6, previous: null, next: null, deload: false });
    expect(upper.zone2.lowerAdjacent).toEqual([]);
    const upperHost = dayBoundsFromSkeleton(upper, 2, { previousModality: "row_erg" })!.find((day) => day.zone2?.includes("day"));
    expect(upperHost?.zone2_modality).toContain("run");
    expect(upperHost?.zone2_modality).not.toContain("row_erg");
  });

  it("evaluateWeek는 하체 인접 날의 run을 BLOCK한다", () => {
    const skeleton = week({
      id: "eval-run",
      start: "2099-04-06",
      days: [
        dayOf({ date: "2099-04-06", day: "mon", intensity: 5, pattern: "hinge", load: "heavy" }),
        dayOf({ date: "2099-04-07", day: "tue", intensity: 3, pattern: "press", load: "moderate", body: "upper" }),
      ],
    });
    skeleton.zone2 = placeZone2({
      skeleton: week({
        id: "eval-full",
        start: "2099-04-06",
        days: [
          dayOf({ date: "2099-04-06", day: "mon", intensity: 5, pattern: "hinge", load: "heavy" }),
          dayOf({ date: "2099-04-07", day: "tue", intensity: 3, pattern: "press", load: "moderate", body: "upper" }),
          dayOf({ date: "2099-04-08", day: "wed", intensity: 1, pattern: "press", load: "light", rest: true }),
          dayOf({ date: "2099-04-09", day: "thu", intensity: 3, pattern: "press", load: "moderate", body: "upper" }),
          dayOf({ date: "2099-04-10", day: "fri", intensity: 5, pattern: "engine", load: "heavy", timeDomain: "long" }),
          dayOf({ date: "2099-04-11", day: "sat", intensity: 1, pattern: "press", load: "light", rest: true }),
          dayOf({ date: "2099-04-12", day: "sun", intensity: 1, pattern: "press", load: "light", rest: true }),
        ],
      }),
      trainingDays: 6,
      previous: null,
      next: null,
      deload: false,
    });
    const raw = {
      sessions: [
        {
          day: "tue",
          zone2: {
            modality: "run",
            alternate: { movements: [{ key: "run" }, { key: "push_up" }] },
          },
        },
      ],
    };
    expect(lowerAdjacentRunErrors(raw, skeleton.zone2.lowerAdjacent).join(" ")).toMatch(/run/);
    expect(GOAL_TABLE_RULES.zone2.bannedOnLowerAdjacent).toBe("run");
    const verdict = evaluateWeek(raw, month(), 1, [], { weekSkeleton: skeleton });
    expect(verdict.status).toBe("BLOCK");
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.join(" ")).toMatch(/tue zone2 modality run/);
    expect(verdict.errors.join(" ")).toMatch(/tue short metcon run/);
  });

  it("요일을 옮겨도 존 2 블록은 허용된 첫째 날에 남는다", () => {
    const skeleton = six("2099-03-02");
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, deload: false });
    const host = skeleton.zone2.allowedDays[0]!;
    const other = host === "mon" ? "tue" : "mon";
    const days = planDays({ [other]: { zone2: "day", modality: "row_erg", duration: 40, effort: "conversational", hr: "60-70", intensity: "heavy" } });
    const pinned = pinZone2({ days } as WeeklyIntentPlan, skeleton.zone2);
    expect(pinned.days.find((day) => day.day === host)?.zone2).toBe("day");
    expect(pinned.days.find((day) => day.day === host)?.zone2_modality).toBe("row_erg");
    expect(pinned.days.find((day) => day.day === host)?.intensity_profile).toBe("light");
    expect(pinned.days.find((day) => day.day === other)?.zone2).toBe("none");
    expect(
      zone2RuleErrors({ trainingDays: 6, zone2: skeleton.zone2, planDays: pinned.days }),
    ).toEqual([]);
  });

  it("주 6일 뼈대 주석이 해시를 바꾸지 않고 4주는 딜로드다", () => {
    const built = buildGoalTable({ month: month() });
    expect(built.ok).toBe(true);
    const skeletons = [six("2099-03-02"), six("2099-03-09"), six("2099-03-16", 3), six("2099-03-23", 4)];
    for (const skeleton of skeletons) skeleton.lock.skeletonHash = skeletonContentHash(skeleton);
    const hashes = skeletons.map((skeleton) => skeleton.lock.skeletonHash);
    attachZone2(skeletons, month());
    skeletons.forEach((skeleton, index) => {
      expect(skeleton.zone2?.form).toBe("day");
      expect(skeleton.lock.skeletonHash).toBe(hashes[index]);
      expect(lockedSkeletonDrift(skeleton)).toBeNull();
    });
    expect(skeletons[3]?.zone2?.deload).toBe(true);
    expect(skeletons[0]?.zone2?.allowedDays).not.toContain("sun");
  });
});
