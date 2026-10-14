import { DAY_ORDER, type DayKey, type WeekIndex } from "../../month-plan/types";
import type { WeekSkeleton, Zone2Annotation } from "../direction/contract";
import { strengthIsHeavy } from "../schemes";
import { exampleSets } from "../strength-methods";
import { COACHING_STIMULI, PRIMARY_TRAININGS, SECONDARY_TRAININGS, type WeekGoal } from "../types";
import { zone2Durations, zone2Effort, zone2Modalities } from "./zone2";
import {
  BLOCK_PHASES,
  DURATION_PROFILES,
  EMPHASIS,
  FATIGUE_TARGETS,
  INTENSITY_BANDS,
  INTENSITY_PROFILES,
  MOVEMENT_PATTERNS,
  RECOVERY_ROLES,
  STRENGTH_LIFTS,
  VOLUME_BANDS,
  type ResponseFormat,
} from "./contract";

/** 잠긴 뼈대의 heavy(강도 4–5) 요일만 heavy. 나머지는 1–3인 light·moderate. */
const HEAVY_PROFILE = ["heavy"] as const;
const LOW_PROFILE = ["light", "moderate"] as const;
const NON_LOWER = ["ohp", "bench", "none"] as const;

export type DayBound = {
  day: DayKey;
  heavy: boolean;
  intensity_band: "4-5" | "1-3" | "1-2";
  intensity_profile: readonly string[];
  strength_lift: readonly string[];
  /** 잠긴 뼈대에서 파생한 허용 조합. `lift:load`. 세션 enum은 이 목록만 따른다. */
  combinations: readonly string[];
  /** 컨디셔닝의 deadlift 키는 잠긴 조합이 deadlift일 때만. */
  deadliftConditioning: boolean;
  /** 그 요일이 squat 또는 deadlift를 낼 수 있으면 1. 주 합계가 max_lower_lifts를 넘지 않는다. */
  lower_lift_cap: 0 | 1;
  zone2?: readonly string[];
  zone2_modality?: readonly string[];
  zone2_duration?: readonly string[];
  zone2_effort?: readonly string[];
  zone2_hr?: readonly string[];
  /** 월간 목표 표가 있으면 그 날의 휴식·long·movement_pattern만 남긴다. */
  primary_training?: readonly string[];
  secondary_training?: readonly string[];
  stimulus?: readonly string[];
  movement_pattern?: readonly string[];
  recovery_role?: readonly string[];
};

export type DayBoundOptions = {
  /** 방법 표의 세트가 고강도인지 볼 때 쓴다. 없으면 부하 등급만 본다. */
  method?: string;
  /** 지난주 뼈대. 월요일은 그 일요일까지 실제 날짜로 본다. */
  previousWeek?: WeekSkeleton | null;
  /** 직전 주 존 2 모달. 이번 주 enum에서 뺀다. */
  previousModality?: string | null;
};

function enumOf(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: [...values] };
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function slotOf(day: WeekSkeleton["days"][number]): { pattern: string | null; bodyPart: string | null; loadClass: string | null } {
  const slot = day.slots.find((row) => row.role === "main") ?? day.slots[0];
  return {
    pattern: slot?.pattern ?? day.direction.targets.movementPatterns[0] ?? null,
    bodyPart: slot?.bodyPart ?? day.direction.targets.bodyParts[0] ?? null,
    loadClass: slot?.loadClass ?? null,
  };
}

function lowerKind(pattern: string | null, bodyPart: string | null): "squat" | "deadlift" | "both" | null {
  const squat = pattern === "squat";
  const hinge = pattern === "hinge" || pattern === "deadlift";
  if (squat && hinge) return "both";
  if (squat) return "squat";
  if (hinge) return "deadlift";
  if (bodyPart === "lower") return "both";
  return null;
}

function liftEnum(kind: "squat" | "deadlift" | "both" | null, cap: 0 | 1, rest: boolean): readonly string[] {
  if (rest) return ["none"];
  if (cap === 0 || !kind) return NON_LOWER;
  if (kind === "squat") return ["squat", ...NON_LOWER];
  if (kind === "deadlift") return ["deadlift", ...NON_LOWER];
  return ["squat", "deadlift", ...NON_LOWER];
}

function setsAreHeavy(method: string | undefined, weekIndex: WeekIndex, lift: "squat" | "deadlift"): boolean {
  if (!method) return false;
  const sets = exampleSets(method, weekIndex, "unknown", lift);
  return Boolean(sets && strengthIsHeavy(sets));
}

function lockedDeadlift(pattern: string | null): boolean {
  return pattern === "hinge" || pattern === "deadlift";
}

function calendarDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})$/);
  return match ? match[1]! : null;
}

