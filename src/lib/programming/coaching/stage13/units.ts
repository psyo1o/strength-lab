import type { Equipment } from "../../types";

/** Units a movement amount may use. The session unit validator reads this catalog and does not guess. */
export type AmountUnit = "reps" | "cal" | "m" | "sec";

const REPS = ["reps"] as const;
const CYCLIC = ["cal", "m"] as const;

/**
 * Allowed units per movement key.
 * Engine modalities can be calories or metres. Loaded and gymnastic skills stay on reps or seconds.
 * Kettlebell swings are reps. A calorie amount on that key is a unit error.
 */
export const MOVEMENT_UNITS: Record<string, readonly AmountUnit[]> = {
  row: CYCLIC,
  ski: CYCLIC,
  ski_erg: CYCLIC,
  fan_bike: ["cal"],
  bike: ["cal", "m"],
  assault_bike: ["cal"],
  echo_bike: ["cal"],
  run: ["m"],
  double_under: REPS,
  kb_swing: REPS,
  kettlebell: REPS,
  ring_row: REPS,
  pull_up: REPS,
  kipping_pull_up: REPS,
  push_up: REPS,
  sit_up: REPS,
  burpee: REPS,
  wall_ball: REPS,
  box_jump: REPS,
  db_press: REPS,
  power_clean: REPS,
  power_snatch: REPS,
  hang_power_clean: REPS,
  clean: REPS,
  snatch: REPS,
  thruster: REPS,
  deadlift: REPS,
  squat: REPS,
  front_squat: REPS,
  toes_to_bar: REPS,
  handstand: ["sec"],
  hspu: REPS,
  muscle_up: REPS,
  pistol: REPS,
  lunge: REPS,
  dip: REPS,
  ring_dip: REPS,
};

/** Gear a movement needs. Bodyweight skills have an empty list. */
export const MOVEMENT_EQUIPMENT: Record<string, Equipment | null> = {
  ring_row: "rings",
  pull_up: "pullup_bar",
  kipping_pull_up: "pullup_bar",
  toes_to_bar: "pullup_bar",
  muscle_up: "rings",
  ring_dip: "rings",
  db_press: "dumbbell",
  row: "rower",
  ski: "ski",
  ski_erg: "ski",
  fan_bike: "bike",
  bike: "bike",
  assault_bike: "bike",
  echo_bike: "bike",
  power_clean: "barbell",
  power_snatch: "barbell",
  hang_power_clean: "barbell",
  clean: "barbell",
  snatch: "barbell",
  deadlift: "barbell",
  squat: "barbell",
  front_squat: "barbell",
  thruster: "barbell",
  wall_ball: "wall_ball",
  box_jump: "box",
  kb_swing: "kettlebell",
  kettlebell: "kettlebell",
  double_under: "jump_rope",
  push_up: null,
  sit_up: null,
  burpee: null,
  handstand: null,
  hspu: null,
  pistol: null,
  lunge: null,
  dip: null,
  run: null,
};

export function allowedUnits(key: string): readonly AmountUnit[] {
  return MOVEMENT_UNITS[key] ?? REPS;
}

export function amountUnit(amount: string): AmountUnit | null {
  const text = amount.replace(/\s/g, "").toLowerCase();
  if (!text || /kg/.test(text)) return null;
  if (text.includes("cal")) return "cal";
  if (text.includes("초") || text.endsWith("sec")) return "sec";
  if (/^\d+m$/.test(text)) return "m";
  if (/^\d+$/.test(text)) return "reps";
  return null;
}

export function unitError(key: string, amount: string): string | null {
  const unit = amountUnit(amount);
  const allowed = allowedUnits(key);
  if (!unit) {
    return `${key} amount ${amount} has no allowed unit; allowed: ${allowed.join(", ")}`;
  }
  if (!allowed.includes(unit)) {
    return `${key} does not allow ${unit}; allowed: ${allowed.join(", ")}`;
  }
  return null;
}

export function parsedAmount(amount: string): { unit: AmountUnit | null; value: number } {
  const unit = amountUnit(amount);
  const match = amount.replace(/\s/g, "").match(/\d+/);
  return { unit, value: match ? Number(match[0]) : 0 };
}
