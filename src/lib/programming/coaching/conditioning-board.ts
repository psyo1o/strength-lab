import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { similarityScore } from "../rules";
import type {
  ConditioningSlot,
  DayIntent,
  MovementPattern,
  Stimulus,
  StoredStructure,
  TimeDomain,
  VolumeBand,
  WeekIndex,
  WodFormat,
} from "../types";
import { catalogGear, catalogMovement } from "./movement-catalog";

/** Normal class difficulty. Later intensity settings change this one value. */
export const SESSION_INTENSITY_LEVEL = 3;

const AMBIGUOUS_SQUAT_KEYS = ["squat", "pause_squat", "pin_squat"] as const;

type Modality = "mono" | "gym" | "lift";

function cell(input: {
  format: WodFormat;
  minutes: number;
  domain: TimeDomain;
  stimulus: Stimulus;
  pattern: MovementPattern;
  key: string;
  volume: VolumeBand;
  metcon: boolean;
  companions?: readonly string[];
  stretch?: boolean;
}): ConditioningSlot {
  const companions = input.companions ?? [];
  return {
    format: input.format,
    time_domain: input.domain,
    duration_min: input.minutes,
    stimulus: input.stimulus,
    movement_pattern: input.pattern,
    primary_key: input.key,
    volume: input.volume,
    metcon: input.metcon,
    movement_count: input.metcon ? Math.max(3, companions.length + 1) : 2,
    companions,
    stretch: input.stretch === true,
  };
}

/**
 * Four weeks of conditioning cells. Weekday placement is separate, so the row order is only the preferred order.
 * Same index across consecutive weeks differs on at least three similarity axes.
 */
