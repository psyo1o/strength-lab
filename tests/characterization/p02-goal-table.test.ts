import { describe, expect, it } from "vitest";
import { deterministicGoalTable } from "../../src/lib/programming/coaching/goal-table";
import { DAY_ORDER } from "../../src/lib/month-plan/types";
import { BODY_REGIONS, ENERGY_SYSTEMS, MOVEMENT_PATTERNS, SESSION_FOCUSES, STIMULI } from "../../src/lib/programming/types";
import { month531 } from "./support";

describe("특성화 P2", () => {
  /**
   * P2. 근거 goal-table.ts:168-180, goal-table.ts:206.
   * 현재 동작: 시작 칸이 focus 하나 안에 머물러 훈련일 focus가 lower_strength이고 패턴은 squat 또는 hinge다.
   * 목표 동작: 주와 요일이 focus와 패턴을 골고루 돈다. 아직 구현하지 않는다.
   */
  it("P2: deterministicGoalTable 훈련일은 모두 lower_strength이고 squat 또는 hinge만 고른다", () => {
    const band = MOVEMENT_PATTERNS.length * BODY_REGIONS.length * ENERGY_SYSTEMS.length * STIMULI.length;
    const cells = SESSION_FOCUSES.length * band;
    expect(band).toBe(252);
    expect(cells).toBe(1260);
    for (let weekIndex = 0; weekIndex <= 4; weekIndex += 1) {
      for (let dayIndex = 0; dayIndex <= 6; dayIndex += 1) {
        const shift = (weekIndex * 11 + dayIndex * 3) % cells;
        const focus = SESSION_FOCUSES[Math.floor(shift / band)];
        const pattern = MOVEMENT_PATTERNS[Math.floor((shift % band) / (BODY_REGIONS.length * ENERGY_SYSTEMS.length * STIMULI.length))];
        expect(shift).toBeLessThan(band);
        expect(focus).toBe("lower_strength");
        expect(pattern === "squat" || pattern === "hinge").toBe(true);
      }
    }

    const table = deterministicGoalTable(month531());
    const grid = table.weeks.map((week) =>
      week.days.map((day) => (day.rest ? "rest" : `${day.focus}/${day.target?.movement_pattern}`)).join(","),
    );
    expect(grid).toEqual([
      "lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,lower_strength/squat,rest",
      "lower_strength/squat,lower_strength/squat,rest,lower_strength/squat,lower_strength/squat,lower_strength/hinge,lower_strength/hinge",
      "lower_strength/squat,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,rest,lower_strength/hinge,lower_strength/hinge",
      "lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,lower_strength/hinge,rest",
    ]);
    for (const week of table.weeks) {
      expect(week.days).toHaveLength(DAY_ORDER.length);
      for (const day of week.days) {
        if (day.rest) {
          expect(day.focus).toBeNull();
          continue;
        }
        expect(day.focus).toBe("lower_strength");
        expect(day.target?.movement_pattern === "squat" || day.target?.movement_pattern === "hinge").toBe(true);
      }
    }
  });
});
