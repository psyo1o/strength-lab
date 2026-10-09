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

/**
 * Amount notation.
 * Reps are an integer, with or without the word reps: "12", "12 reps", "10reps".
 * A gender pair is not a rep scheme. "10/8" and "10/8reps" are rejected.
 * Calories are "12cal" or the gender pair "12/10cal" (men/women). That pair is calories, not reps.
 * Distance is "500m". Seconds are "30sec". Kilograms are never an amount.
 */
export function amountUnit(amount: string): AmountUnit | null {
  const text = amount.replace(/\s/g, "").toLowerCase();
  if (!text || text.includes("kg")) return null;
  if (/^\d+\/\d+cal$/.test(text) || /^\d+cal$/.test(text)) return "cal";
  if (/^\d+sec$/.test(text) || /^\d+초$/.test(text)) return "sec";
  if (/^\d+m$/.test(text)) return "m";
  if (/^\d+$/.test(text) || /^\d+reps$/.test(text)) return "reps";
  return null;
}

export function unitGuide(): string {
  const groups = new Map<string, string[]>();
  for (const [key, units] of Object.entries(MOVEMENT_UNITS)) {
    const label = units.join("/");
    const list = groups.get(label) ?? [];
    list.push(key);
    groups.set(label, list);
  }
  const lines = [...groups.entries()].map(([units, keys]) => `${units}: ${keys.join(", ")}`);
  return [
    "Amount notation. One unit. No kilograms.",
    "Reps: 12 or 12 reps or 10reps. Do not write a gender pair for reps.",
    "Calories: 12cal, or 12/10cal meaning men's calories / women's calories.",
    "Distance: 500m. Seconds: 30sec.",
    "Allowed units by movement.",
    ...lines,
    "Any other movement key uses reps.",
    "Amount is the work the athlete performs. duration_min is the piece cap.",
    "double_under 50 and double_under 30sec are both clear work. row 500m, row 15cal, and row 30sec are clear work.",
    "row 12reps is not a natural row prescription. Choose calories or metres that fit the piece. Do not invent a number by renaming the unit.",
    "A work bout in seconds has to fit inside duration_min. Do not invent calories or reps when the bout does not fit.",
    "Intervals may also put the repeating clock in interval_work_sec and interval_rest_sec. Those fields are the interval structure, not a replacement for a clear amount.",
    "Handstand amount may be seconds because the hold is the work.",
  ].join(" ");
}

export type PrescriptionStatus = "ok" | "revise" | "unclear";

export type PrescriptionVerdict = { status: "ok" } | { status: "revise" | "unclear"; message: string };

const CLEAR_WORK_CLOCK = new Set(["double_under", "row"]);

/**
 * Prescription check. Catalog unitError stays the technical unit list.
 * A clear work duration for double-under or row is performable even when that list omits seconds.
 */
export function prescriptionAmountIssue(key: string, amount: string, durationMin: number | null): PrescriptionVerdict {
  const catalog = unitError(key, amount);
  if (!catalog) return { status: "ok" };
  const parsed = parsedAmount(amount);
  if (CLEAR_WORK_CLOCK.has(key) && parsed.unit === "sec" && Number.isInteger(parsed.value) && parsed.value > 0) {
    if (durationMin != null && Number.isFinite(durationMin) && parsed.value > durationMin * 60) {
      return {
        status: "revise",
        message: `${key} amount ${amount} is longer than the ${durationMin} minute piece. The work bout has to fit the session. Do not invent calories or reps.`,
      };
    }
    return { status: "ok" };
  }
  if (key === "row" && parsed.unit === "reps") {
    return {
      status: "revise",
      message: `${catalog}. Row reps are not a natural row prescription. Choose calories or metres that fit this piece. Do not invent a specific number by only renaming the unit.`,
    };
  }
  if (!parsed.unit || !Object.prototype.hasOwnProperty.call(MOVEMENT_UNITS, key)) {
    return {
      status: "unclear",
      message: `${catalog}. The prescription is not clear enough to store as a different amount. Do not invent a work quantity.`,
    };
  }
  return {
    status: "revise",
    message: `${catalog}. ${amountRepairHint(key, amount)}`,
  };
}

/** Faster than a metcon sprint. Used only to see that a distance cannot fit the work interval. */
const SPRINT_METRES_PER_SEC = 6;

/**
 * Interval structure versus the amounts inside it.
 * A seconds bout that fills the work window leaves no room for another movement.
 * A distance past the sprint ceiling cannot be finished inside that window.
 */
export function intervalFitIssues(piece: {
  format?: unknown;
  interval_work_sec?: unknown;
  movements?: unknown;
}): string[] {
  if (piece.format !== "intervals") return [];
  const work = piece.interval_work_sec;
  if (typeof work !== "number" || !Number.isInteger(work) || work <= 0) return [];
  const rows = Array.isArray(piece.movements) ? piece.movements : [];
  const movements = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as { key?: unknown; amount?: unknown };
    if (typeof item.key !== "string" || typeof item.amount !== "string") return [];
    return [{ key: item.key, amount: item.amount }];
  });
  const errors: string[] = [];
  const filling = movements.find((movement) => {
    if (movement.key !== "double_under" && movement.key !== "row") return false;
    if (amountUnit(movement.amount) !== "sec") return false;
    return parsedAmount(movement.amount).value >= work;
  });
  if (filling && movements.length > 1) {
    errors.push(
      `${filling.key} amount ${filling.amount} fills the ${work} second work interval, so the other movements do not fit. Shorten that bout or lengthen interval_work_sec, and keep the required movement count. Do not invent a replacement amount.`,
    );
  }
  for (const movement of movements) {
    if (movement.key !== "row" && movement.key !== "ski" && movement.key !== "run") continue;
    if (amountUnit(movement.amount) !== "m") continue;
    const metres = parsedAmount(movement.amount).value;
    if (metres > work * SPRINT_METRES_PER_SEC) {
      errors.push(
        `${movement.key} amount ${movement.amount} does not fit a ${work} second work interval. Shorten the distance or lengthen the work interval. Do not invent calories.`,
      );
    }
  }
  return errors;
}

/** Retry text for a wrong amount. It names the movement, the value, and the allowed units. */
export function amountRepairHint(key: string, amount: string): string {
  const allowed = allowedUnits(key).join(", ");
  return `${key} amount ${amount} is the wrong field for that value. Allowed amount units: ${allowed}. Put a work/rest clock in interval_work_sec and interval_rest_sec only when format is intervals. Do not only rename the unit, and do not invent a calorie or rep count.`;
}

export function unitError(key: string, amount: string): string | null {
  const unit = amountUnit(amount);
  const allowed = allowedUnits(key);
  if (!unit) {
    return `${key} field conditioning.movements.amount received ${amount}; expected unit one of: ${allowed.join(", ")}`;
  }
  if (!allowed.includes(unit)) {
    return `${key} does not allow ${unit}; allowed: ${allowed.join(", ")}; field conditioning.movements.amount received ${amount}`;
  }
  return null;
}

export function parsedAmount(amount: string): { unit: AmountUnit | null; value: number } {
  const unit = amountUnit(amount);
  const match = amount.replace(/\s/g, "").match(/\d+/);
  return { unit, value: match ? Number(match[0]) : 0 };
}