export function monthConditioningBoard(): readonly (readonly ConditioningSlot[])[] {
  return [
    [
      cell({ format: "amrap", minutes: 12, domain: "short", stimulus: "high_rep", pattern: "gymnastic", key: "kipping_pull_up", volume: "moderate", metcon: true, companions: ["row_erg", "barbell_thruster", "box_jump"] }),
      cell({ format: "intervals", minutes: 10, domain: "short", stimulus: "heavy", pattern: "olympic", key: "power_clean", volume: "low", metcon: false, companions: ["hang_power_clean"] }),
      cell({ format: "for_time", minutes: 16, domain: "medium", stimulus: "technical", pattern: "engine", key: "row_erg", volume: "moderate", metcon: true, companions: ["wall_ball", "burpee", "double_under"] }),
      cell({ format: "chipper", minutes: 20, domain: "medium", stimulus: "high_rep", pattern: "squat", key: "wall_ball", volume: "high", metcon: true, stretch: true, companions: ["run", "kipping_pull_up", "barbell_thruster", "toes_to_bar"] }),
      cell({ format: "emom", minutes: 12, domain: "short", stimulus: "technical", pattern: "press", key: "push_jerk", volume: "low", metcon: false, companions: ["dumbbell_snatch"] }),
      cell({ format: "for_time", minutes: 14, domain: "medium", stimulus: "heavy", pattern: "gymnastic", key: "toes_to_bar", volume: "moderate", metcon: true, companions: ["assault_bike", "dumbbell_snatch"] }),
    ],
    [
      cell({ format: "for_time", minutes: 18, domain: "medium", stimulus: "heavy", pattern: "press", key: "barbell_thruster", volume: "moderate", metcon: true, companions: ["row_erg", "burpee", "box_jump"] }),
      cell({ format: "amrap", minutes: 12, domain: "short", stimulus: "high_rep", pattern: "gymnastic", key: "burpee", volume: "moderate", metcon: true, companions: ["double_under", "wall_ball", "box_jump"] }),
      cell({ format: "emom", minutes: 12, domain: "short", stimulus: "technical", pattern: "olympic", key: "squat_snatch", volume: "low", metcon: false, companions: ["double_under"] }),
      cell({ format: "amrap", minutes: 20, domain: "medium", stimulus: "high_rep", pattern: "engine", key: "assault_bike", volume: "high", metcon: true, stretch: true, companions: ["kipping_pull_up", "barbell_thruster", "box_jump"] }),
      cell({ format: "chipper", minutes: 16, domain: "medium", stimulus: "heavy", pattern: "hinge", key: "american_kettlebell_swing", volume: "moderate", metcon: true, companions: ["run", "burpee", "dumbbell_snatch"] }),
      cell({ format: "intervals", minutes: 10, domain: "short", stimulus: "technical", pattern: "gymnastic", key: "double_under", volume: "low", metcon: false, companions: ["push_up"] }),
    ],
    [
      cell({ format: "chipper", minutes: 20, domain: "medium", stimulus: "technical", pattern: "engine", key: "run", volume: "moderate", metcon: true, stretch: true, companions: ["pull_up", "power_clean", "box_jump", "double_under"] }),
      cell({ format: "emom", minutes: 10, domain: "short", stimulus: "heavy", pattern: "olympic", key: "hang_power_clean", volume: "low", metcon: false, companions: ["row_erg"] }),
      cell({ format: "amrap", minutes: 16, domain: "medium", stimulus: "high_rep", pattern: "gymnastic", key: "box_jump", volume: "moderate", metcon: true, companions: ["row_erg", "barbell_thruster", "burpee"] }),
      cell({ format: "intervals", minutes: 12, domain: "short", stimulus: "technical", pattern: "press", key: "push_jerk", volume: "low", metcon: false, companions: ["double_under"] }),
      cell({ format: "for_time", minutes: 15, domain: "medium", stimulus: "high_rep", pattern: "olympic", key: "dumbbell_snatch", volume: "moderate", metcon: true, companions: ["assault_bike", "toes_to_bar"] }),
      cell({ format: "for_time", minutes: 12, domain: "short", stimulus: "heavy", pattern: "gymnastic", key: "kipping_handstand_push_up", volume: "high", metcon: true, companions: ["row_erg", "sumo_deadlift_high_pull", "burpee"] }),
    ],
    [
      cell({ format: "emom", minutes: 16, domain: "medium", stimulus: "high_rep", pattern: "hinge", key: "sumo_deadlift_high_pull", volume: "moderate", metcon: true, companions: ["double_under", "burpee", "box_jump"] }),
      cell({ format: "for_time", minutes: 12, domain: "short", stimulus: "technical", pattern: "gymnastic", key: "kipping_pull_up", volume: "low", metcon: true, companions: ["assault_bike", "barbell_thruster"] }),
      cell({ format: "intervals", minutes: 10, domain: "short", stimulus: "heavy", pattern: "engine", key: "assault_bike", volume: "low", metcon: false, companions: ["push_up"] }),
      cell({ format: "chipper", minutes: 20, domain: "medium", stimulus: "high_rep", pattern: "squat", key: "wall_ball", volume: "high", metcon: true, stretch: true, companions: ["run", "toes_to_bar", "power_clean", "burpee"] }),
      cell({ format: "amrap", minutes: 12, domain: "short", stimulus: "technical", pattern: "olympic", key: "power_clean", volume: "low", metcon: false, companions: ["row_erg"] }),
      cell({ format: "amrap", minutes: 18, domain: "medium", stimulus: "heavy", pattern: "gymnastic", key: "toes_to_bar", volume: "moderate", metcon: true, companions: ["row_erg", "dumbbell_snatch", "box_jump"] }),
    ],
  ];
}

export function strengthConditioningBan(lift: string | null | undefined): readonly string[] {
  if (lift === "squat") return ["squat", "back_squat", "front_squat", "pause_squat", "pin_squat", "pause_back_squat", "pause_front_squat", "pin_back_squat"];
  if (lift === "bench") return ["bench_press", "floor_press", "close_grip_bench", "close_grip_bench_press", "incline_bench", "incline_bench_press"];
  if (lift === "deadlift") return ["deadlift", "romanian_deadlift"];
  if (lift === "ohp") return ["push_press", "ohp", "strict_press"];
  return [];
}

