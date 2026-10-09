import { DAY_ORDER } from "../../month-plan/types";
import { JSON_OBJECT } from "../coaching/contract";
import { askCoach } from "../coaching/llm";
import { coachModel } from "../coaching/models";
import type { FetchLike } from "../model";
import { weeklyTimeoutMs } from "../timeouts";
import type { WeekActual } from "../summary";
import type { CoachingStimulus, IntensityBand, MonthDirection, PrimaryTraining, StrengthLiftChoice, WeekDraft, WeekIndex, WeeklyIntentPlan } from "../types";
import { COACHING_STIMULI, PRIMARY_TRAININGS } from "../types";
import { deriveMonthlyThesis, deriveQuarterly, deriveWeeklyThesis, deterministicIntent, skeletonFromIntent } from "./derive";
import { validationFeedback } from "./feedback";
import { repairSkeleton } from "./repair";
import { skeletonLiftMap, validateSkeleton, type SkeletonCheck } from "./structure";
import { DURATION_CLASSES, PLANNING_VERSION, STRENGTH_EMPHASES, type DurationClass, type LongitudinalPlan, type SkeletonDay, type StrengthEmphasis, type WeeklySkeleton, type WeeklyThesis } from "./types";

export type { LongitudinalPlan } from "./types";

const STAGES = ["quarterly", "monthly", "weekly_thesis", "weekly_skeleton", "skeleton_validation", "skeleton_lock"] as const;

const SKELETON_SYSTEM = [
  "ROLE",
  "You write one weekly skeleton for one athlete. You do not write movements, reps, loads, or formats.",
  "OBJECTIVE",
  "Return seven days. Each day has status, primary goal, strength placement, conditioning duration class, conditioning intensity, stimulus, benchmark, and long-day.",
  "CONSTRAINTS",
  "Use the project enums. duration_class is short, medium, long, or rest. intensity_class is light, moderate, or heavy. A rest day cannot hold a benchmark. A deload week cannot use heavy conditioning. Do not copy the previous two weeks' strength placement.",
  "OUTPUT",
  "One JSON object with a days array. No sessions.",
].join("\n");

const SKELETON_SCHEMA = "days[].day, status, primary_goal, strength.emphasis, strength.lift, conditioning.duration_class, conditioning.intensity_class, conditioning.stimulus, benchmark, long_day";

const LIFTS = ["squat", "ohp", "bench", "deadlift", "none"] as const;

export type PlanLongitudinalInput = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentPlans?: readonly WeeklyIntentPlan[];
  recentStrengthMaps?: readonly string[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};

export function strengthMapsFromPlans(plans: readonly WeeklyIntentPlan[] | undefined): string[] {
  if (!plans) return [];
  const maps: string[] = [];
  for (const plan of plans) {
    const skeleton = plan.longitudinal?.skeleton;
    if (skeleton?.skeleton_locked) maps.push(skeletonLiftMap(skeleton.days));
  }
  return maps;
}

export function withLongitudinal(draft: WeekDraft, longitudinal: LongitudinalPlan | null): WeekDraft {
  if (!longitudinal || !draft.intent.plan) return draft;
  return {
    ...draft,
    intent: {
      ...draft.intent,
      plan: { ...draft.intent.plan, longitudinal },
    },
  };
}

function checkFor(input: PlanLongitudinalInput, thesis: WeeklyThesis, maps: readonly string[]): SkeletonCheck {
  return {
    month: input.month,
    weekIndex: input.weekIndex,
    thesis,
    recentStrengthMaps: maps,
  };
}

function finish(skeleton: WeeklySkeleton, errors: readonly string[], thesis: WeeklyThesis): WeeklySkeleton {
  const feedback = errors.length ? validationFeedback(errors) : [];
  return {
    ...skeleton,
    skeleton_locked: errors.length === 0,
    validation_errors: [...errors],
    feedback,
    week_phase: thesis.week_phase,
    weekly_role: thesis.recovery_demand,
  };
}

function settle(skeleton: WeeklySkeleton, check: SkeletonCheck, thesis: WeeklyThesis): WeeklySkeleton {
  const before = validateSkeleton(skeleton, check);
  if (!before.length) return finish(skeleton, [], thesis);
  const repaired = repairSkeleton(skeleton, thesis.long_session);
  const after = validateSkeleton(repaired.skeleton, check);
  return finish({ ...repaired.skeleton, repair_trace: repaired.steps }, after, thesis);
}

