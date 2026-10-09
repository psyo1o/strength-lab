import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { IMPLEMENTED_STRENGTH_METHODS } from "../strength-methods";
import { TIME_DOMAIN_RANGES } from "../rules";
import {
  COACHING_STIMULI,
  EQUIPMENT,
  PRIMARY_TRAININGS,
  SECONDARY_TRAININGS,
  STIMULI,
  type DayIntent,
  type MonthDirection,
  type WeeklyIntentPlan,
} from "../types";
import { movementCatalog } from "./pieces";
import { unitGuide } from "./stage13/units";
import type { CoachAgentName } from "./models";

/**
 * One contract for every coach.
 * The prompt text, the response schema, and the parser all read these lists.
 * A model that invents a key or an enum fails here, not later as a silent week fallback.
 */

export const DURATION_PROFILES = ["30-45", "45-60", "60-75", "rest"] as const;
export const STRENGTH_LIFTS = ["squat", "ohp", "bench", "deadlift", "none"] as const;
export const BLOCK_PHASES = ["accumulation", "progression", "peak", "deload", "emphasis"] as const;
export const EMPHASIS = ["mixed", "olympic", "gymnastics", "aerobic", "long_conditioning"] as const;
export const RECOVERY_ROLES = ["train", "easy", "rest"] as const;
export const VOLUME_BANDS = ["low", "moderate", "high"] as const;
export const INTENSITY_PROFILES = ["light", "moderate", "heavy", "mixed"] as const;
export const INTENSITY_BANDS = ["light", "moderate", "heavy"] as const;
export const FATIGUE_TARGETS = ["low", "moderate", "high"] as const;
export const MOVEMENT_PATTERNS = ["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic", "mixed", "none"] as const;
export const WOD_FORMATS = ["amrap", "for_time", "emom", "intervals"] as const;
export const LOAD_ACTIONS = ["progress", "hold", "cut"] as const;
export const TARGET_EFFORTS = ["easy", "moderate", "hard"] as const;
export const RELATIVE_INTENSITIES = ["up", "same", "down"] as const;
export const HEAD_STATUSES = ["APPROVE", "APPROVE_WITH_NOTE", "REVISE"] as const;
export const REVISION_PRIORITIES = ["high", "medium", "low"] as const;
export const WEEK_ROLES = ["accumulation", "progression", "intensification", "deload", "absorb", "long_support", "peak", "emphasis"] as const;

/** Class window and conditioning piece are different clocks. Non-long pieces stay at or under 20 minutes. */
export const CLASS_WINDOW_MINUTES = 60;
export const WARMUP_MINUTES = 10;
export const STRENGTH_BLOCK_MINUTES = 15;
export const COOLDOWN_MINUTES = 5;
export const NON_LONG_CONDITIONING = { min: 8, max: 20 } as const;
export const LONG_CONDITIONING = { min: TIME_DOMAIN_RANGES.long.min, max: TIME_DOMAIN_RANGES.long.max } as const;

export type ResponseFormat =
  | { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } }
  | { type: "json_object" };

export const JSON_OBJECT: ResponseFormat = { type: "json_object" };

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function stringEnum(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: [...values] };
}

const TEXT = { type: "string" };

function schemaOf(name: string, schema: Record<string, unknown>): ResponseFormat {
  return { type: "json_schema", json_schema: { name, strict: true, schema } };
}

export function movementKeys(): readonly string[] {
  return movementCatalog().map((row) => row.key);
}

function enumLine(label: string, values: readonly string[]): string {
  return `${label}: ${values.join(" | ")}`;
}

export function durationRuleText(): string {
  return [
    `class_minutes is the class window, default ${CLASS_WINDOW_MINUTES}. It is not the conditioning clock.`,
    `A class can be warmup ${WARMUP_MINUTES} + strength ${STRENGTH_BLOCK_MINUTES} + conditioning + cooldown ${COOLDOWN_MINUTES}.`,
    "conditioning.duration_min is the piece length only. Do not return time_domain. The server stamps time_domain from duration_min.",
    `If secondary_training is not long_conditioning, duration_min is an integer from ${NON_LONG_CONDITIONING.min} to ${NON_LONG_CONDITIONING.max}.`,
    `If secondary_training is long_conditioning, duration_min is an integer from ${LONG_CONDITIONING.min} to ${LONG_CONDITIONING.max}.`,
  ].join(" ");
}

