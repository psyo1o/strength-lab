import { describe, expect, it } from "vitest";
import { fallbackMonth } from "../src/lib/programming/fallback";
import {
  deterministicGoalTable,
  goalTableErrors,
  movementFrequency,
  placementSignature,
  slotsFromWeekGoal,
  weekGoalAlignmentErrors,
  weekTrainingLayout,
} from "../src/lib/programming/coaching/goal-table";
import { catalogRxWeights, rxLoadErrors } from "../src/lib/programming/coaching/movement-catalog";
import { slotFitErrors } from "../src/lib/programming/coaching/conditioning-board";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { movementKeysOverlap, similarityScore } from "../src/lib/programming/rules";
import { SIMILARITY_CONFIG, type DaySessionGoal, type StoredStructure } from "../src/lib/programming/types";
import { DAY_ORDER } from "../src/lib/month-plan/types";

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
  it("places focus targets without movement keys and keeps the layout rest day", () => {
    const table = deterministicGoalTable(month());
    expect(goalTableErrors(table, month())).toEqual([]);
    const weekday = new Map<string, Set<string>>();
    for (const week of table.weeks) {
      const layout = weekTrainingLayout({ month: month(), weekIndex: week.week_index });
      expect(week.days.filter((day) => day.rest).map((day) => day.day)).toEqual([layout.rest]);
      const signatures = new Set<string>();
      for (const day of week.days) {
        expect(day).not.toHaveProperty("primary_keys");
        expect(day).not.toHaveProperty("strength_key");
        if (day.rest) continue;
        expect(day.focus).toBeTruthy();
        expect(day.target?.movement_pattern).toBeTruthy();
        expect(day.intensity).toBeGreaterThanOrEqual(1);
        expect(day.intensity).toBeLessThanOrEqual(5);
        expect(day.purpose.length).toBeGreaterThan(0);
        expect(day.purpose).not.toMatch(/[a-z]+_[a-z]+/);
        const signature = placementSignature(day);
        expect(signatures.has(signature)).toBe(false);
        signatures.add(signature);
        const seen = weekday.get(day.day) ?? new Set<string>();
        expect(seen.has(signature)).toBe(false);
        seen.add(signature);
        weekday.set(day.day, seen);
      }
      const long = week.days.filter((day) => day.time_domain === "long");
      expect(long.length).toBe(month().long_conditioning_weeks.includes(week.week_index) ? 1 : 0);
    }
  });

  it("rejects a repeated focus target and locks rest to the table", () => {
    const table = deterministicGoalTable(month());
    const broken = structuredClone(table);
    const first = broken.weeks[0]!.days.find((day) => !day.rest)!;
    const neighborIndex = DAY_ORDER.indexOf(first.day) + 1;
    const neighbor = broken.weeks[0]!.days.find((day) => day.day === DAY_ORDER[neighborIndex] && !day.rest);
    const target = neighbor ?? broken.weeks[0]!.days.find((day) => !day.rest && day.day !== first.day)!;
    copyTarget(target, first);
    expect(goalTableErrors(broken, month()).join(" ")).toMatch(/repeat focus target stimulus|repeats the previous week|repeats focus target stimulus/);
    const sameWeekday = structuredClone(table);
    const later = sameWeekday.weeks[2]!.days.find((day) => day.day === first.day && !day.rest);
    if (later) copyTarget(later, first);
    if (later) expect(goalTableErrors(sameWeekday, month()).join(" ")).toMatch(/repeats focus target stimulus/);
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
    expect(movementFrequency([left, right])).toEqual([
      { key: "barbell_thruster", count: 2 },
      { key: "burpee", count: 2 },
      { key: "row_erg", count: 2 },
    ]);
  });

  it("requires catalog Rx weights and rejects a duplicate key", () => {
    const front = catalogRxWeights("front_squat");
    expect(front?.male.length).toBeGreaterThan(0);
    expect(catalogRxWeights("back_squat")).toBeNull();
    expect(rxLoadErrors("front_squat", null).join(" ")).toMatch(/load.male/);
    expect(rxLoadErrors("front_squat", { male: "95 lb", female: "65 lb" })).toEqual([]);
    expect(rxLoadErrors("front_squat", { male: "999 lb", female: "65 lb" }).join(" ")).toMatch(/95 lb/);
    const slot = slotsFromWeekGoal(deterministicGoalTable(month()).weeks[0]!)["mon"];
    expect(slot?.from_goal).toBe(true);
    expect(slot?.primary_keys).toBeUndefined();
    const dup = slotFitErrors(
      {
        conditioning: {
          duration_min: slot!.duration_min,
          stimulus: slot!.stimulus,
          movements: [
            { key: "push_up", load: null },
            { key: "push_up", load: null },
          ],
        },
      },
      slot!,
      "none",
    );
    expect(dup.join(" ")).toMatch(/repeats a movement key/);
    const wrongDomain = slotFitErrors(
      { conditioning: { duration_min: slot!.time_domain === "short" ? 20 : 8, movements: [{ key: "push_up", load: null }] } },
      slot!,
      "none",
    );
    expect(wrongDomain.join(" ")).toMatch(/time_domain|duration must stay/);
  });
});

function copyTarget(into: DaySessionGoal, from: DaySessionGoal) {
  into.focus = from.focus;
  into.target = from.target ? { ...from.target } : null;
  into.stimulus = from.stimulus;
  into.intensity = from.intensity;
  into.time_domain = from.time_domain;
  into.purpose = from.purpose;
}
