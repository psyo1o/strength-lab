import { describe, expect, it } from "vitest";
import { deterministicGoalTable, goalTableErrors, GOAL_TABLE_RULES } from "../../src/lib/programming/coaching/goal-table";
import { DAY_ORDER } from "../../src/lib/month-plan/types";
import { BODY_REGIONS, ENERGY_SYSTEMS, MOVEMENT_PATTERNS, SESSION_FOCUSES, STIMULI } from "../../src/lib/programming/types";
import { month531 } from "./support";

describe("특성화 P2", () => {
  /**
   * 예전 인덱서는 shift가 focus 한 칸 안에 머문다. 그 식은 회귀로만 남긴다.
   * 지금 표는 그 격자이면 안 되고, GOAL_TABLE_RULES를 통과해야 한다.
   */
  it("P2: 예전 shift는 lower_strength 독점이고, month531 표는 그 격자가 아니다", () => {
    const rotationStimuli = STIMULI.filter((stimulus) => stimulus !== "aerobic");
    const band = MOVEMENT_PATTERNS.length * BODY_REGIONS.length * ENERGY_SYSTEMS.length * rotationStimuli.length;
    const cells = SESSION_FOCUSES.length * band;
    expect(band).toBe(252);
    expect(cells).toBe(1260);
    for (let weekIndex = 0; weekIndex <= 4; weekIndex += 1) {
      for (let dayIndex = 0; dayIndex <= 6; dayIndex += 1) {
        const shift = (weekIndex * 11 + dayIndex * 3) % cells;
        const focus = SESSION_FOCUSES[Math.floor(shift / band)];
        const pattern = MOVEMENT_PATTERNS[Math.floor((shift % band) / (BODY_REGIONS.length * ENERGY_SYSTEMS.length * rotationStimuli.length))];
        expect(shift).toBeLessThan(band);
        expect(focus).toBe("lower_strength");
        expect(pattern === "squat" || pattern === "hinge").toBe(true);
      }
    }

    const monopoly = [
      "lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,rest",
      "lower_strength/squat,lower_strength/squat,rest,lower_strength/squat,lower_strength/squat,lower_strength/hinge,lower_strength/hinge",
      "lower_strength/squat,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,rest,lower_strength/hinge,lower_strength/hinge",
      "lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,rest",
    ];
    const month = month531();
    const table = deterministicGoalTable(month);
    const grid = table.weeks.map((week) =>
      week.days.map((day) => (day.rest ? "rest" : `${day.focus}/${day.target?.movement_pattern}`)).join(","),
    );
    expect(grid).not.toEqual(monopoly);
    expect(goalTableErrors(table, month)).toEqual([]);
    for (const week of table.weeks) {
      expect(week.days).toHaveLength(DAY_ORDER.length);
      const focuses = new Set(week.days.filter((day) => !day.rest).map((day) => day.focus));
      expect(focuses.size).toBeGreaterThan(1);
      expect(focuses.has("lower_strength") && focuses.size === 1).toBe(false);
    }
    expect(GOAL_TABLE_RULES.monopolyFails).toBe(true);
  });
});