function combinationsFor(lifts: readonly string[], heavy: boolean): string[] {
  const loads = heavy ? (["heavy"] as const) : (["light", "moderate"] as const);
  const out: string[] = [];
  for (const lift of lifts) {
    for (const load of loads) out.push(`${lift}:${load}`);
  }
  return out;
}

type BoundSeed = {
  day: DayKey;
  date: string | null;
  rest: boolean;
  pattern: string | null;
  loadClass: string | null;
  weekIndex: WeekIndex;
  heavy: boolean;
  strength_lift: readonly string[];
  lower_lift_cap: 0 | 1;
};

function boundSeeds(skeleton: WeekSkeleton, maxLowerLifts: number): BoundSeed[] {
  const byDay = new Map(skeleton.days.map((day) => [day.day, day]));
  const candidates: DayKey[] = [];
  for (const day of DAY_ORDER) {
    const row = byDay.get(day);
    if (!row || row.dayType === "rest") continue;
    const slot = slotOf(row);
    if (lowerKind(slot.pattern, slot.bodyPart)) candidates.push(day);
  }
  const allowed = new Set(candidates.slice(0, Math.max(0, maxLowerLifts)));
  return DAY_ORDER.map((day) => {
    const row = byDay.get(day);
    const rest = !row || row.dayType === "rest";
    const slot = row ? slotOf(row) : { pattern: null, bodyPart: null, loadClass: null };
    const heavy = !rest && (slot.loadClass === "heavy" || (row?.direction.intensity ?? 0) >= 4);
    const kind = rest ? null : lowerKind(slot.pattern, slot.bodyPart);
    const cap: 0 | 1 = !rest && allowed.has(day) ? 1 : 0;
    return {
      day,
      date: calendarDate(row?.date),
      rest,
      pattern: slot.pattern,
      loadClass: slot.loadClass,
      weekIndex: row?.weekIndex ?? skeleton.weekIndex,
      heavy,
      strength_lift: liftEnum(kind, cap, rest),
      lower_lift_cap: cap,
    };
  });
}

function heavyDeadliftSource(seed: BoundSeed, method: string | undefined): boolean {
  if (seed.rest) return false;
  if (!lockedDeadlift(seed.pattern) && !seed.strength_lift.includes("deadlift")) return false;
  if (seed.loadClass === "heavy") return true;
  return setsAreHeavy(method, seed.weekIndex, "deadlift");
}

function squatWouldBeHeavy(seed: BoundSeed, method: string | undefined): boolean {
  if (setsAreHeavy(method, seed.weekIndex, "squat")) return true;
  return !method && seed.loadClass === "heavy";
}

function withZone2(bound: DayBound, zone2: Zone2Annotation, previousModality: string | null | undefined): DayBound {
  const designated = zone2.form === "none" ? null : (zone2.allowedDays[0] ?? null);
  const host = designated === bound.day;
  const dayHost = zone2.form === "day" && host;
  const modalities = host ? zone2Modalities(previousModality, { dropRun: zone2.lowerAdjacent.includes(bound.day) }) : [];
  const durations = host ? zone2Durations(zone2.form, zone2.deload) : [];
  const effort = host ? zone2Effort(zone2.deload) : [];
  return {
    ...bound,
    heavy: dayHost ? false : bound.heavy,
    intensity_band: dayHost ? "1-2" : bound.intensity_band,
    intensity_profile: dayHost ? ["light"] : bound.intensity_profile,
    zone2: host ? [zone2.form] : ["none"],
    zone2_modality: host ? modalities : ["none"],
    zone2_duration: host ? durations.map(String) : ["0"],
    zone2_effort: host ? [...effort] : ["none"],
    zone2_hr: host ? ["60-70", "unspecified"] : ["none"],
  };
}

function finishBound(seed: BoundSeed, lifts: readonly string[]): DayBound {
  const deadliftConditioning = !seed.rest && (lockedDeadlift(seed.pattern) || lifts.includes("deadlift"));
  return {
    day: seed.day,
    heavy: seed.heavy,
    intensity_band: seed.heavy ? "4-5" : "1-3",
    intensity_profile: seed.heavy ? HEAVY_PROFILE : LOW_PROFILE,
    strength_lift: lifts,
    combinations: seed.rest ? ["none:light"] : combinationsFor(lifts, seed.heavy),
    deadliftConditioning,
    lower_lift_cap: seed.lower_lift_cap,
  };
}

/**
 * 요일별 intensity_profile·strength_lift enum.
 * 하체 리프트는 주 합계 규칙(max_lower_lifts)이라, 뼈대 슬롯 후보를 요일 순으로 나눠 상한의 합이 그 수를 넘지 않게 한다.
 * 데드리프트 다음 날의 헤비 스쿠트는 여기서 뺀다. 월요일은 지난주 일요일을 본다.
 */