export function schemaBrief(agent: CoachAgentName): string {
  if (agent === "monthly") {
    return [
      "JSON object. Do not wrap it. Do not write workouts.",
      "Keys: block_goal, primary_adaptations, secondary_adaptations, strength_method, conditioning_emphasis, gymnastics_emphasis, olympic_emphasis, progression_strategy, volume_trend, intensity_trend, recovery_strategy, deload_strategy, benchmark_strategy, week_roles, fatigue_tolerance, variety_requirement.",
      "primary_adaptations and secondary_adaptations are arrays of strings.",
      `strength_method must repeat the month's current method. Catalog: ${IMPLEMENTED_STRENGTH_METHODS.join(" | ")}.`,
      "week_roles is an array of exactly 4 objects: week_index (1|2|3|4), role, note_ko.",
      enumLine("role", WEEK_ROLES),
      "fatigue_tolerance and variety_requirement are low | moderate | high.",
      "Korean for every *_ko field and for the strategy sentences.",
    ].join("\n");
  }
  if (agent === "weekly") {
    return [
      'JSON object. The day array key is "days". Do not use "seven_days" or "seven days".',
      "Exactly 7 objects, one for each day mon, tue, wed, thu, fri, sat, sun.",
      "Top-level keys: block_phase, emphasis, why_ko, focus, scheme_note, adjustment_ko, days.",
      enumLine("block_phase", BLOCK_PHASES),
      enumLine("emphasis", EMPHASIS),
      "Each day keys: day, primary_training, secondary_training, training_goal, stimulus, intensity_profile, volume_profile, duration_profile, fatigue_target, movement_pattern, progression_required, recovery_role, strength_lift, benchmark, notes_ko.",
      enumLine("day", DAY_ORDER),
      enumLine("primary_training", PRIMARY_TRAININGS),
      enumLine("secondary_training", SECONDARY_TRAININGS),
      enumLine("stimulus", COACHING_STIMULI),
      enumLine("intensity_profile", INTENSITY_PROFILES),
      enumLine("volume_profile", VOLUME_BANDS),
      enumLine("duration_profile", DURATION_PROFILES),
      enumLine("fatigue_target", FATIGUE_TARGETS),
      enumLine("movement_pattern", MOVEMENT_PATTERNS),
      "progression_required is a boolean, not a sentence. benchmark is a boolean.",
      enumLine("recovery_role", RECOVERY_ROLES),
      enumLine("strength_lift", STRENGTH_LIFTS),
      "duration_profile is the class window, not the conditioning clock. Do not name movements or sets.",
      "why_ko, focus, scheme_note, adjustment_ko, training_goal, and notes_ko are short Korean.",
    ].join("\n");
  }
  if (agent === "session") {
    const catalog = movementCatalog().map((row) => `${row.key}=${row.name_ko}`).join(", ");
    return [
      "JSON object for one day. Keys: day, warmup_ko, notes_ko, conditioning.",
      "conditioning keys: format, duration_min, stimulus, movements, equipment, volume, intensity.",
      "Do not return time_domain, kilograms, percentages, or sets.",
      enumLine("format", WOD_FORMATS),
      enumLine("stimulus", STIMULI),
      enumLine("volume", VOLUME_BANDS),
      enumLine("intensity", INTENSITY_BANDS),
      enumLine("equipment", EQUIPMENT),
      "movements is an array of {key, amount, name_ko}. 2 to 4 items, or 1 only when primary_training is aerobic and the day is not long.",
      "interval_work_sec and interval_rest_sec are integers only when format is intervals. Otherwise both are null.",
      "amount is the work quantity. duration_min is the piece cap. Do not put the clock in amount.",
      `movement.key must be one of: ${catalog}.`,
      "name_ko must be the catalog Korean name for that key.",
      unitGuide(),
      durationRuleText(),
      "warmup_ko and notes_ko are Korean.",
    ].join("\n");
  }
  if (agent === "load") {
    return [
      "JSON object. Key: decisions.",
      "decisions is an array. Each item: day, action, reason_ko, target_effort, relative_intensity.",
      enumLine("day", DAY_ORDER),
      enumLine("action", LOAD_ACTIONS),
      enumLine("target_effort", TARGET_EFFORTS),
      enumLine("relative_intensity", RELATIVE_INTENSITIES),
      "Do not return kilograms, percentages, sets, or reps. The server applies the method table.",
      "reason_ko is Korean.",
    ].join("\n");
  }
  if (agent === "variation_judge") {
    return [
      "JSON object. Keys: concern, note, intentional.",
      "concern is a boolean. True only for accidental monotony.",
      "intentional is a boolean. True when the repeat is progression, a benchmark, or skill practice.",
      "note is one short sentence.",
      "Do not return status, note_ko, or revisions. This is not a head review.",
    ].join("\n");
  }
  if (agent === "recovery_judge") {
    return [
      "JSON object. Keys: concern, note, risk.",
      "concern is a boolean.",
      "risk is low, high, or ambiguous.",
      "note is one short sentence.",
      "Do not return status, note_ko, or revisions. This is not a head review.",
    ].join("\n");
  }
  return [
    "JSON object. Keys: status, note_ko, revisions, adjustments.",
    enumLine("status", HEAD_STATUSES),
    "APPROVE means there is no coaching issue worth acting on. revisions and adjustments are empty.",
    "APPROVE_WITH_NOTE means a concern exists and fixing it is not worth the cost. revisions and adjustments are empty. Do not write a new workout.",
    "REVISE names a field change. It does not regenerate the week or the session. Put that change in adjustments.",
    "Similarity, a repeated movement, or a minor variation note is not by itself a REVISE. Do not promote a minor signal to high.",
    "Each revision: day, reason, correction_instruction, priority, constraints.",
    "Each adjustment: target, reason, priority, current_value, proposed_value, preserve, rationale, confidence.",
    "target is day.conditioning.intensity, day.conditioning.volume, day.conditioning.duration_min, or day.conditioning.format.",
    "priority is P0, P1, P2, or P3. preserve is an array of strings and includes weekly_strength_progression when the lift must stay.",
    enumLine("day", DAY_ORDER),
    enumLine("priority", REVISION_PRIORITIES),
    "correction_instruction is the required change for that day. constraints is a short limit the session coach must keep.",
    "reason, correction_instruction, constraints, and note_ko are Korean.",
  ].join("\n");
}