function modality(key: string): Modality | null {
  const category = catalogMovement(key)?.category ?? "";
  if (category === "monostructural") return "mono";
  if (category === "gymnastics") return "gym";
  if (category === "weightlifting" || category === "kettlebell" || category === "dumbbell") return "lift";
  return null;
}

function movementKey(row: unknown): string {
  if (!row || typeof row !== "object") return "";
  const item = row as { key?: unknown; movement?: unknown };
  if (typeof item.key === "string" && item.key) return item.key;
  if (typeof item.movement === "string") return item.movement;
  return "";
}

/** Reject a piece that misses the cell, uses an ambiguous squat, or repeats the day's strength lift. */
export function slotFitErrors(json: unknown, slot: ConditioningSlot, strengthLift: string | null | undefined): string[] {
  const body = json && typeof json === "object" ? (json as { conditioning?: { movements?: unknown } }).conditioning : null;
  const rows = Array.isArray(body?.movements) ? body.movements : [];
  const keys = rows.map(movementKey).filter(Boolean);
  const errors: string[] = [];
  const banned = new Set<string>([...AMBIGUOUS_SQUAT_KEYS, ...strengthConditioningBan(strengthLift)]);
  for (const key of keys) {
    if (banned.has(key)) errors.push(`conditioning movement ${key} is banned on this day`);
  }
  if (!keys.includes(slot.primary_key)) errors.push(`conditioning must include ${slot.primary_key}`);
  if (slot.metcon) {
    if (keys.length < 3 || keys.length > 5) errors.push(`metcon movements: length ${keys.length}; allowed: 3–5`);
    const seen = new Set(keys.map(modality).filter((value): value is Modality => value != null));
    if (!seen.has("mono") || !seen.has("gym") || !seen.has("lift")) {
      errors.push("metcon must mix monostructural, gymnastics, and weightlifting");
    }
  } else if (keys.length < 2 || keys.length > 4) {
    errors.push(`conditioning movements: length ${keys.length}; allowed: 2–4`);
  }
  return errors;
}

function realize(slot: ConditioningSlot, day: DayIntent): ConditioningSlot {
  if (day.secondary_training === "long_conditioning" && slot.stretch) {
    return { ...slot, duration_min: 32, time_domain: "long" };
  }
  return slot;
}

export function slotStructure(day: DayKey, slot: ConditioningSlot): StoredStructure {
  const gear = catalogGear(slot.primary_key);
  return {
    day,
    format: slot.format,
    time_domain: slot.time_domain,
    stimulus: slot.stimulus,
    movement_patterns: [slot.movement_pattern],
    movements: [],
    equipment: gear ? [gear] : [],
    rep_structure: slot.format,
    work_rest_structure: slot.format,
    duration_min: slot.duration_min,
    volume: slot.volume,
    intensity: "moderate",
    benchmark: false,
    long_conditioning: slot.time_domain === "long",
  };
}

function trainingTargets(days: readonly DayIntent[], lockedDays: readonly DayKey[]): DayIntent[] {
  const locked = new Set(lockedDays);
  return days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest" && !locked.has(day.day));
}

function fitRow(row: readonly ConditioningSlot[], days: readonly DayIntent[]): ConditioningSlot[] {
  const needsLong = days.some((day) => day.secondary_training === "long_conditioning");
  const cells = [...row];
  const droppable = (slot: ConditioningSlot) => !slot.metcon && !(needsLong && slot.stretch);
  while (cells.length > days.length) {
    const index = cells.findIndex(droppable);
    if (index < 0) break;
    cells.splice(index, 1);
  }
  while (cells.length > days.length) cells.pop();
  return cells;
}

