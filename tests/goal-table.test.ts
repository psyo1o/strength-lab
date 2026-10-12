import { describe, expect, it } from "vitest";
import { fallbackMonth } from "../src/lib/programming/fallback";
import {
  WEEKLY_PRIMARY_CAP,
  MONTHLY_PRIMARY_CAP,
  comboKey,
  deterministicGoalTable,
  goalTableErrors,
  slotsFromWeekGoal,
  weekGoalAlignmentErrors,
  weekTrainingLayout,
} from "../src/lib/programming/coaching/goal-table";
import { catalogRxWeights, rxLoadErrors } from "../src/lib/programming/coaching/movement-catalog";
import { slotFitErrors } from "../src/lib/programming/coaching/conditioning-board";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { movementKeysOverlap, similarityScore } from "../src/lib/programming/rules";
import { SIMILARITY_CONFIG, type StoredStructure } from "../src/lib/programming/types";

function month() {
  return fallbackMonth({ summary_ko: "블록을 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function structure(keys: string[]): StoredStructure {
  return {
    day: "mon",
    format: "amrap",
    time_domain: "short",
    stimulus: "high_rep",
    movement_patterns: ["engine"],
    movements: keys.map((key) => ({ key, amount: "10", name_ko: "동작" })),
    equipment: ["barbell"],
    rep_structure: "amrap",
    work_rest_structure: "amrap",
    duration_min: 12,
    volume: "moderate",
    intensity: "moderate",
    benchmark: false,
    long_conditioning: false,
  };
}

describe("monthly goal table", () => {
  it("rotates primary keys and keeps one rest day on the layout weekday", () => {
    const table = deterministicGoalTable(month());
    expect(goalTableErrors(table, month())).toEqual([]);
    const counts = new Map<string, number>();
    const combos = new Set<string>();
    for (const week of table.weeks) {
      const layout = weekTrainingLayout({ month: month(), weekIndex: week.week_index });
      const rests = week.days.filter((day) => day.rest);
      expect(rests.map((day) => day.day)).toEqual([layout.rest]);
      const weekCounts = new Map<string, number>();
      for (const day of week.days) {
        if (day.rest) continue;
        expect(day.primary_keys.length).toBeGreaterThanOrEqual(2);
        expect(day.primary_keys.length).toBeLessThanOrEqual(3);
        expect(new Set(day.primary_keys).size).toBe(day.primary_keys.length);
        expect(day.purpose.length).toBeGreaterThan(0);
        const combo = comboKey(day.primary_keys);
        expect(combos.has(combo)).toBe(false);
        combos.add(combo);
        for (const key of day.primary_keys) {
          weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      }
      for (const count of weekCounts.values()) expect(count).toBeLessThanOrEqual(WEEKLY_PRIMARY_CAP);
      const long = week.days.filter((day) => (day.duration_min ?? 0) >= 30);
      expect(long.length).toBe(month().long_conditioning_weeks.includes(week.week_index) ? 1 : 0);
    }
    for (const count of counts.values()) expect(count).toBeLessThanOrEqual(MONTHLY_PRIMARY_CAP);
  });

  it("rejects a reused metcon and a third weekly use, and locks rest to the table", () => {
    const table = deterministicGoalTable(month());
    const broken = structuredClone(table);
    const first = broken.weeks[0]!.days.find((day) => !day.rest)!;
    const second = broken.weeks[1]!.days.find((day) => !day.rest)!;
    second.primary_keys = [...first.primary_keys];
    expect(goalTableErrors(broken, month()).join(" ")).toMatch(/reuses movement combination/);
    const crowded = structuredClone(table);
    const training = crowded.weeks[0]!.days.filter((day) => !day.rest);
    const key = training[0]!.primary_keys[0]!;
    for (const day of training) {
      day.primary_keys = [key, `extra-${day.day}`, `more-${day.day}`];
    }
    expect(goalTableErrors(crowded, month()).join(" ")).toMatch(/weekly cap/);
    const source = month();
    const planned = { ...source, coaching_plan: deterministicMonthlyPlan(source) };
    const goal = planned.coaching_plan.goal_table!.weeks[2]!;
    const plan = planCoachedWeek({ month: planned, weekIndex: 3 });
    const moved = structuredClone(plan);
    const rest = moved.days.find((day) => day.primary_training === "rest")!;
    const train = moved.days.find((day) => day.primary_training !== "rest")!;
    rest.primary_training = "mixed_modal";
    rest.recovery_role = "train";
    train.primary_training = "rest";
    train.recovery_role = "rest";
    expect(weekGoalAlignmentErrors(moved, goal).join(" ")).toMatch(/rest must follow the monthly table/);
    expect(slotsFromWeekGoal(goal)[goal.days.find((day) => day.rest)!.day]).toBeUndefined();
  });

  it("counts a shared movement combination without lowering the threshold", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    expect(SIMILARITY_CONFIG.features.movement_combo).toBe(4);
    expect(movementKeysOverlap(["a", "b", "c"], ["c", "b", "d", "a"])).toBe(true);
    expect(movementKeysOverlap(["a", "b"], ["b", "a"])).toBe(true);
    expect(movementKeysOverlap(["a"], ["a"])).toBe(false);
    expect(movementKeysOverlap(["a", "b", "c"], ["a", "b"])).toBe(false);
    const left = structure(["row_erg", "burpee", "barbell_thruster"]);
    const right = {
      ...structure(["burpee", "barbell_thruster", "row_erg"]),
      day: "tue" as const,
      format: "for_time" as const,
      time_domain: "long" as const,
      stimulus: "heavy" as const,
      movement_patterns: ["squat" as const],
      equipment: ["bike" as const],
      volume: "low" as const,
    };
    expect(similarityScore(left, right)).toBe(4);
    expect(movementKeysOverlap([], [])).toBe(false);
  });

  it("requires catalog Rx weights and rejects a duplicate key", () => {
    const front = catalogRxWeights("front_squat");
    expect(front?.male.length).toBeGreaterThan(0);
    expect(catalogRxWeights("back_squat")).toBeNull();
    expect(rxLoadErrors("front_squat", null).join(" ")).toMatch(/load.male/);
    expect(rxLoadErrors("front_squat", { male: "95 lb", female: "65 lb" })).toEqual([]);
    expect(rxLoadErrors("front_squat", { male: "999 lb", female: "65 lb" }).join(" ")).toMatch(/95 lb/);
    const slot = slotsFromWeekGoal(deterministicGoalTable(month()).weeks[0]!)[ "mon" ];
    expect(slot?.primary_keys?.length).toBeGreaterThan(0);
    const dup = slotFitErrors(
      { conditioning: { movements: [{ key: slot!.primary_keys![0], load: null }, { key: slot!.primary_keys![0], load: null }] } },
      slot!,
      "none",
    );
    expect(dup.join(" ")).toMatch(/repeats a movement key/);
  });
});