const weeklyDaySchema = strictObject(
  {
    day: stringEnum(DAY_ORDER),
    primary_training: stringEnum(PRIMARY_TRAININGS),
    secondary_training: stringEnum(SECONDARY_TRAININGS),
    training_goal: TEXT,
    stimulus: stringEnum(COACHING_STIMULI),
    intensity_profile: stringEnum(INTENSITY_PROFILES),
    volume_profile: stringEnum(VOLUME_BANDS),
    duration_profile: stringEnum(DURATION_PROFILES),
    fatigue_target: stringEnum(FATIGUE_TARGETS),
    movement_pattern: stringEnum(MOVEMENT_PATTERNS),
    progression_required: { type: "boolean" },
    recovery_role: stringEnum(RECOVERY_ROLES),
    strength_lift: stringEnum(STRENGTH_LIFTS),
    benchmark: { type: "boolean" },
    notes_ko: TEXT,
  },
  [
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
  ],
);

export function responseFormatFor(agent: CoachAgentName): ResponseFormat {
  if (agent === "monthly") {
    return schemaOf(
      "monthly_coach_plan",
      strictObject(
        {
          block_goal: TEXT,
          primary_adaptations: { type: "array", items: TEXT },
          secondary_adaptations: { type: "array", items: TEXT },
          strength_method: stringEnum(IMPLEMENTED_STRENGTH_METHODS),
          conditioning_emphasis: TEXT,
          gymnastics_emphasis: TEXT,
          olympic_emphasis: TEXT,
          progression_strategy: TEXT,
          volume_trend: TEXT,
          intensity_trend: TEXT,
          recovery_strategy: TEXT,
          deload_strategy: TEXT,
          benchmark_strategy: TEXT,
          fatigue_tolerance: stringEnum(FATIGUE_TARGETS),
          variety_requirement: stringEnum(FATIGUE_TARGETS),
          week_roles: {
            type: "array",
            items: strictObject(
              {
                week_index: { type: "integer", enum: [1, 2, 3, 4] },
                role: stringEnum(WEEK_ROLES),
                note_ko: TEXT,
              },
              ["week_index", "role", "note_ko"],
            ),
          },
        },
        [
          "block_goal",
          "primary_adaptations",
          "secondary_adaptations",
          "strength_method",
          "conditioning_emphasis",
          "gymnastics_emphasis",
          "olympic_emphasis",
          "progression_strategy",
          "volume_trend",
          "intensity_trend",
          "recovery_strategy",
          "deload_strategy",
          "benchmark_strategy",
          "fatigue_tolerance",
          "variety_requirement",
          "week_roles",
        ],
      ),
    );
  }
  if (agent === "weekly") {
    return schemaOf(
      "weekly_intent",
      strictObject(
        {
          block_phase: stringEnum(BLOCK_PHASES),
          emphasis: stringEnum(EMPHASIS),
          why_ko: TEXT,
          focus: TEXT,
          scheme_note: TEXT,
          adjustment_ko: TEXT,
          days: { type: "array", items: weeklyDaySchema },
        },
        ["block_phase", "emphasis", "why_ko", "focus", "scheme_note", "adjustment_ko", "days"],
      ),
    );
  }
  if (agent === "session") {
    const movement = strictObject(
      { key: stringEnum(movementKeys()), amount: TEXT, name_ko: TEXT },
      ["key", "amount", "name_ko"],
    );
    return schemaOf(
      "session_coach_day",
      strictObject(
        {
          day: stringEnum(DAY_ORDER),
          warmup_ko: TEXT,
          notes_ko: TEXT,
          conditioning: strictObject(
            {
              format: stringEnum(WOD_FORMATS),
              duration_min: { type: "integer", minimum: NON_LONG_CONDITIONING.min, maximum: LONG_CONDITIONING.max },
              stimulus: stringEnum(STIMULI),
              movements: { type: "array", items: movement },
              equipment: { type: "array", items: stringEnum(EQUIPMENT) },
              volume: stringEnum(VOLUME_BANDS),
              intensity: stringEnum(INTENSITY_BANDS),
              interval_work_sec: { type: ["integer", "null"] },
              interval_rest_sec: { type: ["integer", "null"] },
            },
            ["format", "duration_min", "stimulus", "movements", "equipment", "volume", "intensity", "interval_work_sec", "interval_rest_sec"],
          ),
        },
        ["day", "warmup_ko", "notes_ko", "conditioning"],
      ),
    );
  }
  if (agent === "variation_judge") {
    return schemaOf(
      "variation_judge",
      strictObject(
        {
          concern: { type: "boolean" },
          note: TEXT,
          intentional: { type: "boolean" },
        },
        ["concern", "note", "intentional"],
      ),
    );
  }
  if (agent === "recovery_judge") {
    return schemaOf(
      "recovery_judge",
      strictObject(
        {
          concern: { type: "boolean" },
          note: TEXT,
          risk: stringEnum(["low", "high", "ambiguous"]),
        },
        ["concern", "note", "risk"],
      ),
    );
  }
  if (agent === "load") {
    return schemaOf(
      "load_coach_decisions",
      strictObject(
        {
          decisions: {
            type: "array",
            items: strictObject(
              {
                day: stringEnum(DAY_ORDER),
                action: stringEnum(LOAD_ACTIONS),
                reason_ko: TEXT,
                target_effort: stringEnum(TARGET_EFFORTS),
                relative_intensity: stringEnum(RELATIVE_INTENSITIES),
              },
              ["day", "action", "reason_ko", "target_effort", "relative_intensity"],
            ),
          },
        },
        ["decisions"],
      ),
    );
  }
  return schemaOf(
    "head_coach_review",
    strictObject(
      {
        status: stringEnum(HEAD_STATUSES),
        note_ko: TEXT,
        revisions: {
          type: "array",
          items: strictObject(
            {
              day: stringEnum(DAY_ORDER),
              reason: TEXT,
              correction_instruction: TEXT,
              priority: stringEnum(REVISION_PRIORITIES),
              constraints: TEXT,
            },
            ["day", "reason", "correction_instruction", "priority", "constraints"],
          ),
        },
        adjustments: {
          type: "array",
          items: strictObject(
            {
              target: TEXT,
              reason: TEXT,
              priority: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
              current_value: TEXT,
              proposed_value: TEXT,
              preserve: { type: "array", items: TEXT },
              rationale: TEXT,
              confidence: { type: "number" },
            },
            ["target", "reason", "priority", "current_value", "proposed_value", "preserve", "rationale", "confidence"],
          ),
        },
      },
      ["status", "note_ko", "revisions", "adjustments"],
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function received(value: unknown): string {
  if (value === undefined) return "missing";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return text.length > 80 ? `${text.slice(0, 80)}…` : text;
  } catch {
    return "unprintable";
  }
}

function enumError(path: string, value: unknown, allowed: readonly string[]): string | null {
  if (typeof value === "string" && allowed.includes(value)) return null;
  return `${path}: received ${received(value)}; allowed: [${allowed.join(", ")}]`;
}

function hangul(value: unknown): boolean {
  return typeof value === "string" && /[\uac00-\ud7a3]/.test(value);
}

function textError(path: string, value: unknown, korean: boolean): string | null {
  if (typeof value !== "string" || !value.trim()) return `${path}: expected a non-empty string`;
  if (korean && !hangul(value)) return `${path}: expected Korean text`;
  return null;
}

export function weeklyIntentErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["expected a JSON object with key days"];
  const errors: string[] = [];
  if (!Array.isArray(value.days)) {
    const keys = Object.keys(value).join(", ") || "(none)";
    errors.push(`expected key "days" (array of 7). received keys: ${keys}`);
    return errors;
  }
  if (value.days.length !== 7) errors.push(`days: length ${value.days.length}, expected 7`);
  const phase = enumError("block_phase", value.block_phase, BLOCK_PHASES);
  const emphasis = enumError("emphasis", value.emphasis, EMPHASIS);
  if (phase) errors.push(phase);
  if (emphasis) errors.push(emphasis);
  for (const path of ["why_ko", "focus", "scheme_note", "adjustment_ko"] as const) {
    const issue = textError(path, value[path], true);
    if (issue) errors.push(issue);
  }
  const seen = new Set<string>();
  value.days.forEach((row, index) => {
    const prefix = `days[${index}]`;
    if (!isRecord(row)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    const checks: Array<[string, unknown, readonly string[]]> = [
      ["day", row.day, DAY_ORDER],
      ["primary_training", row.primary_training, PRIMARY_TRAININGS],
      ["secondary_training", row.secondary_training, SECONDARY_TRAININGS],
      ["stimulus", row.stimulus, COACHING_STIMULI],
      ["intensity_profile", row.intensity_profile, INTENSITY_PROFILES],
      ["volume_profile", row.volume_profile, VOLUME_BANDS],
      ["duration_profile", row.duration_profile, DURATION_PROFILES],
      ["fatigue_target", row.fatigue_target, FATIGUE_TARGETS],
      ["movement_pattern", row.movement_pattern, MOVEMENT_PATTERNS],
      ["recovery_role", row.recovery_role, RECOVERY_ROLES],
      ["strength_lift", row.strength_lift, STRENGTH_LIFTS],
    ];
    for (const [field, fieldValue, allowed] of checks) {
      const issue = enumError(`${prefix}.${field}`, fieldValue, allowed);
      if (issue) errors.push(issue);
    }
    if (typeof row.day === "string") {
      if (seen.has(row.day)) errors.push(`${prefix}.day: duplicate ${row.day}`);
      seen.add(row.day);
    }
    const goal = textError(`${prefix}.training_goal`, row.training_goal, true);
    const notes = textError(`${prefix}.notes_ko`, row.notes_ko, true);
    if (goal) errors.push(goal);
    if (notes) errors.push(notes);
    if (typeof row.progression_required !== "boolean") {
      errors.push(`${prefix}.progression_required: received ${received(row.progression_required)}; allowed: boolean true or false`);
    }
    if (typeof row.benchmark !== "boolean") {
      errors.push(`${prefix}.benchmark: received ${received(row.benchmark)}; allowed: boolean true or false`);
    }
  });
  for (const day of DAY_ORDER) {
    if (!seen.has(day)) errors.push(`days: missing ${day}`);
  }
  return errors;
}

export function monthlyPlanErrors(value: unknown, month: MonthDirection): string[] {
  if (!isRecord(value)) return ["expected a monthly plan object"];
  const errors: string[] = [];
  const method = month.strength_method || month.scheme;
  for (const path of [
    "block_goal",
    "conditioning_emphasis",
    "gymnastics_emphasis",
    "olympic_emphasis",
    "progression_strategy",
    "volume_trend",
    "intensity_trend",
    "recovery_strategy",
    "deload_strategy",
    "benchmark_strategy",
  ] as const) {
    const issue = textError(path, value[path], false);
    if (issue) errors.push(issue);
  }
  if (!Array.isArray(value.primary_adaptations) || value.primary_adaptations.length === 0) {
    errors.push("primary_adaptations: expected a non-empty array of strings");
  }
  if (!Array.isArray(value.secondary_adaptations)) errors.push("secondary_adaptations: expected an array");
  const methodError = enumError("strength_method", value.strength_method, IMPLEMENTED_STRENGTH_METHODS);
  if (methodError) errors.push(methodError);
  else if (value.strength_method !== method) {
    errors.push(`strength_method: received ${received(value.strength_method)}; this block is already ${method}. Do not switch methods.`);
  }
  const fatigue = enumError("fatigue_tolerance", value.fatigue_tolerance, FATIGUE_TARGETS);
  const variety = enumError("variety_requirement", value.variety_requirement, FATIGUE_TARGETS);
  if (fatigue) errors.push(fatigue);
  if (variety) errors.push(variety);
  if (!Array.isArray(value.week_roles) || value.week_roles.length !== 4) {
    errors.push("week_roles: expected 4 objects");
  } else {
    const weeks = new Set<number>();
    value.week_roles.forEach((row, index) => {
      if (!isRecord(row)) {
        errors.push(`week_roles[${index}]: expected an object`);
        return;
      }
      if (row.week_index !== 1 && row.week_index !== 2 && row.week_index !== 3 && row.week_index !== 4) {
        errors.push(`week_roles[${index}].week_index: received ${received(row.week_index)}; allowed: [1, 2, 3, 4]`);
      } else weeks.add(row.week_index);
      const role = enumError(`week_roles[${index}].role`, row.role, WEEK_ROLES);
      if (role) errors.push(role);
      const note = textError(`week_roles[${index}].note_ko`, row.note_ko, true);
      if (note) errors.push(note);
    });
    for (const week of [1, 2, 3, 4]) {
      if (!weeks.has(week)) errors.push(`week_roles: missing week_index ${week}`);
    }
  }
  return errors;
}

function durationErrors(intent: DayIntent, minutes: unknown): string[] {
  const longPiece = intent.secondary_training === "long_conditioning";
  const range = longPiece ? LONG_CONDITIONING : NON_LONG_CONDITIONING;
  if (typeof minutes !== "number" || !Number.isInteger(minutes)) {
    return [`conditioning.duration_min: received ${received(minutes)}; allowed: integer ${range.min}–${range.max}`];
  }
  if (minutes < range.min || minutes > range.max) {
    return [
      `conditioning.duration_min: received ${minutes}; allowed: ${range.min}–${range.max} because this day is ${longPiece ? "long_conditioning" : "not long_conditioning"}. class_minutes is not the piece length.`,
    ];
  }
  return [];
}

/** Interval clock is separate from movement amount. Other formats leave both fields null. */
export function intervalFieldErrors(piece: Record<string, unknown>): string[] {
  const work = piece.interval_work_sec;
  const rest = piece.interval_rest_sec;
  const present = work != null || rest != null;
  if (piece.format !== "intervals") {
    return present ? ["interval_work_sec and interval_rest_sec must be null unless format is intervals"] : [];
  }
  const errors: string[] = [];
  if (typeof work !== "number" || !Number.isInteger(work) || work < 10 || work > 90) {
    errors.push(`interval_work_sec: received ${received(work)}; allowed: integer 10–90 when format is intervals`);
  }
  if (typeof rest !== "number" || !Number.isInteger(rest) || rest < 10 || rest > 90) {
    errors.push(`interval_rest_sec: received ${received(rest)}; allowed: integer 10–90 when format is intervals`);
  }
  return errors;
}

export function sessionCoachErrors(value: unknown, intent: DayIntent): string[] {
  if (intent.primary_training === "rest" || intent.recovery_role === "rest") return ["rest days are not sent to the session coach"];
  if (!isRecord(value)) return ["expected a session object"];
  const errors: string[] = [];
  const day = enumError("day", value.day, DAY_ORDER);
  if (day) errors.push(day);
  else if (value.day !== intent.day) errors.push(`day: received ${received(value.day)}; this call is only for ${intent.day}`);
  const warmup = textError("warmup_ko", value.warmup_ko, true);
  const notes = textError("notes_ko", value.notes_ko, true);
  if (warmup) errors.push(warmup);
  if (notes) errors.push(notes);
  if (!isRecord(value.conditioning)) {
    errors.push("conditioning: expected an object");
    return errors;
  }
  const piece = value.conditioning;
  const format = enumError("conditioning.format", piece.format, WOD_FORMATS);
  const stimulus = enumError("conditioning.stimulus", piece.stimulus, STIMULI);
  const volume = enumError("conditioning.volume", piece.volume, VOLUME_BANDS);
  const intensity = enumError("conditioning.intensity", piece.intensity, INTENSITY_BANDS);
  if (format) errors.push(format);
  if (stimulus) errors.push(stimulus);
  if (volume) errors.push(volume);
  if (intensity) errors.push(intensity);
  errors.push(...durationErrors(intent, piece.duration_min));
  const aerobicMono = intent.primary_training === "aerobic" && intent.secondary_training !== "long_conditioning";
  const minMoves = aerobicMono ? 1 : 2;
  if (!Array.isArray(piece.movements)) {
    errors.push("conditioning.movements: expected an array of {key, amount, name_ko}");
  } else if (piece.movements.length < minMoves || piece.movements.length > 4) {
    errors.push(`conditioning.movements: length ${piece.movements.length}; allowed: ${minMoves}–4`);
  } else {
    const catalog = new Map(movementCatalog().map((row) => [row.key, row.name_ko]));
    piece.movements.forEach((row, index) => {
      const prefix = `conditioning.movements[${index}]`;
      if (!isRecord(row)) {
        errors.push(`${prefix}: expected {key, amount, name_ko}`);
        return;
      }
      const keyError = enumError(`${prefix}.key`, row.key, movementKeys());
      if (keyError) errors.push(keyError);
      else if (row.name_ko !== catalog.get(String(row.key))) {
        errors.push(`${prefix}.name_ko: received ${received(row.name_ko)}; catalog name for ${String(row.key)} is ${catalog.get(String(row.key))}`);
      }
      if (typeof row.amount !== "string" || !row.amount.trim() || /kg/i.test(row.amount)) {
        errors.push(`${prefix}.amount: received ${received(row.amount)}; reps are 12 or 12 reps, calories are 12cal or 12/10cal, distance is 500m. Never kilograms.`);
      }
    });
  }
  errors.push(...intervalFieldErrors(piece));
  if (!Array.isArray(piece.equipment) || piece.equipment.length === 0) {
    errors.push(`conditioning.equipment: expected a non-empty array; allowed: [${EQUIPMENT.join(", ")}]`);
  } else {
    piece.equipment.forEach((item, index) => {
      const issue = enumError(`conditioning.equipment[${index}]`, item, EQUIPMENT);
      if (issue) errors.push(issue);
    });
  }
  return errors;
}

export type LoadDecisionDraft = {
  day: DayKey;
  action: (typeof LOAD_ACTIONS)[number];
  reason_ko: string;
  target_effort: (typeof TARGET_EFFORTS)[number];
  relative_intensity: (typeof RELATIVE_INTENSITIES)[number];
};

export function loadDecisionErrors(value: unknown, days: readonly DayKey[]): string[] {
  if (!isRecord(value) || !Array.isArray(value.decisions)) return ['expected {"decisions":[...]}'];
  const errors: string[] = [];
  const seen = new Set<string>();
  value.decisions.forEach((row, index) => {
    const prefix = `decisions[${index}]`;
    if (!isRecord(row)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    const day = enumError(`${prefix}.day`, row.day, DAY_ORDER);
    const action = enumError(`${prefix}.action`, row.action, LOAD_ACTIONS);
    const effort = enumError(`${prefix}.target_effort`, row.target_effort, TARGET_EFFORTS);
    const intensity = enumError(`${prefix}.relative_intensity`, row.relative_intensity, RELATIVE_INTENSITIES);
    if (day) errors.push(day);
    if (action) errors.push(action);
    if (effort) errors.push(effort);
    if (intensity) errors.push(intensity);
    const reason = textError(`${prefix}.reason_ko`, row.reason_ko, true);
    if (reason) errors.push(reason);
    if (typeof row.day === "string") seen.add(row.day);
  });
  for (const day of days) {
    if (!seen.has(day)) errors.push(`decisions: missing ${day}`);
  }
  return errors;
}

export function headReviewErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["expected a head review object"];
  const errors: string[] = [];
  const status = enumError("status", value.status, HEAD_STATUSES);
  if (status) errors.push(status);
  const note = textError("note_ko", value.note_ko, true);
  if (note) errors.push(note);
  if (!Array.isArray(value.revisions)) {
    errors.push("revisions: expected an array");
    return errors;
  }
  if ((value.status === "APPROVE" || value.status === "APPROVE_WITH_NOTE") && value.revisions.length > 0) {
    errors.push("revisions: APPROVE and APPROVE_WITH_NOTE require an empty array");
  }
  if (value.status === "REVISE" && value.revisions.length === 0) {
    errors.push("revisions: REVISE requires at least one day");
  }
  if (Array.isArray(value.adjustments)) {
    if ((value.status === "APPROVE" || value.status === "APPROVE_WITH_NOTE") && value.adjustments.length > 0) {
      errors.push("adjustments: APPROVE and APPROVE_WITH_NOTE require an empty array");
    }
    value.adjustments.forEach((row, index) => {
      if (!isRecord(row)) {
        errors.push(`adjustments[${index}]: expected an object`);
        return;
      }
      if (typeof row.target !== "string" || !row.target.trim()) errors.push(`adjustments[${index}].target: expected text`);
      if (typeof row.proposed_value !== "string") errors.push(`adjustments[${index}].proposed_value: expected text`);
      if (!Array.isArray(row.preserve)) errors.push(`adjustments[${index}].preserve: expected an array`);
    });
  }
  value.revisions.forEach((row, index) => {
    const prefix = `revisions[${index}]`;
    if (!isRecord(row)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    const day = enumError(`${prefix}.day`, row.day, DAY_ORDER);
    const priority = enumError(`${prefix}.priority`, row.priority, REVISION_PRIORITIES);
    if (day) errors.push(day);
    if (priority) errors.push(priority);
    for (const field of ["reason", "correction_instruction", "constraints"] as const) {
      const issue = textError(`${prefix}.${field}`, row[field], true);
      if (issue) errors.push(issue);
    }
  });
  return errors;
}

export function contractMatchesWeeklyParser(plan: WeeklyIntentPlan): string[] {
  return weeklyIntentErrors({
    block_phase: plan.block_phase,
    emphasis: plan.emphasis,
    why_ko: plan.why_ko,
    focus: plan.focus,
    scheme_note: plan.scheme_note,
    adjustment_ko: plan.adjustment_ko,
    days: plan.days,
  });
}
