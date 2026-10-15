import type { DayKey, WeekIndex } from "../../../month-plan/types";
import { setsForAction } from "../load";
import { validateStrengthPrescription } from "../../strength-methods";
import type { MonthDirection, SessionDraft } from "../../types";
import type { AdjustmentTrace } from "./types";

const LIFTS = ["bench", "ohp", "squat", "deadlift"] as const;

/**
 * Stage14 contradiction: an upper-body fatigue cut that the strength validator rejects.
 * The count is zero when load and the method table describe the same sets.
 */
export function loadMethodContradictionCount(input: { method: string; weekIndex: WeekIndex }): number {
  const month = { strength_method: input.method, scheme: input.method } as MonthDirection;
  let count = 0;
  for (const lift of LIFTS) {
    const session = { strength: { lift, sets: [] } } as unknown as SessionDraft;
    const strength = setsForAction({ action: "cut", month, weekIndex: input.weekIndex, session });
    if (!strength) continue;
    const error = validateStrengthPrescription(input.method, strength.sets, {
      day: "mon",
      weekIndex: input.weekIndex,
      lift,
      fatigue: "high",
    });
    if (error) count += 1;
  }
  return count;
}

export type HardDayOutcome = {
  day: DayKey;
  session: SessionDraft;
  source: "DETERMINISTIC_ADJUSTMENT" | "FAILED" | "FALLBACK";
  used: boolean;
  trace: AdjustmentTrace;
};

/** Replace one illegal day. Neighbors are the caller's job. A second failure is FAILED. */
export function settleHardDay(input: {
  day: DayKey;
  original: SessionDraft;
  replacement: SessionDraft | null;
  replacementStillHard: boolean;
  reason: string;
}): HardDayOutcome {
  if (!input.replacement || input.replacementStillHard) {
    return {
      day: input.day,
      session: input.original,
      source: "FAILED",
      used: false,
      trace: {
        who: "hard_validator",
        when: "hard",
        target: input.day,
        reason: input.reason,
        before: input.original.warmup_ko,
        after: input.original.warmup_ko,
        preserved_intent: ["weekly_strength_progression"],
        priority: "P0",
        decision: "failed",
      },
    };
  }
  return {
    day: input.day,
    session: input.replacement,
    source: "DETERMINISTIC_ADJUSTMENT",
    used: true,
    trace: {
      who: "hard_validator",
      when: "hard",
      target: input.day,
      reason: input.reason,
      before: input.original.warmup_ko,
      after: input.replacement.warmup_ko,
      preserved_intent: ["weekly_strength_progression"],
      priority: "P0",
      decision: "targeted_hard_adjustment",
    },
  };
}

export type FallbackAdoption = {
  status: "USE" | "FAILED";
  source: "FALLBACK" | "FAILED";
  active: boolean;
};

/** The coaching pipeline does not replace a week because one day or one concern failed. */
export function coachingWeekMayUseLegacyFallback(input: {
  pipeline?: string;
  weekStatus?: string;
  salvage: boolean;
}): boolean {
  if (input.pipeline === "stage16") return false;
  if (input.weekStatus === "FAILED") return false;
  if (input.salvage) return false;
  return true;
}

/** Invalid model output may use a fallback only when that fallback passes hard validation. */
export function adoptFallback(input: { fallbackHard: boolean }): FallbackAdoption {
  if (input.fallbackHard) return { status: "FAILED", source: "FAILED", active: false };
  return { status: "USE", source: "FALLBACK", active: true };
}
