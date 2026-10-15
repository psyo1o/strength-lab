import { describe, expect, it } from "vitest";
import { classLiftErrors, placeClassLifts } from "../src/lib/programming/coaching/class-lifts";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { cleanDisplayName, doseIssues } from "../src/lib/programming/coaching/session-contract";
import { catalogMovement, prescribedLoad, rxLoadErrors } from "../src/lib/programming/coaching/movement-catalog";
import { cooldownMovementBounds } from "../src/lib/programming/coaching/warmup-ramp";
import { classQualityErrors } from "../src/lib/programming/coaching/class-quality";
import { fatigueExpired } from "../src/lib/programming/rules";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { WeekActual } from "../src/lib/programming/summary";
import type { WeekDraft } from "../src/lib/programming/types";

const month = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });

function actual(signal: "high" | "low", date: string): WeekActual {
  return {
    note_ko: "",
    days: [{ day: "mon", rest: false, completed: true, result_ko: "완료", date, fatigue: signal }],
    class_summary: {
      completed_days: 6,
      missed_days: 4,
      scaling_mix: { rx: 1, scaled: 0, beginner: 0 },
      actual_volume: "high",
      actual_intensity: "heavy",
      fatigue_signal: signal,
      plan_vs_actual: "미완료가 많습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  } as WeekActual;
}

describe("class lift slots", () => {
  it("week 1 satisfies the rules and matches the example roles", () => {
    const days = placeClassLifts({ weekIndex: 1, phase: "accumulation", fatigued: false });
    expect(classLiftErrors(days)).toEqual([]);
    expect(days.map((day) => `${day.day}:${day.role}:${day.tag}:${day.movement}`)).toEqual([
      "mon:squat:heavy:back_squat",
      "tue:press:volume:strict_press",
      "wed:zone2:light:row_erg",
      "thu:olympic:technique:power_clean",
      "fri:hinge:heavy:deadlift",
      "sat:bench:volume:bench_press",
    ]);
    expect(days.find((day) => day.day === "thu")?.companion).toBe("front_squat");
  });

  it("rotates the olympic lift and keeps both lower roles when fatigue is high", () => {
    const next = placeClassLifts({ weekIndex: 2, phase: "accumulation", fatigued: true, recentOlympic: "clean" });
    expect(classLiftErrors(next)).toEqual([]);
    expect(next.find((day) => day.role === "olympic")?.movement).toBe("power_snatch");
    const heavy = next.filter((day) => (day.role === "squat" || day.role === "hinge") && day.tag === "heavy");
    expect(heavy).toHaveLength(1);
    expect(next.filter((day) => day.role === "squat" || day.role === "hinge")).toHaveLength(2);
  });

  it("keeps six-day lift roles on the coached week when fatigue is high and absences are recorded", () => {
    const plan = planCoachedWeek({ month, weekIndex: 1, previousActual: actual("high", "2099-10-11") });
    const lifts = plan.days.filter((day) => day.strength_lift !== "none").map((day) => day.strength_lift);
    expect(lifts).toEqual(expect.arrayContaining(["squat", "deadlift", "ohp", "bench"]));
    expect(plan.days.find((day) => day.zone2 === "day")?.day).toBe("wed");
    expect(plan.days.find((day) => day.primary_training === "olympic_technique")?.main_movement).toBe("power_clean");
    expect(plan.why_ko).not.toMatch(/미완료/);
  });
});

describe("class quality rejects", () => {
  it("rejects a for-time whose 3-round estimate is outside 25% of the cap and does not rewrite it", () => {
    const movements = [
      { key: "row_erg", unit: "cal" as const, amount: 12 },
      { key: "barbell_thruster", unit: "reps" as const, amount: 8 },
      { key: "burpee", unit: "reps" as const, amount: 12 },
    ];
    const before = movements.map((movement) => movement.amount);
    const errors = doseIssues({ format: "for_time", minutes: 36, movements });
    expect(errors.join(" ")).toMatch(/more than 25%/);
    expect(movements.map((movement) => movement.amount)).toEqual(before);
  });

  it("rejects two ropes, a heavy interval label, and a bodyweight-only main", () => {
    const draft = {
      intent: { why_ko: "", focus: "", scheme_note: "" },
      sessions: [
        {
          day: "thu",
          rest: false,
          strength: null,
          conditioning: {
            benchmark: false,
            format: "intervals",
            time_domain: "short",
            stimulus: "heavy",
            movement_patterns: ["mixed"],
            movements: [
              { key: "double_under", amount: "10", name_ko: "더블 언더" },
              { key: "single_under", amount: "10", name_ko: "싱글 언더" },
            ],
            equipment: [],
            rep_structure: "",
            work_rest_structure: "",
            duration_min: 12,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "테스트",
          },
          session_blocks: [
            { role: "main_lift", minutes: 20, movements: [{ key: "air_squat", unit: "reps", amount: 20 }] },
            { role: "skill_or_accessory", minutes: 10, movements: [{ key: "air_squat", unit: "reps", amount: 20 }] },
          ],
        },
      ],
    } as WeekDraft;
    const errors = classQualityErrors(draft).join(" ");
    expect(errors).toMatch(/double_under and single_under/);
    expect(errors).toMatch(/intervals stimulus heavy/);
    expect(errors).toMatch(/single bodyweight movement air_squat/);
    expect(errors).toMatch(/main and accessory both use air_squat/);
    expect(errors).toMatch(/weekly coverage missing/);
  });

  it("strips alias markers from catalog names and requires an Rx on a percentage barbell", () => {
    expect(cleanDisplayName("스키 에르그(별칭 키)")).toBe("스키 에르그");
    expect(catalogMovement("ski_erg")?.name_ko).not.toMatch(/별칭/);
    expect(prescribedLoad("power_clean")).toEqual({ male: "1RM %", female: "1RM %" });
    expect(rxLoadErrors("power_clean", null).join(" ")).toMatch(/load.male is required/);
    expect(rxLoadErrors("power_clean", { male: "1RM %", female: "1RM %" })).toEqual([]);
    expect(cooldownMovementBounds(8)).toEqual({ min: 5, max: 6 });
  });

  it("ignores fatigue dated more than 14 days before the target week", () => {
    expect(fatigueExpired(actual("high", "2099-09-01"), "2099-10-12")).toBe(true);
    expect(fatigueExpired(actual("high", "2099-10-11"), "2099-10-12")).toBe(false);
  });
});
