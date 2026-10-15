import { DAY_ORDER } from "../../month-plan/types";
import type { ResponseFormat } from "../coaching/contract";
import { intensityBandsAtMost, intensityBandsForStimulus } from "../coaching/session-contract";
import { classRestDay, goalWeek } from "../coaching/goal-table";
import { askCoach } from "../coaching/llm";
import { coachModel } from "../coaching/models";
import type { FetchLike } from "../model";
import { weeklyTimeoutMs } from "../timeouts";
import type { WeekActual } from "../summary";
import type { CoachingStimulus, IntensityBand, MonthDirection, PrimaryTraining, StrengthLiftChoice, WeekDraft, WeekIndex, WeeklyIntentPlan } from "../types";
import { COACHING_STIMULI, PRIMARY_TRAININGS } from "../types";
import { deriveMonthlyThesis, deriveQuarterly, deriveWeeklyThesis, deterministicIntent, skeletonFromIntent } from "./derive";
import { coachingStimuliForCeiling } from "./feasibility";
import { validationFeedback } from "./feedback";
import { extractWeekRules } from "../coaching/stage13/rules";
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
  "Use the project enums. duration_class is short, medium, long, or rest. intensity_class must be one of intensity_class_enum. Do not pick a band above conditioning_intensity_ceiling. A rest day cannot hold a benchmark. A deload week cannot use heavy conditioning. Do not copy the previous two weeks' strength placement. On a six-day class week the schema closes Sunday as the only rest day. Do not move it.",
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
    actual: input.previousActual,
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
  const maxLower = extractWeekRules({ month: check.month, weekIndex: check.weekIndex, actual: check.actual }).max_lower_lifts;
  const repaired = repairSkeleton(skeleton, thesis.long_session, maxLower);
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
  const thesis = deriveWeeklyThesis({
    month: input.month,
    weekIndex: input.weekIndex,
    intent,
    monthly,
    previousActual: input.previousActual,
  });
  const seed = skeletonFromIntent(intent, thesis);
  const maps = [...strengthMapsFromPlans(input.recentPlans), ...(input.recentStrengthMaps ?? [])];
  const check = checkFor(input, thesis, maps);
  const key = input.key?.trim() ? input.key.trim() : null;
  const stimuli = goalStimuli(input);
  const format = skeletonFormat(thesis.conditioning_intensity_ceiling, stimuli, classRestDay(input.month));
  const impossible = DAY_ORDER.filter((day) => dayIntensityEnum(thesis.conditioning_intensity_ceiling, stimuli[day]).length === 0);
  let skeleton = seed;
  if (key && format) {
    const asked = await askCoach({
      agent: "weekly",
      retryTransport: true,
      user: {
        task: "Write the weekly skeleton. Do not write a session.",
        week_index: input.weekIndex,
        week_phase: thesis.week_phase,
        conditioning_intensity_ceiling: thesis.conditioning_intensity_ceiling,
        intensity_class_enum: intensityBandsAtMost(thesis.conditioning_intensity_ceiling),
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
      format,
      systemPrompt: SKELETON_SYSTEM,
      schemaNote: SKELETON_SCHEMA,
      validate: (json) => {
        const parsed = parseModelSkeleton(json, seed, thesis.conditioning_intensity_ceiling, goalStimuli(input));
        if (!parsed) return { ok: false, errors: validationFeedback(["weekly skeleton must contain seven days"]) };
        const errors = validateSkeleton(parsed, check);
        return errors.length ? { ok: false, errors: validationFeedback(errors) } : { ok: true };
      },
    });
    const parsed = parseModelSkeleton(asked.json, seed, thesis.conditioning_intensity_ceiling, goalStimuli(input));
    const modelName = asked.model || coachModel("weekly");
    if (asked.ok && parsed && !validateSkeleton(parsed, check).length) {
      skeleton = finish(parsed, [], thesis);
      skeleton.source = "model";
      skeleton.model = modelName;
      skeleton.rewrite_count = asked.retryCount > 0 ? 1 : 0;
    } else if (!parsed && (asked.reason === "schema" || asked.reason === "bad_json")) {
      skeleton = settle(seed, check, thesis);
      skeleton.model = modelName;
      skeleton.rewrite_count = 1;
      if (skeleton.skeleton_locked) {
        skeleton.skeleton_locked = false;
        skeleton.feedback = validationFeedback(["model skeleton format failed; code frame kept"]);
      } else {
        skeleton.validation_errors = [SKELETON_FORMAT_FAILED, ...skeleton.validation_errors];
        skeleton.feedback = validationFeedback(["weekly skeleton format failed"]);
      }
    } else {
      const repaired = parsed ? settle(parsed, check, thesis) : null;
      if (repaired?.skeleton_locked) {
        skeleton = repaired;
      } else {
        const rejected = parsed ? validateSkeleton(parsed, check) : ["weekly skeleton must contain seven days"];
        skeleton = settle(seed, check, thesis);
        if (skeleton.skeleton_locked) {
          skeleton.skeleton_locked = false;
          skeleton.feedback = validationFeedback(rejected);
        } else {
          skeleton.validation_errors = [SKELETON_FORMAT_FAILED, ...skeleton.validation_errors];
        }
      }
      skeleton.model = modelName;
      skeleton.rewrite_count = 1;
    }
  } else {
    skeleton = settle(seed, check, thesis);
    if (impossible.length) {
      skeleton.skeleton_locked = false;
      skeleton.validation_errors = impossible.map((day) => `empty_enum:${day}.intensity_class`);
    }
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

function goalStimuli(input: PlanLongitudinalInput): Partial<Record<(typeof DAY_ORDER)[number], string | null>> {
  const goal = goalWeek(input.month.coaching_plan?.goal_table, input.weekIndex);
  const stimuli: Partial<Record<(typeof DAY_ORDER)[number], string | null>> = {};
  for (const day of goal?.days ?? []) stimuli[day.day] = day.stimulus;
  return stimuli;
}

function dayIntensityEnum(weekCeiling: IntensityBand, stimulus: string | null | undefined): IntensityBand[] {
  if (stimulus === "heavy") return intensityBandsForStimulus(weekCeiling, ["heavy"]);
  return intensityBandsAtMost(weekCeiling);
}

export const SKELETON_FORMAT_FAILED = "skeleton_format_failed";

/**
 * 기본 6일 수업은 일요일 휴식, 월~토 훈련이다.
 * 모델이 평일을 휴식으로 두면 그 요일은 코드 시드의 훈련일로 바꾼다.
 * 둘 다 훈련이면 모델의 목표·강도·리프트를 남긴다.
 */
export function applyClassSkeletonFrame(days: SkeletonDay[], seed: WeeklySkeleton): SkeletonDay[] {
  const seedRest = seed.days.filter((day) => day.status === "rest");
  if (seedRest.length !== 1 || seedRest[0]?.day !== "sun") return days;
  const seedBy = new Map(seed.days.map((day) => [day.day, day]));
  return DAY_ORDER.map((key) => {
    const model = days.find((day) => day.day === key);
    const code = seedBy.get(key);
    if (!code) return model ?? days[0]!;
    if (key === "sun" || !model || model.status === "rest") return structuredClone(code);
    return model;
  });
}

export function skeletonFormatFailed(plan: LongitudinalPlan | null | undefined): boolean {
  return Boolean(plan?.skeleton.validation_errors.includes(SKELETON_FORMAT_FAILED));
}

function parseModelSkeleton(
  json: unknown,
  seed: WeeklySkeleton,
  ceiling: IntensityBand,
  stimuli: Partial<Record<(typeof DAY_ORDER)[number], string | null>> = {},
): WeeklySkeleton | null {
  if (!json || typeof json !== "object") return null;
  const body = json as { days?: unknown };
  if (!Array.isArray(body.days)) return null;
  const days: SkeletonDay[] = [];
  for (const key of DAY_ORDER) {
    const row = body.days.find((item) => item && typeof item === "object" && (item as { day?: unknown }).day === key);
    if (!row || typeof row !== "object") return null;
    const seedDay = seed.days.find((item) => item.day === key);
    if (!seedDay) return null;
    const parsed = dayFromModel(row as Record<string, unknown>, seedDay, seed.week_phase === "DELOAD", ceiling, stimuli[key]);
    if (!parsed) return null;
    days.push(parsed);
  }
  const framed = applyClassSkeletonFrame(days, seed);
  return {
    ...structuredClone(seed),
    days: framed,
    source: "model",
    skeleton_locked: false,
    validation_errors: [],
    feedback: [],
    repair_trace: [],
  };
}

function dayFromModel(
  row: Record<string, unknown>,
  seed: SkeletonDay,
  deload: boolean,
  weekCeiling: IntensityBand,
  sessionStimulus?: string | null,
): SkeletonDay | null {
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
  if (!dayIntensityEnum(weekCeiling, sessionStimulus).includes(intensity)) return null;
  if (bandRank(intensity) > bandRank(weekCeiling)) return null;
  if (typeof row.benchmark !== "boolean" || typeof row.long_day !== "boolean") return null;
  const rawStimulus = (conditioning as { stimulus?: unknown }).stimulus;
  const stimulus = typeof rawStimulus === "string" && (COACHING_STIMULI as readonly string[]).includes(rawStimulus) ? (rawStimulus as CoachingStimulus) : null;
  if (!stimulus || !coachingStimuliForCeiling(intensity).includes(stimulus)) return null;
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

function bandRank(value: IntensityBand): number {
  if (value === "light") return 0;
  if (value === "heavy") return 2;
  return 1;
}

function conditioningBranch(intensity: IntensityBand): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      duration_class: { type: "string", enum: [...DURATION_CLASSES] },
      intensity_class: { type: "string", enum: [intensity] },
      stimulus: { type: "string", enum: coachingStimuliForCeiling(intensity) },
    },
    required: ["duration_class", "intensity_class", "stimulus"],
  };
}