export async function planLongitudinal(input: PlanLongitudinalInput): Promise<LongitudinalPlan> {
  const quarterly = deriveQuarterly(input.month);
  const monthly = deriveMonthlyThesis(input.month, input.previousActual);
  const signatures = (input.recentPlans ?? []).map((plan) => plan.days.map((day) => day.primary_training).join("|"));
  const intent = deterministicIntent({
    month: input.month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: signatures,
  });
  const thesis = deriveWeeklyThesis({ month: input.month, weekIndex: input.weekIndex, intent, monthly });
  const seed = skeletonFromIntent(intent, thesis);
  const maps = [...strengthMapsFromPlans(input.recentPlans), ...(input.recentStrengthMaps ?? [])];
  const check = checkFor(input, thesis, maps);
  const key = input.key?.trim() ? input.key.trim() : null;
  let skeleton = seed;
  if (key) {
    const asked = await askCoach({
      agent: "weekly",
      user: {
        task: "Write the weekly skeleton. Do not write a session.",
        week_index: input.weekIndex,
        week_phase: thesis.week_phase,
        conditioning_intensity_ceiling: thesis.conditioning_intensity_ceiling,
        benchmark_required: thesis.benchmark,
        long_required: thesis.long_session,
        recent_strength_maps: maps.slice(-2),
        seed: seed.days,
      },
      key,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs ?? weeklyTimeoutMs(),
      maxTokens: 2000,
      promptVersion: "skeleton-v1",
      runId: `skeleton-${input.weekIndex}`,
      temperature: 0,
      format: JSON_OBJECT,
      systemPrompt: SKELETON_SYSTEM,
      schemaNote: SKELETON_SCHEMA,
      validate: (json) => {
        const parsed = parseModelSkeleton(json, seed);
        if (!parsed) return { ok: false, errors: validationFeedback(["weekly skeleton must contain seven days"]) };
        const errors = validateSkeleton(parsed, check);
        return errors.length ? { ok: false, errors: validationFeedback(errors) } : { ok: true };
      },
    });
    const parsed = parseModelSkeleton(asked.json, seed);
    const modelName = asked.model || coachModel("weekly");
    if (asked.ok && parsed && !validateSkeleton(parsed, check).length) {
      skeleton = finish(parsed, [], thesis);
      skeleton.source = "model";
      skeleton.model = modelName;
      skeleton.rewrite_count = asked.retryCount > 0 ? 1 : 0;
    } else {
      const repaired = parsed ? settle(parsed, check, thesis) : null;
      if (repaired?.skeleton_locked) {
        skeleton = repaired;
      } else {
        const rejected = parsed ? validateSkeleton(parsed, check) : ["weekly skeleton must contain seven days"];
        skeleton = settle(seed, check, thesis);
        if (skeleton.skeleton_locked) skeleton.feedback = validationFeedback(rejected);
      }
      skeleton.model = modelName;
      skeleton.rewrite_count = 1;
    }
  } else {
    skeleton = settle(seed, check, thesis);
  }
  return {
    version: PLANNING_VERSION,
    stages: [...STAGES],
    quarterly,
    monthly,
    weekly_thesis: thesis,
    skeleton,
  };
}

function parseModelSkeleton(json: unknown, seed: WeeklySkeleton): WeeklySkeleton | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { days?: unknown };
  if (!Array.isArray(body.days)) return null;
  const days: SkeletonDay[] = [];
  for (const key of DAY_ORDER) {
    const row = body.days.find((item) => item && typeof item === "object" && (item as { day?: unknown }).day === key);
    if (!row || typeof row !== "object") return null;
    const seedDay = seed.days.find((item) => item.day === key);
    if (!seedDay) return null;
    const parsed = dayFromModel(row as Record<string, unknown>, seedDay, seed.week_phase === "DELOAD");
    if (!parsed) return null;
    days.push(parsed);
  }
  return {
    ...structuredClone(seed),
    days,
    source: "model",
    skeleton_locked: false,
    validation_errors: [],
    feedback: [],
    repair_trace: [],
  };
}

function dayFromModel(row: Record<string, unknown>, seed: SkeletonDay, deload: boolean): SkeletonDay | null {
  const status = row.status === "rest" || row.status === "training" ? row.status : null;
  const primary = typeof row.primary_goal === "string" && (PRIMARY_TRAININGS as readonly string[]).includes(row.primary_goal) ? (row.primary_goal as PrimaryTraining) : null;
  if (!status || !primary) return null;
  const strength = row.strength;
  const conditioning = row.conditioning;
  if (!strength || typeof strength !== "object" || !conditioning || typeof conditioning !== "object") return null;
  const emphasis = enumOf((strength as { emphasis?: unknown }).emphasis, STRENGTH_EMPHASES);
  const lift = enumOf((strength as { lift?: unknown }).lift, LIFTS);
  const duration = durationOf((conditioning as { duration_class?: unknown }).duration_class);
  const intensity = intensityOf((conditioning as { intensity_class?: unknown }).intensity_class);
  if (!emphasis || !lift || !duration || !intensity) return null;
  if (typeof row.benchmark !== "boolean" || typeof row.long_day !== "boolean") return null;
  const rawStimulus = (conditioning as { stimulus?: unknown }).stimulus;
  const stimulus = typeof rawStimulus === "string" && (COACHING_STIMULI as readonly string[]).includes(rawStimulus) ? (rawStimulus as CoachingStimulus) : seed.conditioning.stimulus;
  const ceiling: IntensityBand = deload ? "moderate" : intensity;
  return {
    ...seed,
    status,
    primary_goal: primary,
    strength: { emphasis: emphasis as StrengthEmphasis, lift: lift as StrengthLiftChoice },
    conditioning: {
      duration_class: duration,
      intensity_class: intensity,
      intensity_ceiling: ceiling,
      stimulus,
    },
    benchmark: row.benchmark,
    long_day: row.long_day,
    recovery_demand: status === "rest" ? "low" : seed.recovery_demand,
    volume_profile: status === "rest" ? "low" : seed.volume_profile,
    preferred_format: null,
    prohibited_patterns: deload ? ["heavy_conditioning"] : [],
  };
}

function durationOf(value: unknown): DurationClass | null {
  if (typeof value !== "string") return null;
  const token = value.toLowerCase();
  return (DURATION_CLASSES as readonly string[]).includes(token) ? (token as DurationClass) : null;
}

function intensityOf(value: unknown): IntensityBand | null {
  if (typeof value !== "string") return null;
  const token = value.toLowerCase() === "high" ? "heavy" : value.toLowerCase();
  if (token === "light" || token === "moderate" || token === "heavy") return token;
  return null;
}

function enumOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function cloneSkeleton(skeleton: WeeklySkeleton): WeeklySkeleton {
  return structuredClone(skeleton);
}