export function dayBoundsFromSkeleton(
  skeleton: WeekSkeleton | null,
  maxLowerLifts: number,
  options?: DayBoundOptions,
): DayBound[] | null {
  if (!skeleton || skeleton.days.length === 0) return null;
  const seeds = boundSeeds(skeleton, maxLowerLifts);
  const distinct = seeds.every((seed) => seed.date) && new Set(seeds.map((seed) => seed.date)).size === seeds.length;
  const ordered = distinct ? [...seeds].sort((left, right) => left.date!.localeCompare(right.date!)) : seeds;
  const method = options?.method;
  let priorHeavy = false;
  const previous = options?.previousWeek ? boundSeeds(options.previousWeek, maxLowerLifts).find((seed) => seed.day === "sun") : null;
  if (previous && (!distinct || !ordered[0]?.date || !previous.date || previous.date < ordered[0].date)) {
    priorHeavy = heavyDeadliftSource(previous, method);
  }
  const filtered = new Map<DayKey, readonly string[]>();
  for (const seed of ordered) {
    let lifts = seed.strength_lift;
    if (!seed.rest && priorHeavy && lifts.includes("squat") && squatWouldBeHeavy(seed, method)) {
      lifts = lifts.filter((lift) => lift !== "squat");
    }
    filtered.set(seed.day, lifts);
    priorHeavy = heavyDeadliftSource({ ...seed, strength_lift: lifts }, method);
  }
  const bounds = seeds.map((seed) => finishBound(seed, filtered.get(seed.day) ?? seed.strength_lift));
  if (!skeleton.zone2) return bounds;
  return bounds.map((bound) => withZone2(bound, skeleton.zone2!, options?.previousModality));
}

export function lowerLiftCapSum(bounds: readonly DayBound[]): number {
  return bounds.reduce((sum, day) => sum + day.lower_lift_cap, 0);
}

export function weekBoundsNote(bounds: readonly DayBound[]): string {
  const lines = bounds.map(
    (day) =>
      `${day.day} heavy=${day.heavy} intensity_band=${day.intensity_band} intensity_profile=${day.intensity_profile.join("|")} strength_lift=${day.strength_lift.join("|")} combinations=${day.combinations.join("|")} lower_lift_cap=${day.lower_lift_cap}${day.primary_training ? ` primary_training=${day.primary_training.join("|")}` : ""}${day.secondary_training ? ` secondary_training=${day.secondary_training.join("|")}` : ""}${day.stimulus ? ` stimulus=${day.stimulus.join("|")}` : ""}${day.movement_pattern ? ` movement_pattern=${day.movement_pattern.join("|")}` : ""}${day.recovery_role ? ` recovery_role=${day.recovery_role.join("|")}` : ""}${day.zone2 ? ` zone2=${day.zone2.join("|")} zone2_modality=${day.zone2_modality?.join("|") ?? ""} zone2_duration=${day.zone2_duration?.join("|") ?? ""} zone2_effort=${day.zone2_effort?.join("|") ?? ""} zone2_hr=${day.zone2_hr?.join("|") ?? ""}` : ""}`,
  );
  return [
    "Per-day enums are closed. Do not use a value outside that day.",
    "When zone2 is listed, the designated day is the one zone2 day and every other day is none. zone2_effort conversational means RPE 2-3, a conversational pace, including a deload week. zone2_hr 60-70 is auxiliary and may be unspecified. A zone2 day uses intensity_profile light (band 1-2) and does not count toward the high-intensity cap. Duration is 40 or 45, or 30 on a deload week.",
    ...lines,
  ].join("\n");
}

const DAY_FIELDS = [
  "day",
  "primary_training",
  "secondary_training",
  "training_goal",
  "stimulus",
  "intensity_profile",
  "volume_profile",
  "duration_profile",
  "fatigue_target",
  "movement_pattern",
  "progression_required",
  "recovery_role",
  "strength_lift",
  "benchmark",
  "notes_ko",
] as const;

function daySchema(bound: DayBound): Record<string, unknown> {
  return objectSchema(
    {
      day: enumOf([bound.day]),
      primary_training: enumOf(bound.primary_training ?? PRIMARY_TRAININGS),
      secondary_training: enumOf(bound.secondary_training ?? SECONDARY_TRAININGS),
      training_goal: { type: "string" },
      stimulus: enumOf(bound.stimulus ?? COACHING_STIMULI),
      intensity_profile: enumOf(bound.intensity_profile),
      volume_profile: enumOf(VOLUME_BANDS),
      duration_profile: enumOf(DURATION_PROFILES),
      fatigue_target: enumOf(FATIGUE_TARGETS),
      movement_pattern: enumOf(bound.movement_pattern ?? MOVEMENT_PATTERNS),
      progression_required: { type: "boolean" },
      recovery_role: enumOf(bound.recovery_role ?? RECOVERY_ROLES),
      strength_lift: enumOf(bound.strength_lift),
      benchmark: { type: "boolean" },
      notes_ko: { type: "string" },
      ...(bound.zone2
        ? {
            zone2: enumOf(bound.zone2),
            zone2_modality: enumOf(bound.zone2_modality ?? ["none"]),
            zone2_duration: enumOf(bound.zone2_duration ?? ["0"]),
            zone2_effort: enumOf(bound.zone2_effort ?? ["none"]),
            zone2_hr: enumOf(bound.zone2_hr ?? ["none"]),
          }
        : {}),
    },
    bound.zone2 ? [...DAY_FIELDS, "zone2", "zone2_modality", "zone2_duration", "zone2_effort", "zone2_hr"] : [...DAY_FIELDS],
  );
}

