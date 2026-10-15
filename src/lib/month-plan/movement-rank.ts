import type { ConditioningDraft, Equipment, Stimulus } from "../programming/types";
import { catalogKeysFor } from "./pieces";
import { patternOfKey } from "./pattern-keys";
import {
  isMetconStimulus,
  type MetconPattern,
  type MetconStimulus,
  type MovementChoice,
  type PieceFormat,
  type PlannedDay,
} from "./types";

const RECOMMEND_SCORE = 4;
/** Placeholders and isolation accessories. The pattern bucket calls them gymnastic, but they are not WOD swaps. They stay in the full list. */
const NOT_A_SWAP = new Set(["free_accessory", "rehab_target", "curl", "barbell_row", "tricep_ext", "face_pull"]);

const PATTERNS: readonly MetconPattern[] = ["squat", "press", "hinge", "olympic", "engine", "gymnastic"];

/** Variants of lifts the pattern buckets already name. They do not change ban detection. */
const EXTRA_PATTERN: Record<string, MetconPattern> = {
  pause_squat: "squat",
  pin_squat: "squat",
  deficit_deadlift: "hinge",
  stiff_leg_deadlift: "hinge",
  back_extension: "hinge",
  squat_snatch: "olympic",
  squat_clean: "olympic",
  power_jerk: "olympic",
  push_jerk: "olympic",
  jerk: "olympic",
  split_jerk: "olympic",
  muscle_snatch: "olympic",
  snatch_pull: "olympic",
  clean_pull: "olympic",
  ohp: "press",
  floor_press: "press",
  incline_bench: "press",
  close_grip_bench: "press",
  spoto_press: "press",
};

const BARBELL = new Set([
  "squat",
  "bench",
  "deadlift",
  "ohp",
  "front_squat",
  "thruster",
  "clean",
  "snatch",
  "clean_jerk",
  "jerk",
  "split_jerk",
  "push_jerk",
  "power_jerk",
  "power_clean",
  "power_snatch",
  "hang_power_clean",
  "squat_clean",
  "squat_snatch",
  "muscle_snatch",
  "snatch_pull",
  "clean_pull",
  "ohs",
  "push_press",
  "sdhp",
  "pause_squat",
  "pin_squat",
  "deficit_deadlift",
  "stiff_leg_deadlift",
  "rdl",
  "barbell_row",
  "floor_press",
  "incline_bench",
  "close_grip_bench",
  "spoto_press",
  "curl",
]);

const STIMULUS_KO: Record<Stimulus, MetconStimulus> = {
  heavy: "고중량",
  high_rep: "고반복",
  technical: "기술",
};

export type WodIntent = {
  patterns: MetconPattern[];
  stimulus: MetconStimulus | null;
  equipment: Equipment[];
  format: PieceFormat | null;
  longPiece: boolean;
};

function isPattern(value: unknown): value is MetconPattern {
  return typeof value === "string" && (PATTERNS as readonly string[]).includes(value);
}

function isFormat(value: unknown): value is PieceFormat {
  return value === "amrap" || value === "for_time" || value === "emom" || value === "intervals";
}

export function recommendPattern(key: string): MetconPattern {
  return EXTRA_PATTERN[key] ?? patternOfKey(key);
}