function permutations(count: number): number[][] {
  const items = Array.from({ length: count }, (_, index) => index);
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    for (let index = 0; index < rest.length; index += 1) {
      walk([...prefix, rest[index]!], [...rest.slice(0, index), ...rest.slice(index + 1)]);
    }
  };
  walk([], items);
  return out;
}

function variants(weekIndex: WeekIndex, days: readonly DayIntent[]): ConditioningSlot[][] {
  const board = monthConditioningBoard();
  const ownIndex = weekIndex - 1;
  const own = fitRow(board[ownIndex] ?? board[0]!, days);
  const out: ConditioningSlot[][] = [own];
  board.forEach((row, index) => {
    if (index !== ownIndex) out.push(fitRow(row, days));
  });
  board.forEach((row, index) => {
    if (index === ownIndex) return;
    const other = fitRow(row, days);
    for (let cellIndex = 0; cellIndex < own.length; cellIndex += 1) {
      const swapped = other[cellIndex];
      if (!swapped) continue;
      out.push(own.map((slot, indexInRow) => (indexInRow === cellIndex ? swapped : slot)));
    }
  });
  return out;
}

function assignmentScore(
  days: readonly DayIntent[],
  cells: readonly ConditioningSlot[],
  perm: readonly number[],
  recent: readonly StoredStructure[],
): { assignment: Partial<Record<DayKey, ConditioningSlot>>; penalty: number } | null {
  const longIndex = days.findIndex((day) => day.secondary_training === "long_conditioning");
  if (longIndex >= 0 && !cells[perm[longIndex]!]?.stretch) return null;
  const assignment: Partial<Record<DayKey, ConditioningSlot>> = {};
  const structures: StoredStructure[] = [];
  let familyHits = 0;
  days.forEach((day, index) => {
    const slot = realize(cells[perm[index]!]!, day);
    assignment[day.day] = slot;
    if (strengthConditioningBan(day.strength_lift).includes(slot.primary_key)) familyHits += 1;
    structures.push(slotStructure(day.day, slot));
  });
  let stimulusHits = 0;
  let similarHits = 0;
  for (let index = 1; index < structures.length; index += 1) {
    if (structures[index]!.stimulus && structures[index]!.stimulus === structures[index - 1]!.stimulus) stimulusHits += 1;
  }
  for (let left = 0; left < structures.length; left += 1) {
    for (let right = left + 1; right < structures.length; right += 1) {
      if (similarityScore(structures[left]!, structures[right]!) >= 4) similarHits += 1;
    }
    const prior = recent.find((row) => row.day === structures[left]!.day && !row.benchmark);
    if (prior && similarityScore(structures[left]!, prior) >= 4) similarHits += 1;
  }
  return { assignment, penalty: stimulusHits * 100 + similarHits * 10 + familyHits };
}

/**
 * Put this week's cells on the training days.
 * Weekday swaps come first. A cell can also trade with another week's cell.
 * The best placement is kept even when a pair still scores 4. That does not reject the week.
 */
export function placeConditioningSlots(input: {
  weekIndex: WeekIndex;
  days: readonly DayIntent[];
  recent?: readonly StoredStructure[];
  lockedDays?: readonly DayKey[];
}): Partial<Record<DayKey, ConditioningSlot>> {
  const days = trainingTargets(input.days, input.lockedDays ?? []).sort(
    (left, right) => DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day),
  );
  if (!days.length) return {};
  const recent = input.recent ?? [];
  let best: { assignment: Partial<Record<DayKey, ConditioningSlot>>; penalty: number } | null = null;
  for (const cells of variants(input.weekIndex, days)) {
    if (cells.length !== days.length) continue;
    for (const perm of permutations(days.length)) {
      const scored = assignmentScore(days, cells, perm, recent);
      if (!scored) continue;
      if (!best || scored.penalty < best.penalty) best = scored;
      if (scored.penalty === 0) return scored.assignment;
    }
  }
  return best?.assignment ?? {};
}
