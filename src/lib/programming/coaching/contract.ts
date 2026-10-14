import { DAY_ORDER, type DayKey } from "../../month-plan/types";
import { IMPLEMENTED_STRENGTH_METHODS } from "../strength-methods";
import { TIME_DOMAIN_RANGES } from "../rules";
import {
  BODY_REGIONS,
  COACHING_STIMULI,
  ENERGY_SYSTEMS,
  PRIMARY_TRAININGS,
  SECONDARY_TRAININGS,
  SESSION_FOCUSES,
  STIMULI,
  type DayIntent,
  type MonthDirection,
  type WeeklyIntentPlan,
} from "../types";
import { movementCatalog } from "./pieces";
import { catalogMovement, catalogUnits, cellEditErrors, checkCellEdit, rxLoadErrors, standardCatalogKeys } from "./movement-catalog";
import { quantityOptions } from "./slot-choices";
import { unitGuide } from "./stage13/units";
import type { CoachAgentName } from "./models";

/**
 * One contract for every coach.
 * The prompt text, the response schema, and the parser all read these lists.
 * A model that invents a key or an enum fails here, not later as a silent week fallback.
 */

export const DURATION_PROFILES = ["30-45", "45-60", "60-75", "90-110", "rest"] as const;
export const STRENGTH_LIFTS = ["squat", "ohp", "bench", "deadlift", "none"] as const;
export const BLOCK_PHASES = ["accumulation", "progression", "peak", "deload", "emphasis"] as const;
export const EMPHASIS = ["mixed", "olympic", "gymnastics", "aerobic", "long_conditioning"] as const;
export const RECOVERY_ROLES = ["train", "easy", "rest"] as const;
export const VOLUME_BANDS = ["low", "moderate", "high"] as const;
export const INTENSITY_PROFILES = ["light", "moderate", "heavy", "mixed"] as const;
export const INTENSITY_BANDS = ["light", "moderate", "heavy"] as const;
export const FATIGUE_TARGETS = ["low", "moderate", "high"] as const;
export const MOVEMENT_PATTERNS = ["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic", "mixed", "none"] as const;
export const WOD_FORMATS = ["amrap", "for_time", "emom", "intervals", "chipper", "partner"] as const;
export const LOAD_ACTIONS = ["progress", "hold", "cut"] as const;
export const TARGET_EFFORTS = ["easy", "moderate", "hard"] as const;
export const RELATIVE_INTENSITIES = ["up", "same", "down"] as const;
export const HEAD_STATUSES = ["APPROVE", "APPROVE_WITH_NOTE", "REVISE", "BLOCK"] as const;
export const REVISION_PRIORITIES = ["high", "medium", "low"] as const;
export const EDIT_ACTIONS = ["replace", "change_amount", "delete", "add"] as const;
export const EDIT_BLOCKS = ["strength", "conditioning", "warmup"] as const;
export const EDIT_UNITS = ["reps", "cal", "m", "sec"] as const;
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
const NOTE_KO = { type: "string", minLength: 10 };

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
      "JSON object. Key: days. Do not wrap it. Do not write sets or amounts.",
      "days is an object. Each key is w{week}_{day}, such as w1_mon. A training day has choice, purpose_kind, and emphasis. choice is one id from that date's candidate list. purpose_kind and emphasis are ids. A rest day has purpose_kind rest and emphasis off.",
      "Week roles, rest days, time_domain, and long-conditioning days are fixed in the user message. Do not invent a tuple.",
      "Do not write a purpose sentence. The server writes it from the ids.",
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
      "duration_profile is the class window, not the conditioning clock. Do not name movements or sets. Rest days, strength_lift, and long_conditioning follow week_goal.",
      "why_ko, focus, scheme_note, adjustment_ko, training_goal, and notes_ko are English explanations. Display translation is later.",
    ].join("\n");
  }
  if (agent === "session") {
    const catalog = movementCatalog().map((row) => `${row.key}=${row.name_ko}`).join(", ");
    return [
      "JSON object for one day. Keys: day, warmup_ko, notes_ko, conditioning.",
      "conditioning keys: format, duration_min, stimulus, movements, volume, intensity.",
      "Do not return time_domain, kilograms, percentages, sets, or equipment. The server fills equipment from the movement catalog.",
      enumLine("format", WOD_FORMATS),
      enumLine("stimulus", STIMULI),
      enumLine("volume", VOLUME_BANDS),
      enumLine("intensity", INTENSITY_BANDS),
      "movements is an array of {key, amount, name_ko}. 2 to 5 items, or 1 only when primary_training is aerobic and the day is not long. A metcon slot uses 3 to 5.",
      "interval_work_sec and interval_rest_sec are integers only when format is intervals. Otherwise both are null.",
      "amount is the work. duration_min is the piece cap. double_under 30sec and row 30sec are clear work durations. row 12reps is not a natural row amount.",
      `movement.key must be one of: ${catalog}.`,
      "name_ko must be the catalog Korean name for that key.",
      unitGuide(),
      durationRuleText(),
      "warmup_ko and notes_ko are English explanations. Display translation is later.",
    ].join("\n");
  }
  if (agent === "strength") {
    return ["JSON object. Each slot key is s0. The value is slot, movement_id, and quantity_option.", "quantity_option is method. Do not return sets, kilograms, units, or a display sentence. The server writes strength_note_ko from the method table."].join("\n");
  }
  if (agent === "conditioning") {
    return [
      "JSON object. Each slot key is s0, s1, and so on. The value is slot, movement_id, and quantity_option.",
      "movement_id and quantity_option must be one of that slot's ids. Do not write units, loads, kilograms, or a display sentence.",
      "The server fills notes_ko, the unit, and Rx from the catalog.",
    ].join("\n");
  }
  if (agent === "warmup") {
    return ["JSON object. The slot key is s0. The value is slot, movement_id, and quantity_option.", "Do not write a unit or a display sentence. The server writes warmup_ko from the catalog."].join("\n");
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
      "reason_ko is an English explanation. Display translation is later.",
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
    "JSON object. Keys in order: note_ko, status, revisions, adjustments.",
    "note_ko is required and at least 10 characters. It comes before revisions and adjustments. When revisions are empty, note_ko is the approval reason. An empty note_ko is a schema failure.",
    enumLine("status", HEAD_STATUSES),
    "APPROVE means there is no coaching issue worth acting on. revisions and adjustments are empty. APPROVE cannot override a hard validation error.",
    "APPROVE_WITH_NOTE means a concern exists and fixing it is not worth the cost. revisions and adjustments are empty. Do not write a new workout. It does not ignore a hard validation error.",
    "REVISE is a catalog cell list. It does not regenerate the week. value must be a different id in that cell's enum. An adjustment is not a cell edit. A prose sentence is not a revision. If no different id exists, status is APPROVE_WITH_NOTE and revisions are empty.",
    "BLOCK only when a cell cannot fix the week: a safety risk, a collapsed week structure, or a training day with no session. Do not BLOCK for wording, explanations, or language. revisions and adjustments are empty.",
    "Similarity, a repeated movement, or a minor variation note is not by itself a REVISE. Do not promote a minor signal to high.",
    "Each revision names one cell: day, block, catalog_key, field, value, reason. The server writes only that cell.",
    "block is strength, conditioning, or warmup. field is movement_id or quantity_option.",
    "value is one id from that cell's enum. Do not write a unit, a load, or a free amount.",
    "reason is an English explanation. Display translation is later. A revision without these fields is a schema error.",
    enumLine("catalog_key", standardCatalogKeys()),
    "Each adjustment: target, reason, priority, current_value, proposed_value, preserve, rationale, confidence.",
    "target is day.conditioning.intensity, day.conditioning.volume, day.conditioning.duration_min, or day.conditioning.format.",
    "priority is P0, P1, P2, or P3. preserve is an array of strings and includes weekly_strength_progression when the lift must stay.",
    enumLine("day", DAY_ORDER),
    "reason and note_ko are English explanations. Display translation is later.",
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

function movementUnitGroups(keys: readonly string[]): Array<{ keys: string[]; units: string[] }> {
  const groups = new Map<string, { keys: string[]; units: string[] }>();
  for (const key of keys) {
    const listed = catalogUnits(key);
    const units = listed && listed.length > 0 ? [...listed] : [...EDIT_UNITS];
    const id = units.join(",");
    const group = groups.get(id) ?? { keys: [], units };
    group.keys.push(key);
    groups.set(id, group);
  }
  return [...groups.values()].sort((left, right) => left.units.join(",").localeCompare(right.units.join(",")));
}

function conditioningMovementSchema(keys: readonly string[] = standardCatalogKeys()): Record<string, unknown> {
  const load = {
    anyOf: [
      strictObject(
        { male: { anyOf: [TEXT, { type: "null" }] }, female: { anyOf: [TEXT, { type: "null" }] } },
        ["male", "female"],
      ),
      { type: "null" },
    ],
  };
  const branch = (group: { keys: string[]; units: string[] }) =>
    strictObject(
      {
        movement: stringEnum(group.keys),
        amount: { type: "integer" },
        unit: stringEnum(group.units),
        load,
      },
      ["movement", "amount", "unit", "load"],
    );
  const groups = movementUnitGroups(keys);
  if (groups.length === 1) return branch(groups[0]!);
  return { anyOf: groups.map(branch) };
}

/** One Korean field. The server copies only this string onto the failed day. */
export function textFieldRecoveryFormat(field: "notes_ko" | "warmup_ko" | "strength_note_ko"): ResponseFormat {
  return schemaOf("text_field_recovery", strictObject({ [field]: TEXT }, [field]));
}

/** Live recovery replies name cells. A full session is still accepted by the validator for older fixtures. */
export function recoveryCellFormat(keys: readonly string[] = standardCatalogKeys()): ResponseFormat {
  const allowed = keys.length > 0 ? keys : standardCatalogKeys();
  return schemaOf(
    "conditioning_recovery_cells",
    strictObject(
      {
        cells: {
          type: "array",
          items: strictObject(
            {
              catalog_key: stringEnum(allowed),
              field: stringEnum(["movement", "amount", "unit", "load"]),
              value: TEXT,
            },
            ["catalog_key", "field", "value"],
          ),
        },
      },
      ["cells"],
    ),
  );
}

function conditioningFields(keys: readonly string[]) {
  const movement = conditioningMovementSchema(keys);
  return strictObject(
    {
      format: stringEnum(WOD_FORMATS),
      duration_min: { type: "integer", minimum: NON_LONG_CONDITIONING.min, maximum: LONG_CONDITIONING.max },
      stimulus: stringEnum(STIMULI),
      movements: { type: "array", items: movement },
      volume: stringEnum(VOLUME_BANDS),
      intensity: stringEnum(INTENSITY_BANDS),
      interval_work_sec: { type: ["integer", "null"] },
      interval_rest_sec: { type: ["integer", "null"] },
    },
    ["format", "duration_min", "stimulus", "movements", "volume", "intensity", "interval_work_sec", "interval_rest_sec"],
  );
}

/** Conditioning response for one day. Equipment is not a model field. */
export function conditioningDayFormat(keys: readonly string[]): ResponseFormat {
  const allowed = keys.length > 0 ? keys : standardCatalogKeys();
  return schemaOf(
    "conditioning_coach_day",
    strictObject(
      {
        day: stringEnum(DAY_ORDER),
        notes_ko: TEXT,
        conditioning: conditioningFields(allowed),
      },
      ["day", "notes_ko", "conditioning"],
    ),
  );
}

export type HeadPieceRef = {
  day: string;
  block: string;
  catalog_key: string;
  movement_ids?: readonly string[];
  quantity_ids?: readonly string[];
  amount?: string;
  unit?: string | null;
  /** Legal bands except the current one. Present only when the stored intensity is over the ceiling. */
  intensity_values?: readonly string[];
};

function currentQuantityId(cell: HeadPieceRef): string | null {
  if (!cell.unit || !cell.amount) return null;
  const digits = cell.amount.match(/\d+/);
  if (!digits) return null;
  return `${cell.unit}:${digits[0]}`;
}

function exceptCurrent(ids: readonly string[], current: string | null): string[] {
  return ids.filter((id) => id !== current);
}

/** 현재 값만 남은 칸은 수정 후보가 아니다. 빈 enum으로 REVISE를 만들지 않는다. */
function headRevisionItem(cell: HeadPieceRef): Record<string, unknown> | null {
  const quantities = exceptCurrent(
    cell.quantity_ids?.length ? [...cell.quantity_ids] : quantityOptions(cell.catalog_key).map((option) => option.id),
    currentQuantityId(cell),
  );
  const movements = exceptCurrent(cell.movement_ids?.length ? [...cell.movement_ids] : [cell.catalog_key], cell.catalog_key);
  const base = {
    day: stringEnum([cell.day]),
    block: stringEnum([cell.block]),
    catalog_key: stringEnum([cell.catalog_key]),
    reason: TEXT,
  };
  const required = ["day", "block", "catalog_key", "field", "value", "reason"];
  const branches: Record<string, unknown>[] = [];
  if (quantities.length) {
    branches.push(
      strictObject(
        { ...base, field: stringEnum(["quantity_option"]), value: stringEnum(quantities) },
        required,
      ),
    );
  }
  if (movements.length) {
    branches.push(
      strictObject(
        { ...base, field: stringEnum(["movement_id"]), value: stringEnum(movements) },
        required,
      ),
    );
  }
  if (cell.intensity_values?.length) {
    branches.push(
      strictObject(
        { ...base, field: stringEnum(["intensity"]), value: stringEnum(cell.intensity_values) },
        required,
      ),
    );
  }
  if (branches.length === 1) return branches[0]!;
  if (branches.length > 1) return { anyOf: branches };
  return null;
}

export function headReviewFormat(keys: readonly string[], cells: readonly HeadPieceRef[] = []): ResponseFormat {
  const allowed = keys.length > 0 ? keys : standardCatalogKeys();
  const unique = new Map<string, HeadPieceRef>();
  for (const cell of cells) unique.set(`${cell.day}:${cell.block}:${cell.catalog_key}`, cell);
  const listed = [...unique.values()];
  const revisable = listed.flatMap((cell) => {
    const item = headRevisionItem(cell);
    return item ? [item] : [];
  });
  const statusEnum = listed.length > 0 && revisable.length === 0 ? HEAD_STATUSES.filter((status) => status !== "REVISE") : HEAD_STATUSES;
  const revisions = revisable.length
    ? { type: "array", items: { anyOf: revisable } }
    : listed.length
      ? { type: "array", items: strictObject({ day: stringEnum(DAY_ORDER) }, ["day"]) }
      : {
        type: "array",
        items: strictObject(
          {
            day: stringEnum(DAY_ORDER),
            block: stringEnum(EDIT_BLOCKS),
            catalog_key: stringEnum(allowed),
            field: stringEnum(["movement", "amount", "unit", "load"]),
            value: TEXT,
            reason: TEXT,
          },
          ["day", "block", "catalog_key", "field", "value", "reason"],
        ),
      };
  return schemaOf(
    "head_coach_review",
    strictObject(
      {
        note_ko: NOTE_KO,
        status: stringEnum(statusEnum),
        revisions,
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
      ["note_ko", "status", "revisions", "adjustments"],
    ),
  );
}

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
          goal_table: strictObject(
            {
              month_goal: TEXT,
              weeks: {
                type: "array",
                items: strictObject(
                  {
                    week_index: { type: "integer", enum: [1, 2, 3, 4] },
                    goal: TEXT,
                    days: {
                      type: "array",
                      items: strictObject(
                        {
                          day: stringEnum(DAY_ORDER),
                          rest: { type: "boolean" },
                          purpose: TEXT,
                          focus: stringEnum(["none", ...SESSION_FOCUSES]),
                          intensity: { type: "integer" },
                          target: strictObject(
                            {
                              movement_pattern: stringEnum(["none", "squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic"]),
                              body_region: stringEnum(["none", ...BODY_REGIONS]),
                              energy_system: stringEnum(["none", ...ENERGY_SYSTEMS]),
                            },
                            ["movement_pattern", "body_region", "energy_system"],
                          ),
                          stimulus: stringEnum(["none", ...STIMULI]),
                          time_domain: stringEnum(["none", "short", "medium", "long"]),
                        },
                        ["day", "rest", "purpose", "focus", "intensity", "target", "stimulus", "time_domain"],
                      ),
                    },
                  },
                  ["week_index", "goal", "days"],
                ),
              },
            },
            ["month_goal", "weeks"],
          ),
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
          "goal_table",
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
              volume: stringEnum(VOLUME_BANDS),
              intensity: stringEnum(INTENSITY_BANDS),
              interval_work_sec: { type: ["integer", "null"] },
              interval_rest_sec: { type: ["integer", "null"] },
            },
            ["format", "duration_min", "stimulus", "movements", "volume", "intensity", "interval_work_sec", "interval_rest_sec"],
          ),
        },
        ["day", "warmup_ko", "notes_ko", "conditioning"],
      ),
    );
  }
  if (agent === "strength") {
    return schemaOf("strength_coach_day", strictObject({ day: stringEnum(DAY_ORDER), strength_note_ko: TEXT }, ["day", "strength_note_ko"]));
  }
  if (agent === "warmup") {
    return schemaOf("warmup_coach_day", strictObject({ day: stringEnum(DAY_ORDER), warmup_ko: TEXT }, ["day", "warmup_ko"]));
  }
  if (agent === "conditioning") return conditioningDayFormat(standardCatalogKeys());
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
        note_ko: NOTE_KO,
        status: stringEnum(HEAD_STATUSES),
        revisions: {
          type: "array",
          items: strictObject(
            {
              day: stringEnum(DAY_ORDER),
              block: stringEnum(EDIT_BLOCKS),
              catalog_key: stringEnum(standardCatalogKeys()),
              field: stringEnum(["movement", "amount", "unit", "load"]),
              value: TEXT,
              reason: TEXT,
            },
            ["day", "block", "catalog_key", "field", "value", "reason"],
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
      ["note_ko", "status", "revisions", "adjustments"],
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


export function weeklyIntentErrors(
  value: unknown,
  bounds?:
    | readonly {
        day: string;
        intensity_profile: readonly string[];
        strength_lift: readonly string[];
        zone2?: readonly string[];
        zone2_modality?: readonly string[];
        zone2_duration?: readonly string[];
        zone2_effort?: readonly string[];
        zone2_hr?: readonly string[];
      }[]
    | null,
): string[] {
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
    const issue = textError(path, value[path], false);
    if (issue) errors.push(issue);
  }
  const seen = new Set<string>();
  value.days.forEach((row, index) => {
    const prefix = `days[${index}]`;
    if (!isRecord(row)) {
      errors.push(`${prefix}: expected an object`);
      return;
    }
    const bound = bounds?.find((item) => item.day === row.day);
    const checks: Array<[string, unknown, readonly string[]]> = [
      ["day", row.day, DAY_ORDER],
      ["primary_training", row.primary_training, PRIMARY_TRAININGS],
      ["secondary_training", row.secondary_training, SECONDARY_TRAININGS],
      ["stimulus", row.stimulus, COACHING_STIMULI],
      ["intensity_profile", row.intensity_profile, bound?.intensity_profile ?? INTENSITY_PROFILES],
      ["volume_profile", row.volume_profile, VOLUME_BANDS],
      ["duration_profile", row.duration_profile, DURATION_PROFILES],
      ["fatigue_target", row.fatigue_target, FATIGUE_TARGETS],
      ["movement_pattern", row.movement_pattern, MOVEMENT_PATTERNS],
      ["recovery_role", row.recovery_role, RECOVERY_ROLES],
      ["strength_lift", row.strength_lift, bound?.strength_lift ?? STRENGTH_LIFTS],
    ];
    for (const [field, fieldValue, allowed] of checks) {
      const issue = enumError(`${prefix}.${field}`, fieldValue, allowed);
      if (!issue) continue;
      const named = bound && (field === "intensity_profile" || field === "strength_lift");
      errors.push(named ? `${issue} day=${String(row.day)}` : issue);
    }
    if (typeof row.day === "string") {
      if (seen.has(row.day)) errors.push(`${prefix}.day: duplicate ${row.day}`);
      seen.add(row.day);
    }
    const goal = textError(`${prefix}.training_goal`, row.training_goal, false);
    const notes = textError(`${prefix}.notes_ko`, row.notes_ko, false);
    if (goal) errors.push(goal);
    if (notes) errors.push(notes);
    if (typeof row.progression_required !== "boolean") {
      errors.push(`${prefix}.progression_required: received ${received(row.progression_required)}; allowed: boolean true or false`);
    }
    if (typeof row.benchmark !== "boolean") {
      errors.push(`${prefix}.benchmark: received ${received(row.benchmark)}; allowed: boolean true or false`);
    }
    if (bound?.zone2) {
      const zoneChecks: Array<[string, unknown, readonly string[]]> = [
        ["zone2", row.zone2, bound.zone2],
        ["zone2_modality", row.zone2_modality, bound.zone2_modality ?? ["none"]],
        ["zone2_duration", row.zone2_duration, bound.zone2_duration ?? ["0"]],
        ["zone2_effort", row.zone2_effort, bound.zone2_effort ?? ["none"]],
        ["zone2_hr", row.zone2_hr, bound.zone2_hr ?? ["none"]],
      ];
      for (const [field, fieldValue, allowed] of zoneChecks) {
        const issue = enumError(`${prefix}.${field}`, fieldValue, allowed);
        if (issue) errors.push(`${issue} day=${String(row.day)}`);
      }
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
      const note = textError(`week_roles[${index}].note_ko`, row.note_ko, false);
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
  const warmup = textError("warmup_ko", value.warmup_ko, false);
  const notes = textError("notes_ko", value.notes_ko, false);
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
  } else if (piece.movements.length < minMoves || piece.movements.length > 5) {
    errors.push(`conditioning.movements: length ${piece.movements.length}; allowed: ${minMoves}–5`);
  } else {
    const catalog = new Map(movementCatalog().map((row) => [row.key, row.name_ko]));
    piece.movements.forEach((row, index) => {
      const prefix = `conditioning.movements[${index}]`;
      if (!isRecord(row)) {
        errors.push(`${prefix}: expected {key, amount, name_ko}`);
        return;
      }
      if (typeof row.amount === "number" && typeof row.unit === "string") {
        const cellKey = typeof row.movement === "string" ? row.movement : typeof row.key === "string" ? row.key : "";
        if (cellKey === "squat" || cellKey === "pause_squat" || cellKey === "pin_squat") {
          errors.push(`${prefix}.key: received ${cellKey}; use back_squat or front_squat`);
        }
        errors.push(...cellMovementErrors(prefix, row, catalog));
        return;
      }
      const keyText = typeof row.key === "string" ? row.key : typeof row.movement === "string" ? row.movement : "";
      if (keyText === "squat" || keyText === "pause_squat" || keyText === "pin_squat") {
        errors.push(`${prefix}.key: received ${keyText}; use back_squat or front_squat`);
      }
      const piecesName = catalog.get(keyText);
      const standardName = catalogMovement(keyText)?.name_ko ?? null;
      if (!piecesName && !standardName) {
        errors.push(`${prefix}.key: received ${received(row.key)}; allowed catalog key`);
      } else if (typeof row.name_ko === "string" && row.name_ko !== piecesName && row.name_ko !== standardName) {
        errors.push(`${prefix}.name_ko: received ${received(row.name_ko)}; catalog name for ${keyText} is ${piecesName ?? standardName}`);
      }
      if (typeof row.amount !== "string" || !row.amount.trim() || /kg/i.test(row.amount)) {
        errors.push(`${prefix}.amount: received ${received(row.amount)}; reps are 12 or 12 reps, calories are 12cal or 12/10cal, distance is 500m. Never kilograms.`);
      } else if (typeof row.amount_value === "number" && typeof row.unit === "string") {
        const suffix = row.unit === "reps" ? "" : String(row.unit);
        const verdict = checkCellEdit({ catalog_key: keyText, field: "amount", value: `${row.amount_value}${suffix}` });
        if (!verdict.ok) errors.push(`${prefix}: ${verdict.reason}`);
        const unitVerdict = checkCellEdit({ catalog_key: keyText, field: "unit", value: String(row.unit) });
        if (!unitVerdict.ok) errors.push(`${prefix}: ${unitVerdict.reason}`);
      }
    });
    const seenKeys = new Set<string>();
    piece.movements.forEach((row, index) => {
      if (!isRecord(row)) return;
      const keyText = typeof row.key === "string" ? row.key : typeof row.movement === "string" ? row.movement : "";
      if (!keyText) return;
      if (seenKeys.has(keyText)) errors.push(`conditioning.movements[${index}].key: duplicate ${keyText}`);
      seenKeys.add(keyText);
      const load = isRecord(row.load) ? { male: typeof row.load.male === "string" ? row.load.male : null, female: typeof row.load.female === "string" ? row.load.female : null } : null;
      errors.push(...rxLoadErrors(keyText, load).map((error) => `conditioning.movements[${index}]: ${error}`));
    });
  }
  errors.push(...intervalFieldErrors(piece));
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
    const reason = textError(`${prefix}.reason_ko`, row.reason_ko, false);
    if (reason) errors.push(reason);
    if (typeof row.day === "string") seen.add(row.day);
  });
  for (const day of days) {
    if (!seen.has(day)) errors.push(`decisions: missing ${day}`);
  }
  return errors;
}

function coachForBlock(block: string): string | null {
  if (block === "strength") return "strength_coach";
  if (block === "conditioning") return "conditioning_coach";
  if (block === "warmup") return "warmup_coach";
  return null;
}

function amountShape(unit: string, amount: string): boolean {
  if (!/^\d+(\/\d+)?$/.test(amount)) return false;
  if (amount.includes("/") && unit !== "cal") return false;
  return true;
}

function cellMovementErrors(prefix: string, row: Record<string, unknown>, pieces: Map<string, string>): string[] {
  const errors: string[] = [];
  const named = typeof row.movement === "string" ? row.movement : typeof row.key === "string" ? row.key : "";
  const stored = catalogMovement(named);
  if (!stored) {
    errors.push(`${prefix}: unknown movement ${named}`);
    return errors;
  }
  const unitVerdict = checkCellEdit({ catalog_key: stored.key, field: "unit", value: String(row.unit) });
  if (!unitVerdict.ok) errors.push(`${prefix}: ${unitVerdict.reason}`);
  const suffix = row.unit === "reps" ? "" : String(row.unit);
  const amountVerdict = checkCellEdit({ catalog_key: stored.key, field: "amount", value: `${row.amount}${suffix}` });
  if (!amountVerdict.ok) errors.push(`${prefix}: ${amountVerdict.reason}`);
  const piecesName = pieces.get(stored.key);
  if (typeof row.name_ko === "string" && row.name_ko !== stored.name_ko && row.name_ko !== piecesName) {
    errors.push(`${prefix}.name_ko: received ${received(row.name_ko)}; catalog name for ${stored.key} is ${stored.name_ko}`);
  }
  return errors;
}

/** A revision that is only a sentence. The head must return the edit fields instead. */
export function editItemErrors(row: unknown, index: number): string[] {
  const prefix = `revisions[${index}]`;
  if (!isRecord(row)) return [`${prefix}: expected an object`];
  const errors: string[] = [];
  if (typeof row.action !== "string" && (typeof row.field === "string" || typeof row.catalog_key === "string")) {
    return cellEditErrors(row, index);
  }
  if (typeof row.action !== "string") {
    errors.push(`${prefix}: prose-only revision; return day, target_coach, block, action, target_movement, new_movement, new_amount, new_unit, and reason`);
    return errors;
  }
  const day = enumError(`${prefix}.day`, row.day, DAY_ORDER);
  const coach = enumError(`${prefix}.target_coach`, row.target_coach, ["strength_coach", "conditioning_coach", "warmup_coach"]);
  const block = enumError(`${prefix}.block`, row.block, EDIT_BLOCKS);
  const action = enumError(`${prefix}.action`, row.action, EDIT_ACTIONS);
  if (day) errors.push(day);
  if (coach) errors.push(coach);
  if (block) errors.push(block);
  if (action) errors.push(action);
  const reason = textError(`${prefix}.reason`, row.reason, false);
  if (reason) errors.push(reason);
  if (!block && !coach && coachForBlock(String(row.block)) !== row.target_coach) {
    errors.push(`${prefix}.target_coach: received ${received(row.target_coach)}; block ${String(row.block)} belongs to ${coachForBlock(String(row.block))}`);
  }
  const catalog = movementKeys();
  const target = row.target_movement;
  const next = row.new_movement;
  const amount = row.new_amount;
  const unit = row.new_unit;
  const needsTarget = row.action === "replace" || row.action === "change_amount" || row.action === "delete";
  const needsNext = row.action === "replace" || row.action === "add";
  const needsAmount = row.action === "replace" || row.action === "change_amount" || row.action === "add";
  if (needsTarget) {
    const key = enumError(`${prefix}.target_movement`, target, catalog);
    if (key) errors.push(key);
  } else if (target != null) errors.push(`${prefix}.target_movement: add uses null`);
  if (needsNext) {
    const key = enumError(`${prefix}.new_movement`, next, catalog);
    if (key) errors.push(key);
  } else if (next != null) errors.push(`${prefix}.new_movement: ${String(row.action)} uses null`);
  if (needsAmount) {
    if (typeof amount !== "string" || typeof unit !== "string" || !EDIT_UNITS.includes(unit as (typeof EDIT_UNITS)[number]) || !amountShape(String(unit), amount)) {
      errors.push(`${prefix}.new_amount: received ${received(amount)} ${received(unit)}; expected a count and reps, cal, m, or sec`);
    }
  } else if (amount != null || unit != null) errors.push(`${prefix}: delete sets new_amount and new_unit to null`);
  if (row.action === "replace" && target === next) errors.push(`${prefix}: replace needs a different catalog key`);
  return errors;
}

export function headReviewErrors(value: unknown): string[] {
  if (!isRecord(value)) return ["expected a head review object"];
  const errors: string[] = [];
  const status = enumError("status", value.status, HEAD_STATUSES);
  if (status) errors.push(status);
  const note = typeof value.note_ko === "string" ? value.note_ko.trim() : "";
  if (note.length < 10) errors.push("note_ko: expected at least 10 characters");
  const revisionsEmpty = !Array.isArray(value.revisions) || value.revisions.length === 0;
  const adjustmentsEmpty = !Array.isArray(value.adjustments) || value.adjustments.length === 0;
  if (revisionsEmpty && adjustmentsEmpty && note.length < 10) {
    errors.push("note_ko: an approval reason is required when there is no revision");
  }
  if (!Array.isArray(value.revisions)) {
    errors.push("revisions: expected an array");
    return errors;
  }
  if ((value.status === "APPROVE" || value.status === "APPROVE_WITH_NOTE" || value.status === "BLOCK") && value.revisions.length > 0) {
    errors.push("revisions: APPROVE, APPROVE_WITH_NOTE, and BLOCK require an empty array");
  }
  if (value.status === "REVISE" && value.revisions.length === 0 && !(Array.isArray(value.adjustments) && value.adjustments.length > 0)) {
    errors.push("revisions: REVISE requires a catalog cell. An adjustment is not a cell edit.");
  }
  if (Array.isArray(value.adjustments)) {
    if ((value.status === "APPROVE" || value.status === "APPROVE_WITH_NOTE" || value.status === "BLOCK") && value.adjustments.length > 0) {
      errors.push("adjustments: APPROVE, APPROVE_WITH_NOTE, and BLOCK require an empty array");
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
    errors.push(...editItemErrors(row, index));
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
