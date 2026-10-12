import { describe, expect, it } from "vitest";
import { placeTrainingDays } from "../src/lib/programming/coaching/day-place";
import { applyHeadCells } from "../src/lib/programming/coaching/head-cells";
import { orderViolations } from "../src/lib/programming/rules";
import { SIMILARITY_CONFIG, type ConditioningDraft, type DayIntent, type SessionDraft, type WeekDraft, type WeeklyIntentPlan } from "../src/lib/programming/types";
import type { DayKey } from "../src/lib/month-plan/types";
import type { WeeklySkeleton } from "../src/lib/programming/planning/types";

function piece(stimulus: "heavy" | "high_rep" | "technical", format: ConditioningDraft["format"]): ConditioningDraft {
  return {
    benchmark: false,
    format,
    time_domain: "short",
    stimulus,
    movement_patterns: stimulus === "heavy" ? ["hinge"] : ["squat"],
    movements: [{ key: stimulus === "heavy" ? "deadlift" : "air_squat", amount: "10", name_ko: "동작" }],
    equipment: ["bodyweight"],
    rep_structure: "10",
    work_rest_structure: "none",
    duration_min: 12,
    volume: stimulus === "heavy" ? "low" : "high",
    intensity: stimulus === "heavy" ? "heavy" : "moderate",
    long_conditioning: false,
    purpose: "Practice the movement.",
  };
}

function session(day: DayKey, stimulus: "heavy" | "high_rep" | "technical" | null, format: ConditioningDraft["format"] = "amrap"): SessionDraft {
  const conditioning = stimulus ? piece(stimulus, format) : null;
  return {
    day,
    rest: stimulus == null,
    optional: false,
    warmup_min: stimulus ? 10 : 0,
    warmup_ko: stimulus ? `${day} ${stimulus}` : "",
    strength: null,
    conditioning,
    strength_purpose: null,
    strength_volume: null,
    strength_intensity: null,
    metcon_purpose: stimulus ? "Practice the movement." : null,
    metcon_format: format,
    time_domain: stimulus ? "short" : null,
    stimulus,
    movement_combination: stimulus,
    equipment: [],
    volume: stimulus ? "moderate" : null,
    intensity: stimulus ? "moderate" : null,
    expected_duration: stimulus ? 12 : null,
  };
}

function intent(day: DayKey, rest: boolean): DayIntent {
  return {
    day,
    primary_training: rest ? "rest" : "mixed_modal",
    secondary_training: rest ? "none" : "moderate_conditioning",
    training_goal: day,
    stimulus: "threshold",
    intensity_profile: "moderate",
    volume_profile: "moderate",
    duration_profile: rest ? "rest" : "45-60",
    fatigue_target: "moderate",
    movement_pattern: "mixed",
    progression_required: false,
    recovery_role: rest ? "rest" : "train",
    strength_lift: "none",
    benchmark: false,
    notes_ko: day,
  };
}

function week(stimuli: Partial<Record<DayKey, "heavy" | "high_rep" | "technical">>): { draft: WeekDraft; plan: WeeklyIntentPlan } {
  const days: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const sessions = days.map((day) => session(day, stimuli[day] ?? null));
  const planDays = days.map((day) => intent(day, stimuli[day] == null));
  return {
    draft: { intent: { why_ko: "why", focus: "focus", scheme_note: "scheme" }, sessions },
    plan: {
      version: "intent-v1",
      week_index: 1,
      block_phase: "accumulation",
      emphasis: "strength",
      why_ko: "why",
      focus: "focus",
      scheme_note: "scheme",
      adjustment_ko: "adjust",
      days: planDays,
      fallback_used: false,
    } as WeeklyIntentPlan,
  };
}

