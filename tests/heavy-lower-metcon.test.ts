import { describe, expect, it } from "vitest";
import { applyHeadCells } from "../src/lib/programming/coaching/head-cells";
import {
  classifyHeadRevise,
  is_heavy_lower_metcon,
  sessionHasHeavyLowerMetcon,
} from "../src/lib/programming/coaching/heavy-lower-metcon";
import { prescribedLoad, rangeFor } from "../src/lib/programming/coaching/movement-catalog";
import {
  HeavyLowerEnumError,
  MIN_HEAVY_LOWER_CHOICES,
  buildSessionFrame,
  quantityOptions,
  withoutHeavyLowerOptions,
  type SessionFrame,
} from "../src/lib/programming/coaching/slot-choices";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { feedbackViolations, hardConstraints } from "../src/lib/programming/rules";
import type { WeekActual } from "../src/lib/programming/summary";
import type { ConditioningDraft, SessionDraft, WeekDraft } from "../src/lib/programming/types";

function highActual(): WeekActual {
  return {
    note_ko: "하체 피로가 높습니다.",
    days: [],
    class_summary: {
      completed_days: 4,
      missed_days: 2,
      scaling_mix: { rx: 4, scaled: 2, beginner: 0 },
      actual_volume: "high",
      actual_intensity: "heavy",
      fatigue_signal: "high",
      plan_vs_actual: "하체가 무거웠습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function month() {
  return fallbackMonth({ summary_ko: "하체 고중량 메트콘을 피합니다.", next_scheme: "531", strength_method: "531" });
}

function heavyPiece(movements: ConditioningDraft["movements"]): ConditioningDraft {
  return {
    benchmark: false,
    format: "for_time",
    time_domain: "medium",
    stimulus: "heavy",
    movement_patterns: ["hinge"],
    movements,
    equipment: ["barbell"],
    rep_structure: "포타임",
    work_rest_structure: "쉼",
    duration_min: 14,
    volume: "moderate",
    intensity: "heavy",
    long_conditioning: false,
    purpose: "하체 메트콘입니다.",
  };
}

function deadliftMove(amount: number) {
  return {
    key: "deadlift",
    movement: "deadlift",
    amount: String(amount),
    amount_value: amount,
    unit: "reps" as const,
    name_ko: "데드리프트",
    load: prescribedLoad("deadlift"),
  };
}

function withDays(draft: WeekDraft, days: Array<"thu" | "sat">, amount: number): WeekDraft {
  const next = structuredClone(draft) as WeekDraft;
  for (const day of days) {
    const session = next.sessions.find((row) => row.day === day);
    if (!session) throw new Error(`${day} missing`);
    session.rest = false;
    session.conditioning = heavyPiece([deadliftMove(amount), { key: "burpee", amount: "8", name_ko: "버피" }]);
    session.stimulus = "heavy";
    session.intensity = "heavy";
  }
  return next;
}

function heavyLowerErrors(draft: WeekDraft, actual: WeekActual): string[] {
  return feedbackViolations(draft, month(), 2, actual).filter((error) => error.includes("heavy lower metcon"));
}

function heavySlot() {
  return {
    format: "for_time" as const,
    time_domain: "medium" as const,
    duration_min: 14,
    stimulus: "heavy" as const,
    movement_pattern: "hinge" as const,
    primary_key: "barbell_thruster",
    volume: "moderate" as const,
    metcon: true,
    movement_count: 3,
    companions: ["row_erg", "burpee"],
    stretch: false,
  };
}

describe("heavy lower metcon", () => {
  it("flags only the low-rep heavy combination and keeps the same movement", () => {
    const span = rangeFor("deadlift", "reps");
    expect(span).not.toBeNull();
    const mid = Math.round((span!.min + span!.max) / 2);
    const load = prescribedLoad("deadlift");
    expect(
      is_heavy_lower_metcon({
        movement: "deadlift",
        unit: "reps",
        amount: span!.min,
        load,
        stimulus: "heavy",
        intensity: "heavy",
      }),
    ).toBe(true);
    expect(
      is_heavy_lower_metcon({
        movement: "deadlift",
        unit: "reps",
        amount: mid,
        load,
        stimulus: "heavy",
        intensity: "heavy",
      }),
    ).toBe(false);
    expect(
      is_heavy_lower_metcon({
        movement: "air_squat",
        unit: "reps",
        amount: rangeFor("air_squat", "reps")!.min,
        load: prescribedLoad("air_squat"),
        stimulus: "heavy",
        intensity: "heavy",
      }),
    ).toBe(false);
    expect(
      is_heavy_lower_metcon({
        movement: "american_kettlebell_swing",
        unit: "reps",
        amount: rangeFor("american_kettlebell_swing", "reps")!.min,
        load: prescribedLoad("american_kettlebell_swing"),
        stimulus: "heavy",
        intensity: "heavy",
      }),
    ).toBe(false);
  });

  it("drops violating options from an avoid day and leaves the movement", () => {
    const day = planCoachedWeek({ month: month(), weekIndex: 2 }).days.find((row) => row.day === "thu");
    if (!day) throw new Error("thu missing");
    const frame = buildSessionFrame({ area: "conditioning", day, slot: heavySlot(), avoidHeavyLower: true });
    expect(frame).not.toBeNull();
    const thruster = frame!.slots.flatMap((slot) => slot.movements).find((movement) => movement.key === "barbell_thruster");
    expect(thruster).toBeTruthy();
    const low = rangeFor("barbell_thruster", "reps")!.min;
    expect(thruster!.options.some((option) => option.amount === low)).toBe(false);
    expect(thruster!.options.length).toBeGreaterThanOrEqual(2);
    for (const slot of frame!.slots) {
      const choices = slot.movements.reduce((sum, movement) => sum + movement.options.length, 0);
      expect(choices).toBeGreaterThanOrEqual(MIN_HEAVY_LOWER_CHOICES);
      for (const movement of slot.movements) {
        for (const option of movement.options) {
          expect(
            is_heavy_lower_metcon({
              movement: movement.key,
              unit: option.unit,
              amount: option.amount,
              load: prescribedLoad(movement.key),
              stimulus: "heavy",
              intensity: "heavy",
            }),
          ).toBe(false);
        }
      }
    }
  });

  it("stops before generation when a slot has fewer than two choices", () => {
    const frame: SessionFrame = {
      area: "conditioning",
      day: "thu",
      piece: { format: "for_time", duration_min: 14, stimulus: "heavy", volume: "moderate", intensity: "heavy" },
      slots: [
        {
          id: "s0",
          movements: [{ key: "deadlift", options: quantityOptions("deadlift").filter((option) => option.amount === rangeFor("deadlift", "reps")!.min) }],
        },
      ],
    };
    expect(() => withoutHeavyLowerOptions(frame)).toThrow(HeavyLowerEnumError);
  });

  it("rejects an injected violation and accepts the legal quantity of the same movement", () => {
    const actual = highActual();
    expect(hardConstraints(actual).heavy_lower_metcon).toBe("avoid");
    const base = buildFallbackWeek({ month: month(), weekIndex: 2, intent: fallbackIntent(month(), 2, "heavy-lower") });
    const low = rangeFor("deadlift", "reps")!.min;
    const mid = Math.round((low + rangeFor("deadlift", "reps")!.max) / 2);
    const violated = withDays(base, ["thu"], low);
    expect(heavyLowerErrors(violated, actual).join(" ")).toContain("Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid");
    const cleared = withDays(base, ["thu"], mid);
    expect(heavyLowerErrors(cleared, actual)).toEqual([]);
    const swing = withDays(base, ["thu"], low);
    const thursday = swing.sessions.find((session) => session.day === "thu")!;
    thursday.conditioning = heavyPiece([
      {
        key: "american_kettlebell_swing",
        amount: String(rangeFor("american_kettlebell_swing", "reps")!.min),
        amount_value: rangeFor("american_kettlebell_swing", "reps")!.min,
        unit: "reps",
        name_ko: "아메리칸 케틀벨 스윙",
        load: prescribedLoad("american_kettlebell_swing"),
      },
    ]);
    expect(sessionHasHeavyLowerMetcon(thursday)).toBe(false);
  });

  it("applies a legal revision and records each failure mode", () => {
    const low = rangeFor("deadlift", "reps")!.min;
    const mid = Math.round((low + rangeFor("deadlift", "reps")!.max) / 2);
    const session: SessionDraft = {
      day: "thu",
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "준비합니다.",
      strength: null,
      conditioning: heavyPiece([deadliftMove(low)]),
      strength_purpose: null,
      strength_volume: null,
      strength_intensity: null,
      metcon_purpose: "하체",
      metcon_format: "for_time",
      time_domain: "medium",
      stimulus: "heavy",
      movement_combination: "deadlift",
      equipment: ["barbell"],
      volume: "moderate",
      intensity: "heavy",
      expected_duration: 14,
    };
    const applied = applyHeadCells(
      [structuredClone(session)],
      [
        {
          day: "thu",
          reason: "하체 고중량을 피합니다.",
          correction_instruction: "수량을 바꿉니다.",
          cell: { day: "thu", block: "conditioning", catalog_key: "deadlift", field: "quantity_option", value: `reps:${mid}`, reason: "중간 수량" },
        },
      ],
      { avoidHeavyLower: true },
    );
    expect(applied.rows[0]?.result).toBe("applied");
    const moved = structuredClone(session);
    applyHeadCells(
      [moved],
      [
        {
          day: "thu",
          reason: "하체 고중량을 피합니다.",
          correction_instruction: "수량을 바꿉니다.",
          cell: { day: "thu", block: "conditioning", catalog_key: "deadlift", field: "quantity_option", value: `reps:${mid}`, reason: "중간 수량" },
        },
      ],
      { avoidHeavyLower: true },
    );
    expect(sessionHasHeavyLowerMetcon(moved)).toBe(false);
    expect(
      classifyHeadRevise({
        parsed: true,
        reviseRequested: true,
        violatingDays: [],
        revisionDays: ["thu"],
        rejectedReasons: [],
        appliedCount: 1,
        hardStill: [],
      }),
    ).toBeNull();

    const rejectedEnum = applyHeadCells(
      [structuredClone(session)],
      [
        {
          day: "thu",
          reason: "그대로 둡니다.",
          correction_instruction: "최소 수량",
          cell: { day: "thu", block: "conditioning", catalog_key: "deadlift", field: "quantity_option", value: `reps:${low}`, reason: "최소" },
        },
      ],
      { avoidHeavyLower: true },
    );
    expect(rejectedEnum.rows[0]?.result).toBe("reverted");
    expect(
      classifyHeadRevise({
        parsed: true,
        reviseRequested: true,
        violatingDays: ["thu"],
        revisionDays: ["thu"],
        rejectedReasons: rejectedEnum.rows.map((row) => row.reason ?? ""),
        appliedCount: 0,
        hardStill: ["Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid"],
      }),
    ).toBe("rejected_not_in_enum");

    const badTarget = applyHeadCells(
      [structuredClone(session)],
      [
        {
          day: "thu",
          reason: "없는 칸",
          correction_instruction: "없는 동작",
          cell: { day: "thu", block: "conditioning", catalog_key: "back_squat", field: "quantity_option", value: "reps:5", reason: "없는 칸" },
        },
      ],
      { avoidHeavyLower: true },
    );
    expect(
      classifyHeadRevise({
        parsed: true,
        reviseRequested: true,
        violatingDays: ["thu"],
        revisionDays: ["thu"],
        rejectedReasons: badTarget.rows.map((row) => row.reason ?? ""),
        appliedCount: 0,
        hardStill: ["Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid"],
      }),
    ).toBe("rejected_bad_target");

    expect(
      classifyHeadRevise({
        parsed: true,
        reviseRequested: true,
        violatingDays: ["thu", "sat"],
        revisionDays: ["mon", "wed"],
        rejectedReasons: [],
        appliedCount: 2,
        hardStill: [
          "Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid",
          "Saturday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid",
        ],
      }),
    ).toBe("not_targeted");

    expect(
      classifyHeadRevise({
        parsed: false,
        reviseRequested: true,
        violatingDays: ["thu"],
        revisionDays: [],
        rejectedReasons: [],
        appliedCount: 0,
        hardStill: ["Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid"],
      }),
    ).toBe("parse_failed");

    expect(
      classifyHeadRevise({
        parsed: true,
        reviseRequested: true,
        violatingDays: ["thu"],
        revisionDays: ["thu"],
        rejectedReasons: [],
        appliedCount: 1,
        hardStill: ["Thursday: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid"],
      }),
    ).toBe("applied_still_violating");
  });

  it("replays the 10/12 and 10/19 skeleton with zero heavy-lower hard errors after a legal option", () => {
    const actual = highActual();
    const low = rangeFor("deadlift", "reps")!.min;
    const mid = Math.round((low + rangeFor("deadlift", "reps")!.max) / 2);
    for (const label of ["2026-10-12", "2026-10-19"]) {
      const base = buildFallbackWeek({ month: month(), weekIndex: 2, intent: fallbackIntent(month(), 2, label) });
      const before = withDays(base, ["thu", "sat"], low);
      const beforeErrors = heavyLowerErrors(before, actual);
      expect(beforeErrors.some((error) => error.startsWith("Thursday"))).toBe(true);
      expect(beforeErrors.some((error) => error.startsWith("Saturday"))).toBe(true);
      expect(
        classifyHeadRevise({
          parsed: true,
          reviseRequested: true,
          violatingDays: ["thu", "sat"],
          revisionDays: ["mon", "wed"],
          rejectedReasons: [],
          appliedCount: 2,
          hardStill: beforeErrors,
        }),
      ).toBe("not_targeted");
      const after = withDays(base, ["thu", "sat"], mid);
      expect(heavyLowerErrors(after, actual)).toEqual([]);
    }
  });
});