/** 뼈대가 없어도 목표 표가 있으면 주간 응답 스키마를 연다. 강도·리프트는 닫지 않는다. */
export function boundsFromWeekGoal(goal: WeekGoal): DayBound[] {
  const open: DayBound[] = DAY_ORDER.map((day) => ({
    day,
    heavy: false,
    intensity_band: "1-3",
    intensity_profile: [...INTENSITY_BANDS],
    strength_lift: [...STRENGTH_LIFTS],
    combinations: [],
    deadliftConditioning: true,
    lower_lift_cap: 1,
  }));
  return applyWeekGoalBounds(open, goal);
}

/**
 * 월간 목표 표의 휴식, long, movement_pattern만 그 날 enum에 남긴다.
 * 표에 없는 long_conditioning과 long_mixed는 넣지 않는다. 코드가 모델 출력을 고치지 않는다.
 */
export function applyWeekGoalBounds(bounds: readonly DayBound[], goal: WeekGoal): DayBound[] {
  const withoutLong = SECONDARY_TRAININGS.filter((value) => value !== "long_conditioning");
  const withoutLongStimulus = COACHING_STIMULI.filter((value) => value !== "long_mixed");
  const trainingPrimary = PRIMARY_TRAININGS.filter((value) => value !== "rest");
  const trainingRecovery = RECOVERY_ROLES.filter((value) => value !== "rest");
  return bounds.map((bound) => {
    const day = goal.days.find((row) => row.day === bound.day);
    if (!day) return { ...bound };
    if (day.rest) {
      return {
        ...bound,
        primary_training: ["rest"],
        recovery_role: ["rest"],
        secondary_training: withoutLong,
        stimulus: withoutLongStimulus,
      };
    }
    const pattern = day.target?.movement_pattern;
    const long = day.time_domain === "long";
    return {
      ...bound,
      primary_training: trainingPrimary,
      recovery_role: trainingRecovery,
      secondary_training: long ? ["long_conditioning"] : withoutLong,
      stimulus: long ? [...COACHING_STIMULI] : withoutLongStimulus,
      ...(pattern ? { movement_pattern: [pattern] } : {}),
    };
  });
}

/** A day whose intensity enum was emptied by the ceiling table. Generation stops before the model call. */
export function emptyIntensityCauses(bounds: readonly DayBound[]): { code: "empty_enum"; path: string; detail: string }[] {
  return bounds.flatMap((bound) =>
    bound.intensity_profile.length
      ? []
      : [{ code: "empty_enum" as const, path: `${bound.day}.intensity_profile`, detail: `${bound.day} intensity enum is empty` }],
  );
}

/** 7일 배열. 각 요일 스키마의 intensity_profile·strength_lift enum이 다르다. OpenAI strict는 prefixItems를 거절하므로 anyOf다. */
export function weeklyResponseFormat(bounds: readonly DayBound[]): ResponseFormat {
  return {
    type: "json_schema",
    json_schema: {
      name: "weekly_intent",
      strict: true,
      schema: objectSchema(
        {
          block_phase: enumOf(BLOCK_PHASES),
          emphasis: enumOf(EMPHASIS),
          why_ko: { type: "string" },
          focus: { type: "string" },
          scheme_note: { type: "string" },
          adjustment_ko: { type: "string" },
          days: {
            type: "array",
            minItems: 7,
            maxItems: 7,
            items: { anyOf: bounds.map((bound) => daySchema(bound)) },
          },
        },
        ["block_phase", "emphasis", "why_ko", "focus", "scheme_note", "adjustment_ko", "days"],
      ),
    },
  };
}

export function intensityAllowed(bounds: readonly DayBound[] | null, day: string): readonly string[] {
  const found = bounds?.find((row) => row.day === day);
  return found ? found.intensity_profile : INTENSITY_PROFILES;
}

export function liftAllowed(bounds: readonly DayBound[] | null, day: string): readonly string[] {
  const found = bounds?.find((row) => row.day === day);
  return found ? found.strength_lift : STRENGTH_LIFTS;
}
