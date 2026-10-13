import { describe, expect, it } from "vitest";
import { buildGoalTable, GOAL_TABLE_RULES } from "../src/lib/programming/coaching/goal-table";
import { weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { dayBoundsFromSkeleton } from "../src/lib/programming/coaching/week-bounds";
import { attachZone2, pinZone2, placeZone2, zone2Form, zone2Modalities, zone2RuleErrors } from "../src/lib/programming/coaching/zone2";
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
  it("훈련일 수 2–7의 형태와 블록 수가 표와 같다", () => {
    expect(zone2Form(2)).toBe("none");
    expect(zone2Form(3)).toBe("addon");
    expect(zone2Form(4)).toBe("addon");
    expect(zone2Form(5)).toBe("day");
    expect(zone2Form(6)).toBe("day");
    expect(zone2Form(7)).toBe("day");
    expect(GOAL_TABLE_RULES.zone2.blocks.none).toBe(0);
    expect(GOAL_TABLE_RULES.zone2.blocks.addon).toBe(1);
    expect(GOAL_TABLE_RULES.zone2.blocks.day).toBe(1);
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

  it("addon은 고강도 컨디셔닝을 빼고 하체 인접에서 run을 뺀다", () => {
    const skeleton = week({
      id: "addon",
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
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 4, previous: null, next: null, deload: false });
    expect(skeleton.zone2.form).toBe("addon");
    expect(skeleton.zone2.allowedDays).not.toContain("fri");
    expect(skeleton.zone2.lowerAdjacent).toContain("mon");
    expect(skeleton.zone2.lowerAdjacent).toContain("tue");
    const bounds = dayBoundsFromSkeleton(skeleton, 2, { previousModality: "row_erg" })!;
    const host = bounds.find((day) => day.day === skeleton.zone2?.allowedDays[0]);
    expect(host?.zone2).toEqual(["addon"]);
    expect(host?.zone2_modality).not.toContain("run");
    expect(host?.zone2_modality).not.toContain("row_erg");
    expect(host?.zone2_modality).toContain("bike_erg");
    expect(bounds.find((day) => day.day === "fri")?.zone2).toEqual(["none"]);
    expect(bounds.filter((day) => day.zone2?.includes("addon"))).toHaveLength(1);
    expect(zone2Modalities(true, "bike_erg")).toEqual(["row_erg", "assault_bike"]);
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

  it("딜로드도 형태를 유지하고 30분 강도 1이다", () => {
    const skeleton = six("2099-03-23", 4);
    skeleton.zone2 = placeZone2({ skeleton, trainingDays: 6, deload: true });
    expect(skeleton.zone2.form).toBe("day");
    const bounds = dayBoundsFromSkeleton(skeleton, 2)!;
    const host = bounds.find((day) => day.zone2?.includes("day"))!;
    expect(host.zone2).toEqual(["day"]);
    expect(host.zone2_duration).toEqual(["30"]);
    expect(host.zone2_effort).toEqual(["1"]);
    const hostDay = host.day;
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [hostDay]: { zone2: "day", modality: "bike_erg", duration: 30, effort: "1", hr: "unspecified", intensity: "light" } }),
      }),
    ).toEqual([]);
    expect(
      zone2RuleErrors({
        trainingDays: 6,
        zone2: skeleton.zone2,
        planDays: planDays({ [hostDay]: { zone2: "day", modality: "bike_erg", duration: 45, effort: "conversational", hr: "60-70", intensity: "light" } }),
      }).join(" "),
    ).toMatch(/duration/);
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
    const noneWeek = placeZone2({ skeleton, trainingDays: 2, deload: false });
    expect(noneWeek.form).toBe("none");
    expect(zone2RuleErrors({ trainingDays: 2, zone2: noneWeek, planDays: planDays({}) })).toEqual([]);
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

  it("주 3·4·5일 표가 열리고 뼈대 주석이 해시를 바꾸지 않는다", () => {
    for (const available of [
      ["mon", "wed", "fri"],
      ["mon", "tue", "thu", "fri"],
      ["mon", "tue", "wed", "thu", "fri"],
    ] as const) {
      const built = buildGoalTable({ month: { ...month(), available_days: [...available] } });
      expect(built.ok, available.join(",")).toBe(true);
    }
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
