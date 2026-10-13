import { describe, expect, it } from "vitest";
import { weeklyIntentErrors } from "../src/lib/programming/coaching/contract";
import { applyIntensityPatch } from "../src/lib/programming/coaching/intensity-patch";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { dayBoundsFromSkeleton, lowerLiftCapSum, weeklyResponseFormat } from "../src/lib/programming/coaching/week-bounds";
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
});
