import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import type { WeekSkeleton } from "../direction/contract";
import { COACHING_STIMULI, PRIMARY_TRAININGS, SECONDARY_TRAININGS } from "../types";
import {
  BLOCK_PHASES,
  DURATION_PROFILES,
  EMPHASIS,
  FATIGUE_TARGETS,
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
  intensity_band: "4-5" | "1-3";
  intensity_profile: readonly string[];
  strength_lift: readonly string[];
  /** 그 요일이 squat 또는 deadlift를 낼 수 있으면 1. 주 합계가 max_lower_lifts를 넘지 않는다. */
  lower_lift_cap: 0 | 1;
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

/**
 * 요일별 intensity_profile·strength_lift enum.
 * 하체 리프트는 주 합계 규칙(max_lower_lifts)이라, 뼈대 슬롯 후보를 요일 순으로 나눠 상한의 합이 그 수를 넘지 않게 한다.
 */
export function dayBoundsFromSkeleton(skeleton: WeekSkeleton | null, maxLowerLifts: number): DayBound[] | null {
  if (!skeleton || skeleton.days.length === 0) return null;
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
      heavy,
      intensity_band: heavy ? "4-5" : "1-3",
      intensity_profile: heavy ? HEAVY_PROFILE : LOW_PROFILE,
      strength_lift: liftEnum(kind, cap, rest),
      lower_lift_cap: cap,
    };
  });
}

export function lowerLiftCapSum(bounds: readonly DayBound[]): number {
  return bounds.reduce((sum, day) => sum + day.lower_lift_cap, 0);
}

export function weekBoundsNote(bounds: readonly DayBound[]): string {
  const lines = bounds.map(
    (day) =>
      `${day.day} heavy=${day.heavy} intensity_band=${day.intensity_band} intensity_profile=${day.intensity_profile.join("|")} strength_lift=${day.strength_lift.join("|")} lower_lift_cap=${day.lower_lift_cap}`,
  );
  return ["Per-day enums are closed. Do not use a value outside that day.", ...lines].join("\n");
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
      primary_training: enumOf(PRIMARY_TRAININGS),
      secondary_training: enumOf(SECONDARY_TRAININGS),
      training_goal: { type: "string" },
      stimulus: enumOf(COACHING_STIMULI),
      intensity_profile: enumOf(bound.intensity_profile),
      volume_profile: enumOf(VOLUME_BANDS),
      duration_profile: enumOf(DURATION_PROFILES),
      fatigue_target: enumOf(FATIGUE_TARGETS),
      movement_pattern: enumOf(MOVEMENT_PATTERNS),
      progression_required: { type: "boolean" },
      recovery_role: enumOf(RECOVERY_ROLES),
      strength_lift: enumOf(bound.strength_lift),
      benchmark: { type: "boolean" },
      notes_ko: { type: "string" },
    },
    [...DAY_FIELDS],
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