describe("weekday placement", () => {
  it("keeps the threshold at 4", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
  });

  it("swaps a repeated neighbor stimulus without rewriting the session", () => {
    const built = week({ mon: "technical", tue: "technical", wed: "heavy" });
    expect(orderViolations(built.draft).some((error) => error.includes("technical"))).toBe(true);
    const placed = placeTrainingDays({ draft: built.draft, plan: built.plan, skeleton: null });
    expect(placed.legal).toBe(true);
    expect(placed.moves.length).toBeGreaterThan(0);
    expect(placed.draft.sessions.find((row) => row.day === "mon")?.warmup_ko).toContain("technical");
    expect(placed.draft.sessions.find((row) => row.day === "tue")?.warmup_ko).toContain("heavy");
    expect(placed.draft.sessions.find((row) => row.day === "sun")?.rest).toBe(true);
    expect(orderViolations(placed.draft)).toEqual([]);
  });

  it("does not move a locked rest day", () => {
    const built = week({ mon: "technical", tue: "technical", wed: "heavy" });
    const skeleton = {
      skeleton_locked: true,
      days: built.plan.days.map((day) => ({
        day: day.day,
        status: day.primary_training === "rest" ? "rest" : "training",
      })),
    } as WeeklySkeleton;
    const placed = placeTrainingDays({ draft: built.draft, plan: built.plan, skeleton });
    expect(placed.skeleton?.days.find((day) => day.day === "sun")?.status).toBe("rest");
    expect(placed.moves.every((move) => move.to !== "sun" && move.from !== "sun")).toBe(true);
  });

  it("reports an unfixable order and still does not invent a new session", () => {
    const built = week({ mon: "technical", tue: "technical", wed: "technical" });
    const placed = placeTrainingDays({ draft: built.draft, plan: built.plan, skeleton: null });
    expect(placed.legal).toBe(false);
    expect(placed.violations.length).toBeGreaterThan(0);
    expect(placed.draft.sessions.map((row) => row.warmup_ko).join(" ")).toContain("technical");
  });
});

describe("head cells", () => {
  it("records a recent-week similarity hit and leaves the session", () => {
    const built = week({ mon: "technical", wed: "heavy" });
    const monday = built.draft.sessions.find((row) => row.day === "mon")!;
    const piece = monday.conditioning!;
    const placed = placeTrainingDays({
      draft: built.draft,
      plan: built.plan,
      skeleton: null,
      recent: [
        {
          day: "mon",
          format: piece.format,
          time_domain: piece.time_domain,
          stimulus: piece.stimulus,
          movement_patterns: piece.movement_patterns,
          movements: piece.movements,
          equipment: piece.equipment,
          rep_structure: piece.rep_structure,
          work_rest_structure: piece.work_rest_structure,
          duration_min: piece.duration_min,
          volume: piece.volume,
          intensity: piece.intensity,
          benchmark: false,
          long_conditioning: false,
        },
      ],
    });
    expect(placed.legal).toBe(true);
    expect(placed.moves).toEqual([]);
    expect(placed.violations.some((error) => error.includes("matches a recent structure"))).toBe(true);
    expect(placed.draft.sessions.find((row) => row.day === "mon")?.warmup_ko).toContain("technical");
    expect(placed.draft.sessions.find((row) => row.day === "wed")?.warmup_ko).toContain("heavy");
  });

  it("reverts one out-of-range cell and leaves the session", () => {
    const built = week({ mon: "technical" });
    const session = built.draft.sessions.find((row) => row.day === "mon")!;
    session.conditioning!.movements = [{ key: "air_squat", amount: "10", name_ko: "에어 스쿼트" }];
    const report = applyHeadCells(built.draft.sessions, [
      {
        day: "mon",
        reason: "Too many reps.",
        correction_instruction: "set amount",
        cell: { day: "mon", block: "conditioning", catalog_key: "air_squat", field: "amount", value: "99999", reason: "Too many reps." },
      },
    ]);
    expect(report.proposed).toBe(1);
    expect(report.applied).toBe(0);
    expect(report.reverted).toBe(1);
    expect(session.conditioning?.movements[0]?.amount).toBe("10");
  });

  it("keeps the current unit when a multi-unit amount has no unit", () => {
    const built = week({ mon: "technical" });
    const session = built.draft.sessions.find((row) => row.day === "mon")!;
    session.conditioning!.movements = [{ key: "row", amount: "20cal", name_ko: "로잉", movement: "row", amount_value: 20, unit: "cal" }];
    const applied = applyHeadCells(built.draft.sessions, [
      {
        day: "mon",
        reason: "Lower the row.",
        correction_instruction: "set amount",
        cell: { day: "mon", block: "conditioning", catalog_key: "row", field: "amount", value: "30", reason: "Lower the row." },
      },
    ]);
    expect(applied).toMatchObject({ proposed: 1, applied: 1, reverted: 0 });
    expect(session.conditioning?.movements[0]?.amount).toBe("30cal");
    expect(session.conditioning?.movements[0]?.unit).toBe("cal");
    const outside = applyHeadCells(built.draft.sessions, [
      {
        day: "mon",
        reason: "Too short.",
        correction_instruction: "set amount",
        cell: { day: "mon", block: "conditioning", catalog_key: "row", field: "amount", value: "5", reason: "Too short." },
      },
    ]);
    expect(outside.reverted).toBe(1);
    expect(session.conditioning?.movements[0]?.amount).toBe("30cal");
  });
});
