import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { buildSession } from "../coaching/session";
import { fillSessionFields } from "../session-fields";
import type { WeekActual } from "../summary";
import type { IntensityBand, MonthDirection, SessionDraft, StrengthLiftChoice, VolumeBand, WeekDraft, WeekIndex, WeeklyIntentPlan } from "../types";
import { timeDomainFromMinutes } from "../coaching/canonical";
import { koreanRatio, TIME_DOMAIN_RANGES } from "../rules";
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
  const highFatigue = longitudinal.weekly_thesis.volume_ceiling === "low" && longitudinal.weekly_thesis.week_phase !== "DELOAD";
  const blockNote = koreanRatio(month.primary_block) >= 0.7 ? `${month.primary_block} 블록의 방법을 이번 주에도 유지합니다.` : "이번 주 블록의 방법을 유지합니다.";
  return {
    ...intent,
    why_ko: longitudinal.weekly_thesis.thesis || intent.why_ko,
    adjustment_ko: longitudinal.weekly_thesis.fatigue_distribution || intent.adjustment_ko,
    scheme_note: highFatigue ? "지난주 하체 피로가 높아 스쿼트와 데드리프트 세트를 줄입니다." : blockNote,
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
 * Category A only: lower intensity to the locked ceiling.
 * The piece, the duration class, and the volume band stay. Those are a one-day rewrite or a fallback.
 */
export function fitSessionToSkeletonDay(session: SessionDraft, day: SkeletonDay): SessionDraft {
  if (day.status === "rest" || session.rest || !session.conditioning) return session;
  const piece = { ...session.conditioning };
  const ceiling = day.conditioning.intensity_ceiling;
  if (!isIntensity(piece.intensity) || rank(piece.intensity) <= rank(ceiling)) return session;
  piece.intensity = ceiling;
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

const VOLUME_BANDS = ["low", "moderate", "high"] as const;

/** Reject a session JSON that leaves the locked duration class or volume band. Intensity stays a clamp. */
export function lockedSessionFieldErrors(value: unknown, day: SkeletonDay): string[] {
  if (day.status !== "training") return [];
  if (!value || typeof value !== "object") return [`${day.day} field conditioning received nothing; expected an object`];
  const piece = (value as { conditioning?: unknown }).conditioning;
  if (!piece || typeof piece !== "object") return [`${day.day} field conditioning received nothing; expected an object`];
  const body = piece as { duration_min?: unknown; volume?: unknown };
  const errors: string[] = [];
  const klass = day.conditioning.duration_class;
  if (klass === "short" || klass === "medium" || klass === "long") {
    const range = TIME_DOMAIN_RANGES[klass];
    const minutes = body.duration_min;
    const domain = typeof minutes === "number" ? timeDomainFromMinutes(minutes) : null;
    if (domain !== klass) {
      errors.push(
        `${day.day} field conditioning.duration_min received ${typeof minutes === "number" ? minutes : "missing"}; expected ${range.min}-${range.max} (${klass})`,
      );
    }
  }
  if (typeof body.volume === "string" && (VOLUME_BANDS as readonly string[]).includes(body.volume)) {
    const volume = body.volume as VolumeBand;
    if (VOLUME_RANK[volume] > VOLUME_RANK[day.volume_profile]) {
      errors.push(`${day.day} field conditioning.volume received ${volume}; expected at or below ${day.volume_profile}`);
    }
  }
  return errors;
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
  const built = buildSession({
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
  return built ? alignFallbackSession(built, skeletonDay) : null;
}

/** Fallback pieces must already satisfy the locked duration class and volume band. */
function alignFallbackSession(session: SessionDraft, day: SkeletonDay): SessionDraft {
  if (day.status === "rest" || session.rest || !session.conditioning) return session;
  const piece = { ...session.conditioning };
  const klass = day.conditioning.duration_class;
  if (klass === "short" || klass === "medium" || klass === "long") {
    const range = TIME_DOMAIN_RANGES[klass];
    const domain = timeDomainFromMinutes(piece.duration_min);
    if (domain !== klass || piece.time_domain !== klass) {
      piece.duration_min = klass === "short" ? 12 : klass === "medium" ? Math.max(range.min, 16) : 34;
      piece.time_domain = klass;
      piece.long_conditioning = klass === "long";
    }
  }
  if (VOLUME_RANK[piece.volume] > VOLUME_RANK[day.volume_profile]) piece.volume = day.volume_profile;
  const ceiling = day.conditioning.intensity_ceiling;
  if (isIntensity(piece.intensity) && rank(piece.intensity) > rank(ceiling)) piece.intensity = ceiling;
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

export function skeletonLockRecord(enforced: LockEnforcement): WeeklyIntentPlan["skeleton_lock"] {
  return {
    before: enforced.before,
    after: enforced.after,
    fitted_days: enforced.fittedDays,
    regenerated_days: enforced.regeneratedDays,
    unresolved_days: enforced.unresolvedDays,
  };
}