function strengthSchema(): Record<string, unknown> {
  const branch = (lifts: readonly string[], emphases: readonly string[]) => ({
    type: "object",
    additionalProperties: false,
    properties: {
      emphasis: { type: "string", enum: [...emphases] },
      lift: { type: "string", enum: [...lifts] },
    },
    required: ["emphasis", "lift"],
  });
  return {
    anyOf: [
      branch(["squat", "deadlift"], ["heavy_lower", "light", "moderate"]),
      branch(["bench", "ohp"], ["heavy_upper", "light", "moderate"]),
      branch(["none"], ["none"]),
    ],
  };
}

function skeletonDaySchema(
  day: (typeof DAY_ORDER)[number],
  ceiling: IntensityBand,
  stimulus: string | null | undefined,
  fixedRest: (typeof DAY_ORDER)[number] | null,
): Record<string, unknown> | null {
  const bands = dayIntensityEnum(ceiling, stimulus);
  if (!bands.length) return null;
  const conditioning = bands.map((band) => conditioningBranch(band));
  const rest = fixedRest != null && day === fixedRest;
  const train = fixedRest != null && day !== fixedRest;
  const status = rest ? ["rest"] : train ? ["training"] : ["rest", "training"];
  const primary = rest ? ["rest"] : train ? PRIMARY_TRAININGS.filter((value) => value !== "rest") : [...PRIMARY_TRAININGS];
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      day: { type: "string", enum: [day] },
      status: { type: "string", enum: status },
      primary_goal: { type: "string", enum: [...primary] },
      strength: strengthSchema(),
      conditioning: conditioning.length === 1 ? conditioning[0] : { anyOf: conditioning },
      benchmark: { type: "boolean" },
      long_day: { type: "boolean" },
    },
    required: ["day", "status", "primary_goal", "strength", "conditioning", "benchmark", "long_day"],
  };
}

/** Null when any day has an empty intensity enum. The caller stops and does not fill a band. */
export function skeletonFormat(
  ceiling: IntensityBand,
  stimuli: Partial<Record<(typeof DAY_ORDER)[number], string | null>> = {},
  fixedRest: (typeof DAY_ORDER)[number] | null = null,
): ResponseFormat | null {
  const days: Record<string, unknown>[] = [];
  for (const day of DAY_ORDER) {
    const schema = skeletonDaySchema(day, ceiling, stimuli[day], fixedRest);
    if (!schema) return null;
    days.push(schema);
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "weekly_skeleton",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { days: { type: "array", items: { anyOf: days } } },
        required: ["days"],
      },
    },
  };
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
