import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { buildSession } from "../coaching/session";
import { fillSessionFields } from "../session-fields";
import type { WeekActual } from "../summary";
import type { IntensityBand, MonthDirection, SessionDraft, StrengthLiftChoice, VolumeBand, WeekDraft, WeekIndex, WeeklyIntentPlan } from "../types";
import { lockedSkeletonViolations, type LockedFieldChange } from "./lock";
import { intentFromSkeleton } from "./structure";
import type { LongitudinalPlan, SkeletonDay, StrengthEmphasis, WeeklySkeleton, WeeklyThesis } from "./types";

const VOLUME_RANK: Record<VolumeBand, number> = { low: 0, moderate: 1, high: 2 };

/**
 * The session does not store a strength emphasis. The locked lift decides the family:
 * a fatigue cut may lower the set percent without moving the lift off its locked family.
 * A different lift family is a mismatch.
 */
export function emphasisForPlacement(lift: StrengthLiftChoice, locked: StrengthEmphasis): StrengthEmphasis {
  if (lift === "none") return "none";
  if (lift === "squat" || lift === "deadlift") {
    if (locked === "heavy_lower" || locked === "light" || locked === "moderate") return locked;
    return "heavy_lower";
  }
  if (lift === "bench" || lift === "ohp") {
    if (locked === "heavy_upper" || locked === "light" || locked === "moderate") return locked;
    return "heavy_upper";
  }
  return "moderate";
}

export function planFromLockedSkeleton(longitudinal: LongitudinalPlan, month: MonthDirection): WeeklyIntentPlan {
  const intent = intentFromSkeleton(longitudinal.skeleton, month, longitudinal.weekly_thesis);
  return {
    ...intent,
    why_ko: longitudinal.weekly_thesis.thesis || intent.why_ko,
    adjustment_ko: longitudinal.weekly_thesis.fatigue_distribution || intent.adjustment_ko,
    strength_method: month.strength_method || month.scheme,
    intent_source: "fallback",
    original_intent_source: "fallback",
    fallback_used: false,
    realization: "intent",
  };
}

function volumeErrors(skeleton: WeeklySkeleton, draft: WeekDraft): string[] {
  const errors: string[] = [];
  for (const day of skeleton.days) {
    if (day.status !== "training") continue;
    const session = draft.sessions.find((row) => row.day === day.day);
    const volume = session?.conditioning?.volume ?? session?.volume;
    if (!volume) continue;
    if (VOLUME_RANK[volume] > VOLUME_RANK[day.volume_profile]) {
      errors.push(`${day.day} volume exceeds the locked profile ${day.volume_profile}`);
    }
  }
  return errors;
}

/** Map the saved prescription onto the locked fields. Missing clocks are not guessed. */
export function changesFromPrescription(skeleton: WeeklySkeleton, draft: WeekDraft): { changes: LockedFieldChange[]; gaps: string[] } {
  const planDays = draft.intent.plan?.days ?? [];
  const changes: LockedFieldChange[] = [];
  const gaps: string[] = [];
  for (const key of DAY_ORDER) {
    const day = skeleton.days.find((row) => row.day === key);
    const session = draft.sessions.find((row) => row.day === key);
    if (!day) continue;
    if (!session) {
      changes.push({ day: key, status: "rest", strength_lift: "none", benchmark: false, long_day: false, duration_class: "rest" });
      gaps.push(`${key} is missing from the prescription`);
      continue;
    }
    const rest = session.rest || !session.conditioning;
    const lift: StrengthLiftChoice = rest || !session.strength ? "none" : session.strength.lift;
    const planDay = planDays.find((row) => row.day === key);
    const change: LockedFieldChange = {
      day: key,
      status: rest ? "rest" : "training",
      benchmark: rest ? false : Boolean(session.conditioning?.benchmark),
      long_day: rest ? false : Boolean(session.conditioning?.long_conditioning || session.conditioning?.time_domain === "long"),
      strength_lift: lift,
      strength_emphasis: emphasisForPlacement(lift, day.strength.emphasis),
    };
    if (planDay) change.primary_goal = planDay.primary_training;
    if (rest) change.duration_class = "rest";
    else if (session.conditioning?.time_domain) change.duration_class = session.conditioning.time_domain;
    else gaps.push(`${key} training day has no duration class`);
    if (!rest && session.conditioning && isIntensity(session.conditioning.intensity)) {
      change.intensity_class = session.conditioning.intensity;
    }
    changes.push(change);
  }
  return { changes, gaps };
}

function isIntensity(value: string | null | undefined): value is IntensityBand {
  return value === "light" || value === "moderate" || value === "heavy";
}

export function prescriptionLockErrors(skeleton: WeeklySkeleton, draft: WeekDraft): string[] {
  const mapped = changesFromPrescription(skeleton, draft);
  return [...new Set([...lockedSkeletonViolations(skeleton, mapped.changes), ...mapped.gaps, ...volumeErrors(skeleton, draft)])];
}

/**
 * Keep the piece. Pull intensity, volume, and the short/medium clock onto the locked day.
 * A long-day move or a different lift is structural and is left for a day rebuild.
 */