export function equipmentOf(key: string): Equipment {
  if (BARBELL.has(key)) return "barbell";
  if (key === "wall_ball") return "wall_ball";
  if (key === "kb_swing" || key === "kettlebell") return "kettlebell";
  if (key === "box_jump") return "box";
  if (key === "row") return "rower";
  if (key === "ski" || key === "ski_erg") return "ski";
  if (key === "fan_bike" || key === "bike" || key === "assault_bike" || key === "echo_bike") return "bike";
  if (key === "double_under") return "jump_rope";
  if (key === "ring_row" || key === "ring_dip") return "rings";
  if (key === "pull_up" || key === "chin_up" || key === "kipping_pull_up" || key === "butterfly_pull_up" || key === "toes_to_bar" || key === "hanging_leg_raise") {
    return "pullup_bar";
  }
  return "bodyweight";
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function patternFromMovementKeys(keys: string[]): MetconPattern | null {
  if (keys.length === 0) return null;
  const tags = unique(keys.map((key) => patternOfKey(key)));
  if (tags.length === 1) return tags[0] ?? null;
  if (tags.includes("engine")) return "engine";
  return tags[0] ?? null;
}

export function intentFromDay(day: PlannedDay | null | undefined): WodIntent | null {
  const piece = day?.piece;
  if (!piece) return null;
  const primary = isPattern(piece.pattern) ? piece.pattern : patternFromMovementKeys(piece.movements.map((movement) => movement.key));
  if (!primary) return null;
  return {
    patterns: [primary],
    stimulus: isMetconStimulus(piece.stimulus) ? piece.stimulus : null,
    equipment: unique(piece.movements.map((movement) => equipmentOf(movement.key))),
    format: isFormat(piece.format) ? piece.format : null,
    longPiece: Boolean(day?.longPiece),
  };
}

export function intentFromConditioning(conditioning: ConditioningDraft | null | undefined): WodIntent | null {
  if (!conditioning) return null;
  const patterns = conditioning.movement_patterns.filter(isPattern);
  if (patterns.length === 0) return null;
  return {
    patterns,
    stimulus: conditioning.stimulus ? STIMULUS_KO[conditioning.stimulus] : null,
    equipment: conditioning.equipment.filter((item): item is Equipment => typeof item === "string"),
    format: isFormat(conditioning.format) ? conditioning.format : null,
    longPiece: conditioning.long_conditioning,
  };
}

/** The piece on screen is the intent. A stored draft is used only when that piece has no pattern. */
export function intentForEditor(day: PlannedDay | null | undefined, conditioning?: ConditioningDraft | null): WodIntent | null {
  return intentFromDay(day) ?? intentFromConditioning(conditioning);
}

function skillKey(key: string, pattern: MetconPattern): boolean {
  return (
    pattern === "olympic" ||
    key === "double_under" ||
    key === "handstand" ||
    key === "pistol" ||
    key === "kipping_pull_up" ||
    key === "butterfly_pull_up" ||
    key === "toes_to_bar"
  );
}

function stimulusScore(key: string, pattern: MetconPattern, stimulus: MetconStimulus | null): number {
  if (!stimulus) return 0;
  const equipment = equipmentOf(key);
  const strength = pattern === "squat" || pattern === "hinge" || pattern === "olympic" || pattern === "press";
  const loaded = strength && (equipment === "barbell" || equipment === "kettlebell" || equipment === "wall_ball" || key === "thruster");
  const skill = skillKey(key, pattern);
  if (stimulus === "고중량") {
    if (loaded && !skill) return 2;
    if (skill && pattern !== "olympic") return -1;
    return 0;
  }
  if (stimulus === "기술") return skill ? 2 : 0;
  if (stimulus === "고반복") {
    if ((pattern === "gymnastic" || key === "air_squat" || key === "burpee") && equipment !== "barbell") return 2;
    if (loaded) return -1;
    return 0;
  }
  return 0;
}

function equipmentScore(key: string, equipment: Equipment[]): number {
  const own = equipmentOf(key);
  if (own === "bodyweight") return equipment.length === 1 && equipment[0] === "bodyweight" ? 1 : 0;
  return equipment.includes(own) ? 2 : 0;
}

function scoreKey(key: string, intent: WodIntent, companions: Set<string>): number {
  if (NOT_A_SWAP.has(key)) return 0;
  const pattern = recommendPattern(key);
  let score = 0;
  if (intent.patterns.includes(pattern)) score += 4;
  if (companions.has(key)) score += 4;
  score += equipmentScore(key, intent.equipment);
  score += stimulusScore(key, pattern, intent.stimulus);
  if (intent.longPiece && pattern === "engine") score += 1;
  if (intent.format === "intervals" && (equipmentOf(key) === "bike" || equipmentOf(key) === "ski" || equipmentOf(key) === "rower")) {
    score += 2;
  }
  return score;
}

/** Recommended rows first. No intent, or nothing clears the bar, leaves the full alphabetical list. */
export function rankMovementChoices(choices: MovementChoice[], intent: WodIntent | null): MovementChoice[] {
  if (!intent || intent.patterns.length === 0) {
    return choices.map((choice) => ({ ...choice, recommended: false }));
  }
  const companions = new Set(intent.patterns.flatMap((pattern) => catalogKeysFor(pattern, intent.stimulus)));
  const scored = choices.map((choice) => ({ choice, score: scoreKey(choice.key, intent, companions) }));
  const recommended = scored.filter((row) => row.score >= RECOMMEND_SCORE);
  if (recommended.length === 0) return choices.map((choice) => ({ ...choice, recommended: false }));
  recommended.sort((a, b) => b.score - a.score || a.choice.nameKo.localeCompare(b.choice.nameKo, "ko") || a.choice.key.localeCompare(b.choice.key));
  const rest = scored.filter((row) => row.score < RECOMMEND_SCORE);
  return [
    ...recommended.map((row) => ({ ...row.choice, recommended: true })),
    ...rest.map((row) => ({ ...row.choice, recommended: false })),
  ];
}
