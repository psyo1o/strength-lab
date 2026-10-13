import type { DayKey } from "../../month-plan/types";
import type { MovementDraft, MovementPattern, SessionDraft, StoredStructure, VolumeBand, WodFormat } from "../types";
import { GOAL_TABLE_RULES } from "./goal-table";
import { zone2Durations, zone2Effort, zone2Modalities } from "./zone2";

export type ShortMetconFormat = (typeof GOAL_TABLE_RULES.zone2.shortMetcon.formats)[number];

export type Zone2Primary = {
  modality: string;
  duration_min: number;
  effort: string;
  hr: string;
};

export type Zone2Alternate = {
  kind: "short_metcon";
  format: ShortMetconFormat;
  duration_min: number;
  rpe: string;
  intensity: number;
  movements: MovementDraft[];
};

const SHORT = GOAL_TABLE_RULES.zone2.shortMetcon;

/** 숫자 강도가 고강도인지. 이름이나 형식은 보지 않는다. */
export function intensityIsHigh(value: number): boolean {
  return value >= GOAL_TABLE_RULES.highIntensity;
}

export function shortMetconDurations(deload: boolean): readonly number[] {
  return deload ? SHORT.duration.deload : SHORT.duration.normal;
}

export function shortMetconErrors(input: {
  deload: boolean;
  dropRun?: boolean;
  format?: string;
  duration?: number;
  rpe?: string;
  intensity?: number;
  ergo?: string;
  bodyweight?: string;
}): string[] {
  const errors: string[] = [];
  const banned = GOAL_TABLE_RULES.zone2.bannedOnLowerAdjacent;
  if (input.dropRun && input.ergo === banned) {
    errors.push(`short metcon ergo ${banned} is banned on a lower-adjacent day`);
  }
  const formats = SHORT.formats;
  if (!input.format || !(formats as readonly string[]).includes(input.format)) {
    errors.push(`short metcon format must be ${formats.join("|")}`);
  }
  const durations = shortMetconDurations(input.deload);
  if (input.duration == null || !durations.includes(input.duration as (typeof durations)[number])) {
    errors.push(`short metcon duration ${String(input.duration)} is outside ${durations.join("|")}`);
  }
  const rpe = SHORT.rpe;
  if (!input.rpe || !(rpe as readonly string[]).includes(input.rpe)) {
    errors.push(`short metcon rpe must be ${rpe.join("|")}`);
  }
  const intensity = SHORT.intensity;
  if (input.intensity == null || !intensity.includes(input.intensity as (typeof intensity)[number])) {
    errors.push(`short metcon intensity must be ${intensity.join("|")}`);
  } else if (intensityIsHigh(input.intensity)) {
    errors.push(`short metcon intensity ${input.intensity} is high`);
  }
  const ergo = input.dropRun ? SHORT.ergo.filter((key) => key !== (banned as string)) : SHORT.ergo;
  if (!input.ergo || !(ergo as readonly string[]).includes(input.ergo)) {
    errors.push(`short metcon ergo must be ${ergo.join("|")}`);
  }
  const body = SHORT.bodyweight;
  if (!input.bodyweight || !(body as readonly string[]).includes(input.bodyweight)) {
    errors.push(`short metcon bodyweight must be ${body.join("|")}`);
  }
  return errors;
}

export function zone2PrimaryErrors(input: {
  deload: boolean;
  previousModality?: string | null;
  dropRun?: boolean;
  modality?: string;
  duration?: number;
  effort?: string;
  hr?: string;
}): string[] {
  const errors: string[] = [];
  const modalities = zone2Modalities(input.previousModality, { dropRun: input.dropRun });
  if (!input.modality || !modalities.includes(input.modality)) {
    errors.push(`zone2 modality must be one of ${modalities.join("|")}`);
  }
  const durations = zone2Durations("day", input.deload);
  if (input.duration == null || !durations.includes(input.duration as (typeof durations)[number])) {
    errors.push(`zone2 duration ${String(input.duration)} is outside ${durations.join("|")}`);
  }
  const effort = zone2Effort(input.deload);
  if (!input.effort || !(effort as readonly string[]).includes(input.effort)) {
    errors.push(`zone2 effort must be ${effort.join("|")}`);
  }
  const hr = GOAL_TABLE_RULES.zone2.hr;
  if (!input.hr || !(hr as readonly string[]).includes(input.hr)) {
    errors.push(`zone2 hr must be ${hr.join("|")}`);
  }
  return errors;
}