export function fitSessionToSkeletonDay(session: SessionDraft, day: SkeletonDay): SessionDraft {
  if (day.status === "rest" || session.rest || !session.conditioning) return session;
  const piece = { ...session.conditioning };
  const ceiling = day.conditioning.intensity_ceiling;
  if (isIntensity(piece.intensity) && rank(piece.intensity) > rank(ceiling)) piece.intensity = ceiling;
  if (VOLUME_RANK[piece.volume] > VOLUME_RANK[day.volume_profile]) piece.volume = day.volume_profile;
  const klass = day.conditioning.duration_class;
  const sessionLong = piece.time_domain === "long" || piece.long_conditioning;
  const skeletonLong = klass === "long" || day.long_day;
  if (sessionLong === skeletonLong) {
    if (klass === "short" && piece.time_domain !== "short") {
      piece.duration_min = 12;
      piece.time_domain = "short";
      piece.long_conditioning = false;
    } else if (klass === "medium" && piece.time_domain !== "medium") {
      piece.duration_min = 16;
      piece.time_domain = "medium";
      piece.long_conditioning = false;
    }
  }
  return fillSessionFields(
    {
      day: session.day,
      rest: session.rest,
      optional: session.optional,
      warmup_min: session.warmup_min,
      warmup_ko: session.warmup_ko,
      strength: session.strength,
      conditioning: piece,
    },
    session.strength_volume,
  );
}

function rank(value: IntensityBand): number {
  if (value === "light") return 0;
  if (value === "heavy") return 2;
  return 1;
}

export function daysInLockErrors(errors: readonly string[]): DayKey[] {
  const found = new Set<DayKey>();
  for (const error of errors) {
    for (const match of error.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g)) {
      found.add(match[1] as DayKey);
    }
  }
  return DAY_ORDER.filter((day) => found.has(day));
}

export type LockEnforcement = {
  draft: WeekDraft;
  before: string[];
  after: string[];
  fittedDays: DayKey[];
  regeneratedDays: DayKey[];
  unresolvedDays: DayKey[];
  ok: boolean;
};

/**
 * Compare the prescription already written to the stored skeleton.
 * Clamp a day in place when the piece can stay. Rebuild only days that are still wrong.
 * Days that were already legal are not replaced.
 */
export function enforceLockedSkeleton(input: {
  skeleton: WeeklySkeleton;
  draft: WeekDraft;
  rebuildDay?: (day: DayKey) => SessionDraft | null;
}): LockEnforcement {
  const before = prescriptionLockErrors(input.skeleton, input.draft);
  const sessions = input.draft.sessions.map((session) => session);
  const fitted = new Set<DayKey>();
  for (const day of input.skeleton.days) {
    const index = sessions.findIndex((session) => session.day === day.day);
    if (index < 0) continue;
    const next = fitSessionToSkeletonDay(sessions[index]!, day);
    if (JSON.stringify(next) !== JSON.stringify(sessions[index])) {
      fitted.add(day.day);
      sessions[index] = next;
    }
  }
  let draft: WeekDraft = { ...input.draft, sessions };
  const regenerated: DayKey[] = [];
  if (input.rebuildDay) {
    for (const day of daysInLockErrors(prescriptionLockErrors(input.skeleton, draft))) {
      const rebuilt = input.rebuildDay(day);
      if (!rebuilt) continue;
      const skeletonDay = input.skeleton.days.find((row) => row.day === day);
      const next = skeletonDay ? fitSessionToSkeletonDay(rebuilt, skeletonDay) : rebuilt;
      const index = sessions.findIndex((session) => session.day === day);
      if (index < 0) continue;
      sessions[index] = next;
      regenerated.push(day);
      fitted.delete(day);
    }
    draft = { ...draft, sessions };
  }
  const after = prescriptionLockErrors(input.skeleton, draft);
  return {
    draft,
    before,
    after,
    fittedDays: DAY_ORDER.filter((day) => fitted.has(day)),
    regeneratedDays: regenerated,
    unresolvedDays: daysInLockErrors(after),
    ok: input.skeleton.skeleton_locked && after.length === 0,
  };
}

export function rebuildLockedDay(input: {
  day: DayKey;
  skeleton: WeeklySkeleton;
  month: MonthDirection;
  weekIndex: WeekIndex;
  thesis: WeeklyThesis;
  actual?: WeekActual | null;
  recent?: readonly import("../types").StoredStructure[];
  salt: number;
}): SessionDraft | null {
  const intent = intentFromSkeleton(input.skeleton, input.month, input.thesis).days.find((row) => row.day === input.day);
  const skeletonDay = input.skeleton.days.find((row) => row.day === input.day);
  if (!intent || !skeletonDay) return null;
  return buildSession({
    intent,
    month: input.month,
    weekIndex: input.weekIndex,
    actual: input.actual,
    salt: input.salt,
    previousStimulus: null,
    chosen: [],
    recent: input.recent ?? [],
    shortClock: skeletonDay.conditioning.duration_class === "short",
  });
}

export function skeletonLockRecord(enforced: LockEnforcement): WeeklyIntentPlan["skeleton_lock"] {
  return {
    before: enforced.before,
    after: enforced.after,
    fitted_days: enforced.fittedDays,
    regenerated_days: enforced.regeneratedDays,
    unresolved_days: enforced.unresolvedDays,
  };
}
