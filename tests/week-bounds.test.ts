import { describe, expect, it } from "vitest";
import { weeklyIntentErrors } from "../src/lib/programming/coaching/contract";
import { applyIntensityPatch } from "../src/lib/programming/coaching/intensity-patch";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { applyWeekGoalBounds, boundsFromWeekGoal, dayBoundsFromSkeleton, lockClassRestBounds, lowerLiftCapSum, weeklyResponseFormat } from "../src/lib/programming/coaching/week-bounds";
import type { WeekGoal } from "../src/lib/programming/types";
import type { WeekSkeleton } from "../src/lib/programming/direction/contract";
import { month531 } from "./characterization/support";

function skeleton(rows: Array<{ day: WeekSkeleton["days"][number]["day"]; rest?: boolean; intensity: number; pattern: "squat" | "hinge" | "press"; load: "heavy" | "moderate" }>): WeekSkeleton {
  return {
    weekId: "2099-11:w1",
    monthId: "2099-11",
    weekIndex: 1,
    directionHash: "hash",
    rulesVersion: "direction-v1",
    lock: { status: "locked", lockedAt: null, skeletonHash: "hash", lockedBy: "test", version: 1, previousHash: null, reason: null },
    days: rows.map((row) => ({
      date: `2099-11-02:${row.day}`,
      day: row.day,
      weekIndex: 1 as const,
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
        : [{ role: "main" as const, pattern: row.pattern, bodyPart: row.pattern === "press" ? "upper" : "lower", loadClass: row.load, durationBudgetMin: 12 }],
      totalBudgetMin: row.rest ? 0 : 12,
    })),
  };
}