function patternOf(key: string | undefined): MovementPattern {
  if (!key) return "engine";
  if ((SHORT.ergo as readonly string[]).includes(key)) return "engine";
  if ((GOAL_TABLE_RULES.zone2.modalities as readonly string[]).includes(key)) return "engine";
  return "gymnastic";
}

function countPatterns(keys: readonly string[]): Map<MovementPattern, number> {
  const counts = new Map<MovementPattern, number>();
  for (const key of keys) {
    const pattern = patternOf(key);
    counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
  }
  return counts;
}

/** 패턴마다 더 많은 쪽. 두 안의 횟수를 더하지 않는다. */
export function heavierPatternCounts(primaryKeys: readonly string[], alternateKeys: readonly string[]): Map<MovementPattern, number> {
  const left = countPatterns(primaryKeys);
  const right = countPatterns(alternateKeys);
  const out = new Map<MovementPattern, number>();
  for (const pattern of new Set([...left.keys(), ...right.keys()])) {
    out.set(pattern, Math.max(left.get(pattern) ?? 0, right.get(pattern) ?? 0));
  }
  return out;
}

/** A의 저강도 상한은 2다. B는 기록된 숫자다. 둘 중 큰 값이 그 날의 강도다. */
export function heavierZone2Intensity(primaryTop: number, alternateIntensity: number | null | undefined): number {
  return Math.max(primaryTop, alternateIntensity ?? 0);
}

export function zone2DayIsHigh(alternateIntensity: number | null | undefined): boolean {
  return intensityIsHigh(heavierZone2Intensity(2, alternateIntensity));
}

function bandFor(intensity: number): "light" | "moderate" | "heavy" {
  if (intensityIsHigh(intensity)) return "heavy";
  if (intensity <= 2) return "light";
  return "moderate";
}

function structureOf(input: {
  day: DayKey;
  format: WodFormat;
  duration: number;
  intensity: number;
  keys: readonly string[];
  label: string;
}): StoredStructure {
  const movements: MovementDraft[] = input.keys.map((key) => ({ key, amount: input.label, name_ko: key }));
  return {
    day: input.day,
    format: input.format,
    time_domain: input.duration >= 30 ? "long" : input.duration >= 16 ? "medium" : "short",
    stimulus: null,
    movement_patterns: [...new Set(input.keys.map((key) => patternOf(key)))],
    movements,
    equipment: [],
    rep_structure: input.label,
    work_rest_structure: input.label,
    duration_min: input.duration,
    volume: (input.duration >= 30 ? "moderate" : "low") as VolumeBand,
    intensity: bandFor(input.intensity),
    benchmark: false,
    long_conditioning: false,
  };
}

/** 같은 칸의 A·B. 서로 비교하지 않고, 다른 날과의 점수만 더 높은 쪽을 쓴다. */
export function zone2OptionStructures(session: SessionDraft): StoredStructure[] {
  const zone = session.zone2;
  if (!zone || zone.form === "addon") return [];
  const primary = structureOf({
    day: session.day,
    format: "intervals",
    duration: zone.duration_min,
    intensity: 2,
    keys: [zone.modality],
    label: "zone2",
  });
  const alternate = zone.alternate;
  if (!alternate) return [primary];
  return [
    primary,
    structureOf({
      day: session.day,
      format: alternate.format,
      duration: alternate.duration_min,
      intensity: alternate.intensity,
      keys: alternate.movements.map((movement) => movement.key),
      label: "short_metcon",
    }),
  ];
}

/** 두 구조 점수 중 큰 값. 합이 아니다. */
export function heavierScore(left: number, right: number): number {
  return Math.max(left, right);
}

export function emptyZone2Actuals(): {
  performed_option: null;
  completion_status: null;
  actual_duration_min: null;
  actual_rpe: null;
} {
  return {
    performed_option: null,
    completion_status: null,
    actual_duration_min: null,
    actual_rpe: null,
  };
}