describe("week bounds", () => {
  const rows = [
    { day: "mon" as const, intensity: 3, pattern: "squat" as const, load: "moderate" as const },
    { day: "tue" as const, intensity: 4, pattern: "hinge" as const, load: "heavy" as const },
    { day: "wed" as const, intensity: 4, pattern: "squat" as const, load: "heavy" as const },
    { day: "thu" as const, intensity: 3, pattern: "press" as const, load: "moderate" as const },
    { day: "fri" as const, intensity: 4, pattern: "hinge" as const, load: "heavy" as const },
    { day: "sat" as const, intensity: 3, pattern: "press" as const, load: "moderate" as const },
    { day: "sun" as const, intensity: 1, pattern: "press" as const, load: "moderate" as const, rest: true },
  ];

  it("heavy 요일은 4-5만, 하체 상한의 합은 주 규칙 2다", () => {
    expect(extractWeekRules({ month: month531(), weekIndex: 1 }).max_lower_lifts).toBe(2);
    const bounds = dayBoundsFromSkeleton(skeleton(rows), 2);
    expect(bounds).not.toBeNull();
    const heavy = bounds!.filter((day) => day.heavy).map((day) => day.day);
    expect(heavy).toEqual(["tue", "wed", "fri"]);
    for (const day of bounds!) {
      expect(day.intensity_profile).toEqual(day.heavy ? ["heavy"] : ["light", "moderate"]);
      expect(day.intensity_band).toBe(day.heavy ? "4-5" : "1-3");
    }
    expect(lowerLiftCapSum(bounds!)).toBe(2);
    expect(bounds!.find((day) => day.day === "mon")?.strength_lift).toContain("squat");
    expect(bounds!.find((day) => day.day === "tue")?.strength_lift).toContain("deadlift");
    expect(bounds!.find((day) => day.day === "wed")?.strength_lift).not.toContain("squat");
    expect(bounds!.find((day) => day.day === "fri")?.lower_lift_cap).toBe(0);
    const format = weeklyResponseFormat(bounds!);
    if (format.type !== "json_schema") throw new Error("expected json_schema");
    const schema = JSON.stringify(format);
    const days = format.json_schema.schema.properties as {
      days: { minItems: number; maxItems: number; items: { anyOf: Array<{ properties: { day: { enum: string[] }; intensity_profile: { enum: string[] }; strength_lift: { enum: string[] } } }> } };
    };
    expect(days.days.minItems).toBe(7);
    expect(days.days.maxItems).toBe(7);
    expect(days.days.items.anyOf).toHaveLength(7);
    const tue = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "tue");
    const mon = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "mon");
    expect(tue?.properties.intensity_profile.enum).toEqual(["heavy"]);
    expect(mon?.properties.intensity_profile.enum).toEqual(["light", "moderate"]);
    expect(schema).not.toContain("prefixItems");
    for (const row of days.days.items.anyOf) {
      expect(row.properties.intensity_profile.enum).not.toContain("mixed");
    }
  });

  it("코드는 허용 밖 강도를 넣지 않고 patch 횟수는 호출한 만큼만 센다", () => {
    const bounds = dayBoundsFromSkeleton(skeleton(rows), 2)!;
    const base = {
      days: rows.map((row) => ({
        day: row.day,
        intensity_profile: row.load === "heavy" ? "heavy" : "moderate",
        strength_lift: "none",
        movement_pattern: row.pattern,
      })),
    };
    const patched = applyIntensityPatch(
      base,
      { days: { tue: { intensity_profile: "light" }, thu: { intensity_profile: "heavy" }, sat: { intensity_profile: "light" } } },
      bounds,
    ) as typeof base;
    expect(patched.days.find((day) => day.day === "tue")?.intensity_profile).toBe("heavy");
    expect(patched.days.find((day) => day.day === "thu")?.intensity_profile).toBe("moderate");
    expect(patched.days.find((day) => day.day === "sat")?.intensity_profile).toBe("light");
    const illegal = {
      days: base.days.map((day) => (day.day === "thu" ? { ...day, intensity_profile: "heavy" } : day)),
    };
    expect(weeklyIntentErrors(illegal, bounds).join(" ")).toMatch(/day=thu/);
    const legal = {
      block_phase: "accumulation",
      emphasis: "mixed",
      why_ko: "week",
      focus: "week",
      scheme_note: "week",
      adjustment_ko: "week",
      days: bounds.map((bound) => {
        const rest = bound.strength_lift.length === 1 && bound.strength_lift[0] === "none";
        const lift = bound.strength_lift.includes("squat") ? "squat" : bound.strength_lift.includes("deadlift") ? "deadlift" : "none";
        return {
          day: bound.day,
          primary_training: rest ? "rest" : "lower_strength",
          secondary_training: "none",
          training_goal: "goal",
          stimulus: "volume_strength",
          intensity_profile: bound.intensity_profile[0],
          volume_profile: "moderate",
          duration_profile: rest ? "rest" : "45-60",
          fatigue_target: "moderate",
          movement_pattern: lift === "squat" ? "squat" : lift === "deadlift" ? "hinge" : rest ? "none" : "press",
          progression_required: false,
          recovery_role: rest ? "rest" : "train",
          strength_lift: lift,
          benchmark: false,
          notes_ko: "note",
        };
      }),
    };
    expect(weeklyIntentErrors(legal, bounds)).toEqual([]);
  });

  it("목표 표의 long 요일만 long_conditioning을 남긴다", () => {
    const bounds = dayBoundsFromSkeleton(skeleton(rows), 2)!;
    const goal: WeekGoal = {
      week_index: 1,
      goal: "표",
      days: bounds.map((bound) => ({
        day: bound.day,
        rest: bound.day === "sun",
        purpose: "목적",
        focus: null,
        intensity: null,
        target: bound.day === "sun" ? null : { movement_pattern: "hinge", body_region: "lower", energy_system: "phosphagen" },
        stimulus: null,
        time_domain: bound.day === "sat" ? "long" : "short",
      })),
    };
    const narrowed = applyWeekGoalBounds(bounds, goal);
    const format = weeklyResponseFormat(narrowed);
    if (format.type !== "json_schema") throw new Error("expected json_schema");
    const days = format.json_schema.schema.properties as {
      days: { items: { anyOf: Array<{ properties: { day: { enum: string[] }; secondary_training: { enum: string[] }; stimulus: { enum: string[] }; movement_pattern: { enum: string[] }; primary_training: { enum: string[] } } }> } };
    };
    const sat = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "sat");
    const mon = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "mon");
    const sun = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "sun");
    expect(sat?.properties.secondary_training.enum).toEqual(["long_conditioning"]);
    expect(mon?.properties.secondary_training.enum).not.toContain("long_conditioning");
    expect(mon?.properties.stimulus.enum).not.toContain("long_mixed");
    expect(mon?.properties.movement_pattern.enum).toEqual(["hinge"]);
    expect(sun?.properties.primary_training.enum).toEqual(["rest"]);
    const open = boundsFromWeekGoal(goal);
    expect(open).toHaveLength(7);
    expect(open.find((day) => day.day === "sat")?.secondary_training).toEqual(["long_conditioning"]);
    expect(open.find((day) => day.day === "mon")?.movement_pattern).toEqual(["hinge"]);
  });

  it("closes Sunday as the only rest day even when the goal rests on Wednesday", () => {
    const bounds = boundsFromWeekGoal({
      week_index: 2,
      goal: "수요일 휴식",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({
        day: day as "wed",
        rest: day === "wed",
        purpose: "목적",
        focus: null,
        intensity: null,
        target: null,
        stimulus: null,
        time_domain: null,
      })),
    });
    const locked = lockClassRestBounds(bounds, "sun");
    const format = weeklyResponseFormat(locked);
    if (format.type !== "json_schema") throw new Error("expected json_schema");
    const days = format.json_schema.schema.properties as {
      days: { items: { anyOf: Array<{ properties: { day: { enum: string[] }; primary_training: { enum: string[] }; recovery_role: { enum: string[] } } }> } };
    };
    const sun = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "sun");
    const wed = days.days.items.anyOf.find((row) => row.properties.day.enum[0] === "wed");
    expect(sun?.properties.primary_training.enum).toEqual(["rest"]);
    expect(sun?.properties.recovery_role.enum).toEqual(["rest"]);
    expect(wed?.properties.primary_training.enum).not.toContain("rest");
    expect(wed?.properties.recovery_role.enum).not.toContain("rest");
  });
});
