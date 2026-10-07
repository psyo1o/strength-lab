import { serverModelKey } from "../month-plan/adapter";
import { DAY_ORDER } from "../month-plan/types";
import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../month-plan/week-model";
import {
  allowedStrengthProgramming,
  englishKoPath,
  hardConstraints,
  judgeWeek,
  MONTH_REQUIRED_KEYS,
  monthSchemaErrors,
  monthShapeDetail,
  normalizeWeekPayload,
  parseMonthDirection,
  parseWeekDraft,
  changedSessions,
  constraintFailureBriefs,
  lowerBodyFatigueRule,
  retryRepairPlan,
  sessionFieldTrace,
  similarityDiagnostics,
  structureValidationErrors,
  TIME_DOMAIN_RANGES,
  weeklyRequirements,
} from "./rules";
import { exampleSets, prescriptionGuide } from "./strength-methods";
import { monthlyTimeoutMs, weeklyTimeoutMs } from "./timeouts";
import {
  EQUIPMENT,
  MONTHLY_PROMPT_VERSION,
  MOVEMENT_PATTERNS,
  SIMILARITY_CONFIG,
  STIMULI,
  WEEKLY_PROMPT_VERSION,
  type FallbackReason,
  type MonthDirection,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
} from "./types";
import type { ProgrammingSummary } from "./summary";

export const WEEK_MAX_TOKENS = 8_000;
export const MONTH_MAX_TOKENS = 2_500;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const RULES = [
  "Write one shared class week. Do not write a different workout per member.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms. Strength is percent of training max only.",
  "Sex changes nothing except wall ball, kettlebell, box height, and machine calories, and the server applies those later.",
  "On a training day, warmup is 8–12 minutes and is never cut. A rest day is not a training day: warmup_min is 0, warmup_ko is empty, and there is no warm-up and no workout.",
  `Stimulus is only ${STIMULI.join(", ")}. If conditioning exists, stimulus is required and is that same value on the session and on conditioning. Null is invalid. The same stimulus cannot sit on consecutive training days.`,
  "If strength is null, strength_purpose, strength_volume, and strength_intensity must be null. If any of those is set, strength and its lift are required.",
  "Choose duration_min first, then set time_domain from that duration. Do not choose time_domain first.",
  "hard_constraints are mandatory. MUST NOT EXCEED means the server rejects the week. They are not suggestions.",
  "No heavy snatch, clean, or deadlift the day after a heavy squat.",
  "No heavy squat the day after a heavy deadlift.",
  "No heavy snatch the day after a heavy press.",
  "Long conditioning is 30–40 minutes, about twice in the month, and not on a heavy squat or deadlift day.",
  "A repeated benchmark is a measurement, not a duplicate session.",
  "The monthly strength method is a constraint, not a fixed weekday template. If the method is 531, use the server's exact sets. Otherwise do not force 5/3/1 set or rep patterns.",
  "Each training day carries strength_purpose, strength_volume, strength_intensity, metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration. Those fields match the strength and conditioning objects.",
  "Rx metcon is 12–20 minutes, so time_domain is medium. Only the day after squat or deadlift is 8–12 minutes and time_domain short. duration_min 14 is medium, never short. Long conditioning is 30–40 minutes and time_domain long.",
  "Allowed lifts are squat, ohp, bench, and deadlift. The word press means ohp. Do not use lift press.",
  "Every *_ko field, focus, and scheme_note is Korean. Do not write those fields in English.",
  "Machine calories are a male/female pair such as 12/10cal. Never write kilograms, male/female loads, box heights, or benchmark loads anywhere in the week. The server adds the class wall ball, kettlebell, and box loads on the screen later. A movement is its name only: 월볼, never 월볼 plus a kilogram number.",
  "Every training day (rest=false) has a conditioning object, and the session-level copies metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration are filled from it. Null in any of those on a training day is rejected as missing session fields. A strength-only training day is not valid in this contract.",
  "Top-level JSON is { intent, sessions }. sessions has exactly mon, tue, wed, thu, fri, sat, and sun. Do not wrap the object in class_week, week, or days.",
  "Warmup, strength, and conditioning together stay within about 60 minutes. Do not put a 30–40 minute piece on a strength day. Saturday is optional and has no main lift.",
  "Return JSON only. Do not pick a candidate_id.",
  "When conditioning is present, conditioning.purpose is required in that same object. It is one or two Korean sentences on why that metcon is in the day. Write it while writing the metcon. Do not add purpose in a later pass. Do not put coaching sales, payment language, or invented kilograms in purpose.",
];

const MONTH_RULES = [
  "Write one month direction for the shared class. Do not write daily workouts, sessions, or movements.",
  "Personalization is empty. Do not ask for a questionnaire and do not invent a paid plan.",
  "Do not invent kilograms.",
  "You are not required to use 5/3/1. 5/3/1 is only one strength method. Choose from the previous month, fatigue, strength, volume, intensity, benchmarks, and the long-term block. Do not change the method from week to week. Do not write daily workouts.",
  "long_conditioning_weeks has exactly two week indexes. benchmark_week is one week index.",
  "Return one JSON object. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only.",
  "Every *_ko field is Korean. Allowed English tokens are only AMRAP, EMOM, Rx, Scaled, Benchmark, Deload, and 5/3/1. The server rejects a low Korean ratio.",
];

function messageText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return null;
  const message = (first as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.trim() ? text : null;
}

export function parseModelJson(payload: unknown): unknown {
  const text = messageText(payload);
  if (!text) return null;
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function isTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

export type ModelResponseLog = {
  attempt: number;
  raw: unknown;
  latencyMs: number;
  responseFormat: "json_schema" | "json_object" | null;
  normalizations: string[];
  diagnostics?: Record<string, unknown> | null;
};

const RETRY_INSTRUCTION = [
  "Do not regenerate the week.",
  "Do not rewrite valid sessions.",
  "Treat every valid session from the previous draft as immutable. Copy immutable_sessions from previous_draft byte for byte.",
  "Preserve valid sessions and the original weekly intent.",
  "Modify only sessions that directly violate a listed validation error, in repair_sessions.",
  "Fix the listed validation errors in priority order.",
  "Do not introduce new movements, formats, equipment, weights, or structures unless required to repair the listed failure.",
  "Do not fix one validation error by creating another validation error.",
  "Do not redesign unrelated days.",
  "When repairing a failed draft, change only sessions listed in repair_scope and repair_sessions.",
  "Preserve PASS sessions exactly.",
  "Do not change a valid session merely to make the week look different.",
  "Do not introduce a new strength method.",
  "Do not change the monthly goal.",
  "All hard constraints remain mandatory.",
  "Do not repeat these errors.",
  "Do not discard the week and write a new random week.",
  "Before returning the revised week, re-check all seven days against every hard constraint, every weekly requirement, the lower-body fatigue rule, the no-kilogram rule, Korean naming, and same-week similarity.",
  "If the validation error is not associated with a session, do not treat repair_sessions as empty work. Use an intent-only repair. A scheme_note language failure repairs only the relevant intent or scheme_note text and preserves all sessions unchanged.",
].join(" ");

/** Features the similarity checker actually scores. Weight 0 features stay out of this list. */
function scoredSimilarityFeatures(): string[] {
  return (Object.keys(SIMILARITY_CONFIG.features) as Array<keyof typeof SIMILARITY_CONFIG.features>).filter(
    (feature) => SIMILARITY_CONFIG.features[feature] > 0,
  );
}

/**
 * Planning instructions for this week. The model fills structure_slots, checks fingerprints,
 * then writes sessions. Nothing here assigns a lift or a movement to a weekday.
 */
function generationPhases(input: { longCount: number; highFatigue: boolean; heavyDefinition: string }) {
  const scored = scoredSimilarityFeatures().join(", ");
  const shareLimit = SIMILARITY_CONFIG.threshold - 1;
  return {
    note: "Think in this order. Output only the final JSON. Do not print the phases, the slots, or a reasoning trace.",
    phase_1_week_structure: {
      goal: "Before writing any workout details, design the 7-day structure in structure_slots. A slot is a structural decision. It does not assign a lift, a movement, or a fixed weekday template. Decide the session role and the stimulus before any movement name.",
      read_first: [
        "monthly plan and month_summary",
        "current strength method and strength_prescription",
        "recent actual performance and fatigue",
        "recent weeks, then the repeated structural fingerprints in recent_structure_avoidance",
        "weekly_requirements",
        "hard_constraints",
      ],
      order: [
        "Read recent weeks before this week's structure exists.",
        "Place each weekly requirement, including the long conditioning day when one is required. Choose the day from the week. Do not lock it to Sunday or any other weekday.",
        "Decide each day's role, rest or training. A day that carries a weekly requirement is training.",
        "For every training day, decide stimulus, format, time domain, movement pattern, and volume profile before choosing a movement.",
        "Keep used_stimuli, used_formats, used_time_domains, and used_structures. Before day 4, ask whether that combination is already structurally close to day 1, day 2, or day 3, and do the same before every later day.",
      ],
      per_day_decisions: [
        "programming_intent",
        `primary_stimulus from ${STIMULI.join(" | ")}`,
        "secondary_stimulus or none",
        "format_family from amrap | for_time | emom | intervals",
        "time_domain from duration_min, using time_domain_rules",
        "movement_pattern",
        "strength_exposure: none | upper | lower, and whether it is a heavy lower exposure",
        "conditioning_role: short | medium | long | none",
        "lower_body_stress: none | moderate | heavy",
        "recovery_role: train | easy | rest",
        "volume_profile and equipment_profile",
      ],
      stimulus_before_movements:
        "Do not start from movement names and then judge diversity from those names. Decide the training stimulus and the session role first. Choose the movements only after the fingerprint is set.",
      fingerprint_plan: `A structural fingerprint is ${scored}. Plan one fingerprint for every day at the same time. Share at most ${shareLimit} of those features with every other day and with every recent entry. ${SIMILARITY_CONFIG.threshold} or more is rejected. This is a planning comparison. It does not replace the server check.`,
      unnecessary_repetition:
        "Avoid unnecessary repetition. If repetition is required by the strength method, a weekly requirement, progression, fatigue management, or the recovery strategy, it may be retained. When two days do not need to be structurally similar, prefer meaningful structural variation. The same stimulus may appear again later in the week. Consecutive training days still cannot share a stimulus.",
      long_conditioning:
        input.longCount === 1
          ? "weekly_requirements asks for exactly 1 long conditioning session. Choose that day now, before any other session is written. time_domain long, duration inside the long range, not a heavy squat or deadlift day, and not the day after one. That day is not rest."
          : "weekly_requirements asks for exactly 0 long conditioning sessions. Do not plan one.",
      rest_day:
        "Decide each day's role from weekly requirements before marking rest. A rest day is rest=true, warmup_min 0, warmup_ko empty, strength null, conditioning null, and every work field null. Do not write a warm-up or a workout on it. A day that carries a weekly requirement cannot be rest.",
      fatigue: input.highFatigue
        ? "Previous lower-body fatigue is high. Do not increase lower-body loading. Use the fatigue-cut prescription already defined by the active strength method: lower_body_sets for squat and deadlift. Do not invent percentages or kilograms."
        : "Previous lower-body fatigue is not high. Use the method prescription. Do not drop squat or deadlift below that method.",
      not_a_template:
        "Do not reuse a fixed weekday map. Monday is not squat, Tuesday is not conditioning, and no other day is pre-assigned. Choose from the month, the method, fatigue, recent structures, and weekly requirements.",
    },
    phase_2_constraint_check: {
      goal: "Before writing prescriptions, compare the planned slots. If a check fails, redesign that day's structure. Do not fix a match by renaming a movement.",
      same_week: {
        inspection_a: "Compare every pair of days: mon with tue, mon with wed, and every other pair through sat with sun.",
        inspection_b: `For each pair, compare format, time_domain, stimulus, movement_pattern, and volume, plus equipment. These are the scored features: ${scored}.`,
        inspection_c:
          "When a pair is unnecessarily similar, change the underlying structure. burpee to box jump is not a repair. amrap, medium, high_rep, engine, moderate volume becomes emom, short, technical, gymnastic, low volume. A medium high_rep engine piece becomes long intervals with an engine pattern and a different stimulus.",
        share_at_most: shareLimit,
        rejected_at: SIMILARITY_CONFIG.threshold,
      },
      recent_weeks: {
        before_generating: [
          "Read recent weeks.",
          "Identify repeated structural fingerprints.",
          "Identify recently used combinations of format, time_domain, stimulus, movement_pattern, and volume.",
          "Avoid copying those combinations unless progression or the strength method justifies keeping part of them.",
        ],
        structure_not_names:
          "A recent for_time, medium, high_rep, engine, moderate session is not varied by writing amrap with the same medium time domain, high_rep stimulus, engine pattern, and moderate volume. Change the underlying structure, for example short, technical, intervals, gymnastic.",
        progression:
          "Avoid unnecessary structural repetition. When progression requires repetition, preserve the training intent and vary at least some structural dimensions when possible. A continuing strength exposure may keep its lift and the method's next percents. Do not also keep the same format, time domain, stimulus, movement pattern, and volume on the rest of the session.",
      },
      before_writing: [
        "Draft the weekly structure.",
        "Compare every pair of days.",
        `Do not allow two days to share ${SIMILARITY_CONFIG.threshold} or more of: ${scored}.`,
        "If two days are that similar, redesign one day's structure before writing final prescriptions.",
        "Review recent_structure_avoidance the same way. Avoid copying a recent structural fingerprint unless progression or the method needs part of it, and then vary the other dimensions.",
      ],
      checks: [
        "no consecutive training days share a stimulus",
        `no repeated structural fingerprint inside the week: share at most ${shareLimit} of ${scored}`,
        "no day shares that many features with a recent_structure_avoidance entry. Progression may keep the lift. It still has to change enough other features to stay at or below the share limit",
        "movement-name swaps are not variation",
        `adequate spacing between heavy lower exposures (${input.heavyDefinition})`,
        "weekly long-conditioning count matches weekly_requirements",
        "strength method and lower_body_fatigue_rule are respected",
        "fatigue constraints are respected",
        "rest days have no warm-up and no workout",
        "hard_constraints and the benchmark requirement",
        "no kilograms anywhere",
      ],
      lower_body_spacing: `Prefer adequate recovery spacing between heavy lower-body exposures. Do not place heavy squat and heavy deadlift on consecutive days unless the selected strength method explicitly requires or permits that sequence and the fatigue profile stays inside hard_constraints. No implemented method requires that sequence. The constitution rejects a heavy pull the day after a heavy squat and a heavy squat the day after a heavy deadlift. Heavy means: ${input.heavyDefinition}.`,
      variation:
        "Change the underlying training stimulus, not only movement names. Variation is a different combination of format, time domain, stimulus, movement pattern, volume, equipment, and work/rest. back squat to front squat, or thruster to wall ball inside the same format and time domain, is not variation.",
    },
    phase_3_final_json: {
      goal: "Only after the structure passes phase 2, write the session prescriptions in the existing schema.",
      lock_structure:
        "Once the weekly structure is approved, do not silently change its stimulus, format, time domain, movement pattern, volume profile, or recovery role while writing the final session. If a session cannot satisfy its assigned structure, redesign the structure before writing the final JSON.",
      prescriptions: [
        "Copy sets from allowed_programming. lower_body_sets for squat and deadlift. upper_body_sets for ohp and bench. Do not invent percentages.",
        "A training day fills every required session field. movement_combination is not null.",
        "Do not invent equipment loads. Use movement names, method percentages, and machine calorie pairs only.",
        "Session names are natural Korean where Korean naming is expected.",
        "The written session must still match its structure slot.",
      ],
    },
    phase_4_self_check: {
      goal: "FINAL WEEK STRUCTURE CHECK. Before returning JSON, confirm the week. If any item fails, do not return the final JSON. Redesign that structure first, then write the sessions again. Return { intent, sessions } only.",
      checks: [
        "Are any two training days unnecessarily similar?",
        "Does any day repeat a recent structural fingerprint unnecessarily?",
        "Are heavy lower exposures appropriately spaced?",
        "Is the required number of long conditioning sessions satisfied?",
        "Are rest days actually rest days, with no warm-up and no accidental rest-day workout?",
        "Does each session still match its structure slot?",
        "Are there unnecessary stimulus repetitions on consecutive training days?",
        "Did changing a movement accidentally leave the same underlying stimulus?",
        "Did changing format accidentally preserve the same time, stimulus, and volume combination?",
        "Are any numeric equipment weights invented? no invented weights",
        "all required fields populated",
        "no null movement_combination on training days",
        "Korean naming where expected, without sacrificing the program",
      ],
    },
  };
}

const PRESCRIBED_WEIGHT_RULE = {
  rule: "Do not invent kilogram values. Do not invent male/female prescribed weights. Do not invent equipment specifications. Do not invent benchmark loads.",
  allowed: "Movement names without a weight. Machine calories as a 12/10cal pair. Percent of training max inside strength.sets.",
  server_applies: "The server adds the class wall ball, kettlebell, and box loads on the screen. You never write them.",
  rejected_example: "월볼(남 9kg · 여 6kg)",
  accepted_example: "월볼",
  failure_name: "invented_weight",
} as const;

const NAME_KO_RULE = {
  purpose: "name_ko is the natural Korean name a Korean member reads on the screen. key carries the English identity.",
  rules: [
    "Korean letters only, apart from the allowed tokens AMRAP, EMOM, Rx, Scaled, Benchmark, Deload, 5/3/1.",
    "No kilograms, no male/female loads, no English abbreviations such as T2B or HSPU in name_ko.",
    "Descriptions, purposes, and warmup text are Korean sentences, not English.",
    "Session names should be natural Korean where Korean naming is expected.",
    "Do not use unnecessary English-only names.",
    "Do not sacrifice programming quality merely to satisfy naming.",
    "The server measures the Korean share of every *_ko field. Below 0.7 is rejected.",
  ],
  examples: [
    { key: "toes_to_bar", name_ko: "토즈 투 바" },
    { key: "wall_ball", name_ko: "월볼" },
    { key: "handstand_push_up", name_ko: "핸드스탠드 푸시업" },
    { key: "row", name_ko: "로잉", amount: "12/10cal" },
  ],
} as const;

/** What the caller stores. modelName is set only when this process called the model. */
export type AuthorTrace = {
  modelName: string | null;
  attempt: number;
  responses: ModelResponseLog[];
  detail: string | null;
  errors: string[];
  normalizations: string[];
};

function noModelTrace(): AuthorTrace {
  return { modelName: null, attempt: 1, responses: [], detail: null, errors: [], normalizations: [] };
}

type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict: true; schema: Record<string, unknown> } };

const JSON_OBJECT: ResponseFormat = { type: "json_object" };

function monthResponseFormat(): ResponseFormat {
  const string = { type: "string" };
  return {
    type: "json_schema",
    json_schema: {
      name: "month_direction",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          scheme: { type: "string", enum: ["531", "volume", "intensity", "skill", "deload"] },
          strength_method: string,
          method_rationale: string,
          method_constraints: string,
          progression_notes: string,
          block_type: string,
          weekly_progression: string,
          deload_strategy: string,
          focus_ko: string,
          why_ko: string,
          monthly_goal: string,
          primary_block: string,
          secondary_goal: string,
          strength_direction: string,
          conditioning_direction: string,
          skill_direction: string,
          volume_direction: string,
          intensity_direction: string,
          benchmark_direction: string,
          variation_direction: string,
          fatigue_direction: string,
          weekly_direction: string,
          evaluation_targets: { type: "array", items: string },
          week_themes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { week_index: { type: "integer" }, theme_ko: string },
              required: ["week_index", "theme_ko"],
            },
          },
          long_conditioning_weeks: { type: "array", items: { type: "integer" } },
          benchmark_week: { type: "integer" },
          constraints: { type: "array", items: string },
        },
        required: [...MONTH_REQUIRED_KEYS],
      },
    },
  };
}

function strictObject(properties: Record<string, unknown>, required: string[]): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function nullable(schema: Record<string, unknown>): Record<string, unknown> {
  return { anyOf: [schema, { type: "null" }] };
}

function stringEnum(values: readonly string[]): Record<string, unknown> {
  return { type: "string", enum: [...values] };
}

const WEEK_STRING = { type: "string" };

function weekResponseFormat(): ResponseFormat {
  const set = strictObject(
    {
      percent_of_tm: { type: "number" },
      reps: { type: "integer" },
      amrap: { type: "boolean" },
    },
    ["percent_of_tm", "reps", "amrap"],
  );
  const strength = strictObject(
    {
      lift: stringEnum(["squat", "ohp", "bench", "deadlift"]),
      sets: { type: "array", items: set },
    },
    ["lift", "sets"],
  );
  const movement = strictObject(
    { key: WEEK_STRING, amount: WEEK_STRING, name_ko: WEEK_STRING },
    ["key", "amount", "name_ko"],
  );
  const conditioning = strictObject(
    {
      benchmark: { type: "boolean" },
      format: stringEnum(["amrap", "for_time", "emom", "intervals"]),
      time_domain: stringEnum(["short", "medium", "long"]),
      stimulus: stringEnum(STIMULI),
      movement_patterns: { type: "array", items: stringEnum(MOVEMENT_PATTERNS) },
      movements: { type: "array", items: movement },
      equipment: { type: "array", items: stringEnum(EQUIPMENT) },
      rep_structure: WEEK_STRING,
      work_rest_structure: WEEK_STRING,
      duration_min: { type: "integer" },
      volume: stringEnum(["low", "moderate", "high"]),
      intensity: stringEnum(["light", "moderate", "heavy"]),
      long_conditioning: { type: "boolean" },
      purpose: WEEK_STRING,
    },
    [
      "benchmark",
      "format",
      "time_domain",
      "stimulus",
      "movement_patterns",
      "movements",
      "equipment",
      "rep_structure",
      "work_rest_structure",
      "duration_min",
      "volume",
      "intensity",
      "long_conditioning",
      "purpose",
    ],
  );
  const sessionKeys = [
    "day",
    "rest",
    "optional",
    "warmup_min",
    "warmup_ko",
    "strength_purpose",
    "strength_volume",
    "strength_intensity",
    "metcon_purpose",
    "metcon_format",
    "time_domain",
    "stimulus",
    "movement_combination",
    "equipment",
    "volume",
    "intensity",
    "expected_duration",
    "strength",
    "conditioning",
  ];
  const sharedSession = {
    day: stringEnum(DAY_ORDER),
    optional: { type: "boolean" },
    warmup_min: { type: "integer" },
    warmup_ko: WEEK_STRING,
    metcon_purpose: nullable(WEEK_STRING),
    metcon_format: nullable(stringEnum(["amrap", "for_time", "emom", "intervals"])),
    time_domain: nullable(stringEnum(["short", "medium", "long"])),
    stimulus: nullable(stringEnum(STIMULI)),
    equipment: { type: "array", items: stringEnum(EQUIPMENT) },
    volume: nullable(stringEnum(["low", "moderate", "high"])),
    intensity: nullable(stringEnum(["light", "moderate", "heavy"])),
    expected_duration: nullable({ type: "integer" }),
    conditioning: nullable(conditioning),
  };
  const strengthPresent = {
    strength_purpose: WEEK_STRING,
    strength_volume: stringEnum(["low", "moderate", "high"]),
    strength_intensity: stringEnum(["light", "moderate", "heavy"]),
    strength,
  };
  const strengthAbsent = {
    strength_purpose: { type: "null" },
    strength_volume: { type: "null" },
    strength_intensity: { type: "null" },
    strength: { type: "null" },
  };
  // OpenAI strict allows anyOf and rejects if/then.
  // Training days require movement_combination. Rest days keep it nullable.
  const trainingSession = (strengthFields: Record<string, unknown>) =>
    strictObject(
      {
        ...sharedSession,
        rest: { type: "boolean", enum: [false] },
        movement_combination: WEEK_STRING,
        ...strengthFields,
      },
      sessionKeys,
    );
  const restSession = strictObject(
    {
      ...sharedSession,
      rest: { type: "boolean", enum: [true] },
      movement_combination: nullable(WEEK_STRING),
      ...strengthAbsent,
    },
    sessionKeys,
  );
  const session = {
    anyOf: [trainingSession(strengthPresent), trainingSession(strengthAbsent), restSession],
  };
  return {
    type: "json_schema",
    json_schema: {
      name: "week_draft",
      strict: true,
      schema: strictObject(
        {
          intent: strictObject(
            { why_ko: WEEK_STRING, focus: WEEK_STRING, scheme_note: WEEK_STRING },
            ["why_ko", "focus", "scheme_note"],
          ),
          sessions: { type: "array", items: session },
        },
        ["intent", "sessions"],
      ),
    },
  };
}

/** JSON schema sent as the week response format. Training days cannot omit movement_combination. */
export function weekDraftJsonSchema(): Record<string, unknown> {
  const format = weekResponseFormat();
  if (format.type !== "json_schema") return {};
  return format.json_schema.schema;
}

function requestBody(userBody: unknown, maxTokens: number, format: ResponseFormat): string {
  return JSON.stringify({
    model: MONTH_PLAN_OPENAI_MODEL,
    messages: [
      {
        role: "developer",
        content:
          "You program one shared class. Reply with JSON only. Never invent kilograms. Never pick a candidate id. Personalization is off.",
      },
      { role: "user", content: JSON.stringify(userBody) },
    ],
    response_format: format,
    reasoning_effort: "none",
    max_completion_tokens: maxTokens,
  });
}

async function postModel(input: {
  key: string;
  url: string;
  fetchImpl: FetchLike;
  timeoutMs: number;
  payload: string;
}): Promise<Response> {
  return input.fetchImpl(input.url, {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(input.timeoutMs),
    headers: {
      Authorization: `Bearer ${input.key}`,
      "Content-Type": "application/json",
    },
    body: input.payload,
  });
}

function finishReason(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : null;
}

type Completed =
  | { ok: true; json: unknown; latencyMs: number; responseFormat: "json_schema" | "json_object" }
  | {
      ok: false;
      reason: FallbackReason;
      raw: unknown;
      latencyMs: number;
      detail: string;
      responseFormat: "json_schema" | "json_object" | null;
    };

async function complete(input: {
  key: string;
  url: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  format: ResponseFormat;
}): Promise<Completed> {
  const started = Date.now();
  const latency = () => Date.now() - started;
  let used: "json_schema" | "json_object" = input.format.type === "json_schema" ? "json_schema" : "json_object";
  try {
    let response = await postModel({
      key: input.key,
      url: input.url,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      payload: requestBody(input.body, input.maxTokens, input.format),
    });
    if (!response.ok && response.status === 400 && input.format.type === "json_schema") {
      const rejected = await response.text();
      if (/response_format|json_schema/i.test(rejected)) {
        used = "json_object";
        response = await postModel({
          key: input.key,
          url: input.url,
          fetchImpl: input.fetchImpl,
          timeoutMs: input.timeoutMs,
          payload: requestBody(input.body, input.maxTokens, JSON_OBJECT),
        });
      } else {
        return {
          ok: false,
          reason: "http_error",
          raw: { status: 400, body: rejected.slice(0, 400) },
          latencyMs: latency(),
          detail: "http 400",
          responseFormat: used,
        };
      }
    }
    if (!response.ok) {
      const text = await response.text();
      return {
        ok: false,
        reason: "http_error",
        raw: { status: response.status, body: text.slice(0, 400) },
        latencyMs: latency(),
        detail: `http ${response.status}`,
        responseFormat: used,
      };
    }
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      return { ok: false, reason: "bad_json", raw: text.slice(0, 400), latencyMs: latency(), detail: "unreadable JSON", responseFormat: used };
    }
    const cut = finishReason(payload) === "length";
    const message = messageText(payload);
    if (cut) {
      return {
        ok: false,
        reason: "truncated",
        raw: message ?? payload,
        latencyMs: latency(),
        detail: "finish_reason length",
        responseFormat: used,
      };
    }
    const json = parseModelJson(payload);
    if (!json) {
      return { ok: false, reason: "bad_json", raw: message ?? payload, latencyMs: latency(), detail: "unreadable JSON", responseFormat: used };
    }
    return { ok: true, json, latencyMs: latency(), responseFormat: used };
  } catch (error) {
    const timeout = isTimeout(error);
    return {
      ok: false,
      reason: timeout ? "timeout" : "http_error",
      raw: timeout ? { timeout: true } : { error: "request_failed" },
      latencyMs: latency(),
      detail: timeout ? "timed out" : "request failed",
      responseFormat: used,
    };
  }
}

async function authorWithRetries<T>(input: {
  key: string;
  body: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxTokens: number;
  format: ResponseFormat;
  accept: (
    json: unknown,
    meta: { attempt: number; previous: unknown },
  ) =>
    | { ok: true; value: T; detail?: string | null; normalizations?: string[]; diagnostics?: Record<string, unknown> | null }
    | {
        ok: false;
        reason: FallbackReason;
        detail: string;
        errors?: string[];
        normalizations?: string[];
        diagnostics?: Record<string, unknown> | null;
      };
  retryBody?: (errors: string[], previous: unknown) => unknown;
}): Promise<{ ok: true; value: T; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const responses: ModelResponseLog[] = [];
  let reason: FallbackReason = "http_error";
  let detail: string | null = "request failed";
  let errors: string[] = ["request failed"];
  let normalizations: string[] = [];
  let previous: unknown = null;
  let used = 0;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    used = attempt;
    const body = attempt === 2 && input.retryBody && errors.length ? input.retryBody(errors, previous) : input.body;
    const completed = await complete({
      key: input.key,
      url: MONTH_PLAN_OPENAI_URL,
      body,
      fetchImpl: input.fetchImpl,
      timeoutMs: input.timeoutMs,
      maxTokens: input.maxTokens,
      format: input.format,
    });
    const accepted = completed.ok ? input.accept(completed.json, { attempt, previous }) : null;
    if (completed.ok) previous = completed.json;
    const attemptNormalizations = accepted?.normalizations ?? [];
    responses.push({
      attempt,
      raw: completed.ok ? completed.json : completed.raw,
      latencyMs: completed.latencyMs,
      responseFormat: completed.responseFormat,
      normalizations: attemptNormalizations,
      diagnostics: accepted?.diagnostics ?? null,
    });
    if (!completed.ok) {
      reason = completed.reason;
      detail = completed.detail;
      errors = [completed.detail];
      normalizations = [];
      continue;
    }
    if (!accepted || !accepted.ok) {
      reason = accepted && !accepted.ok ? accepted.reason : "schema";
      detail = accepted && !accepted.ok ? accepted.detail : "unreadable JSON";
      errors = accepted && !accepted.ok ? (accepted.errors?.length ? accepted.errors : [accepted.detail]) : ["unreadable JSON"];
      normalizations = attemptNormalizations;
      continue;
    }
    return {
      ok: true,
      value: accepted.value,
      trace: {
        modelName: MONTH_PLAN_OPENAI_MODEL,
        attempt,
        responses,
        detail: accepted.detail ?? null,
        errors: [],
        normalizations: attemptNormalizations,
      },
    };
  }
  return {
    ok: false,
    reason,
    trace: { modelName: MONTH_PLAN_OPENAI_MODEL, attempt: used, responses, detail, errors, normalizations },
  };
}

export function monthPrompt(summary: ProgrammingSummary): unknown {
  const bootstrap = summary.progression.months_recorded === 0;
  return {
    task: "Return one JSON object for the month. Put every required key at the top level. Do not wrap the object. Do not use a key named month_direction_only. Do not write daily workouts.",
    personalization: null,
    bootstrap,
    block_rule: bootstrap
      ? "Bootstrap month. Choose the strength method. 5/3/1 is allowed and is not the default."
      : "Follow the stored strength method and the previous evaluation. Do not switch the method inside this month.",
    summary,
    rules: MONTH_RULES,
    required_top_level_keys: [...MONTH_REQUIRED_KEYS],
    prompt_version: MONTHLY_PROMPT_VERSION,
    implemented_strength_methods: ["531", "ACCUMULATION", "INTENSITY_BLOCK", "DELOAD_RECOVERY"],
    shape: {
      scheme: "volume",
      strength_method: "ACCUMULATION",
      method_rationale: "한국어",
      method_constraints: "한국어",
      progression_notes: "한국어",
      block_type: "한국어",
      weekly_progression: "한국어",
      deload_strategy: "한국어",
      focus_ko: "string",
      why_ko: "string",
      monthly_goal: "string",
      primary_block: "string",
      secondary_goal: "string",
      strength_direction: "string",
      conditioning_direction: "string",
      skill_direction: "string",
      volume_direction: "string",
      intensity_direction: "string",
      benchmark_direction: "string",
      variation_direction: "string",
      fatigue_direction: "string",
      weekly_direction: "string",
      evaluation_targets: ["string"],
      week_themes: [{ week_index: 1, theme_ko: "string" }],
      long_conditioning_weeks: [2, 4],
      benchmark_week: 4,
      constraints: ["string"],
    },
  };
}

function structureAvoidanceEntry(row: StoredStructure) {
  return {
    day: row.day,
    format: row.format,
    time_domain: row.time_domain,
    stimulus: row.stimulus,
    movement_pattern: [...row.movement_patterns].sort(),
    equipment: [...row.equipment].sort(),
    volume: row.volume,
    signature: [
      row.format,
      row.time_domain,
      row.stimulus ?? "",
      [...row.movement_patterns].sort().join("+"),
      [...row.equipment].sort().join("+"),
      row.volume,
    ].join("|"),
  };
}

/**
 * One slot per weekday. The server names the decisions the model must make before writing sessions.
 * It does not assign a lift, a movement, or a fixed role to any day.
 */
function structureSlots(input: { longRequired: boolean; highFatigue: boolean }) {
  const scored = scoredSimilarityFeatures();
  const signature = scored.join("|");
  const chooses = {
    role: "AI chooses: strength / mixed / conditioning / rest. This slot does not assign a lift.",
    programming_intent: "Decide from the month, the method, fatigue, recent structures, and weekly requirements. Not a fixed weekday template.",
    primary_stimulus: `Decide one of ${STIMULI.join(" | ")} before writing movements. Consecutive training days must not share it.`,
    secondary_stimulus: "Optional second quality, or none. It does not replace primary_stimulus.",
    format_family: "Decide one of amrap | for_time | emom | intervals. Do not invent a format name.",
    time_domain: "Decide short | medium | long only after duration_min, using time_domain_rules.",
    movement_pattern: `Decide from ${MOVEMENT_PATTERNS.join(" | ")}. A different exercise name can still be the same pattern.`,
    strength_exposure: "Decide none | upper | lower. Do not name the lift in this slot.",
    lower_body_stress: "Decide none | moderate | heavy. Heavy lower exposures need recovery spacing.",
    conditioning_role: "Decide short | medium | long | none.",
    volume_profile: "Decide low | moderate | high for the whole session.",
    recovery_role: "Decide train | easy | rest only after weekly requirements have a day.",
    equipment_profile: "Decide equipment from the enum. Do not invent kilogram loads.",
    structure_signature: `Decide ${signature}. Share at most ${SIMILARITY_CONFIG.threshold - 1} of those features with every other day and every recent entry.`,
    fingerprint_plan: `Before movements, record format + time_domain + stimulus + movement_pattern + volume, and equipment. That combination is this day's fingerprint. Share at most ${SIMILARITY_CONFIG.threshold - 1} scored features with every other day and every recent entry.`,
    used_structures: "While planning the week, keep used_stimuli, used_formats, used_time_domains, and used_structures. Compare this day with those lists before accepting the slot.",
    stimulus: "AI must choose",
    equipment: "AI must choose",
  };
  return DAY_ORDER.map((day, index) => {
    const earlier = DAY_ORDER.slice(0, index);
    const notes: string[] = [];
    notes.push("Fill this slot in phase 1. Do not write the session until phase 2 accepts the week.");
    notes.push("Decide the session role and the primary stimulus before any movement name.");
    if (earlier.length) notes.push(`must not share ${SIMILARITY_CONFIG.threshold} or more similarity features with ${earlier.join(", ")}`);
    if (earlier.length) notes.push("If this fingerprint is unnecessarily close to an earlier day, change format, time domain, stimulus, movement pattern, or volume. Do not only rename a movement.");
    notes.push(`must not share ${SIMILARITY_CONFIG.threshold} or more similarity features with any recent_structure_avoidance entry`);
    notes.push("Changing only a movement name does not change the signature.");
    notes.push("After this slot is approved, the session keeps its stimulus, format, time domain, movement pattern, volume profile, and recovery role.");
    notes.push("must respect hard_constraints, lower_body_fatigue_rule, and the day-after rules");
    if (index > 0) notes.push(`stimulus must differ from ${earlier[earlier.length - 1]} when both days train`);
    if (input.highFatigue) {
      notes.push("High lower fatigue. If this day uses squat or deadlift, copy lower_body_sets. Do not invent percentages or kilograms.");
    }
    if (input.longRequired) {
      notes.push(
        "The one long conditioning session is chosen in phase 1. This day is eligible only if it is not a heavy squat or deadlift day and not the day after one. Exactly one day takes it, and that day is not rest.",
      );
    } else {
      notes.push("This week requires zero long conditioning sessions. Do not mark this day long.");
    }
    notes.push("If this day is rest, it has no warm-up and no workout.");
    if (day === "sat") notes.push("optional day, no main lift");
    if (day === "sun") {
      notes.push(
        "Rest is allowed here only after weekly requirements already have a day. rest=true, warmup_min 0, warmup_ko empty, and every work field null.",
      );
    }
    return { day, ...chooses, notes };
  });
}

function retrySection(retryErrors: readonly string[], previousDraft: unknown) {
  const plan = retryRepairPlan(retryErrors);
  return {
    retry: {
      instruction: RETRY_INSTRUCTION,
      errors: [...retryErrors],
      ...(previousDraft ? { previous_draft: previousDraft } : {}),
    },
    retry_context: {
      previous_draft: previousDraft ?? null,
      repair_plan: {
        principle: plan.principle,
        immutable_sessions: plan.immutable_sessions,
        repair_sessions: plan.repair_sessions,
        week_level_requirements: plan.week_level_requirements,
        intent_only: plan.intent_only,
        priority_order: plan.priority_order,
      },
      validation_errors: plan.errors,
      failure_briefs: constraintFailureBriefs(retryErrors),
      repair: {
        preserve: "Preserve valid sessions and the original weekly intent. immutable_sessions are copied from previous_draft without any change.",
        fix: "Fix the listed validation errors in priority order. Start with priority 1.",
        may_change: [
          "sessions listed in repair_sessions",
          "a session that directly conflicts with a listed hard constraint error",
          "exactly one additional session that you name, only when week_level_requirements is not empty",
          ...(plan.intent_only ? ["intent text such as scheme_note, why_ko, or focus"] : []),
        ],
        intent_only_repair: {
          when: "The validation error is not associated with a session, so repair_sessions is empty.",
          instruction:
            "Do not treat repair_sessions as empty work. Use an intent-only repair. Example: a scheme_note language failure repairs only the relevant intent or scheme_note text and preserves all sessions unchanged.",
          this_attempt: plan.intent_only,
        },
        must_keep: [
          "every session in immutable_sessions, unchanged",
          "monthly method",
          "monthly goal",
          "unrelated valid days",
          "benchmark requirement",
          "long conditioning requirement",
          "a strength method that is already valid",
        ],
        hard_constraints: "All hard constraints remain mandatory.",
        final_check:
          "Change only repair_scope. Before returning the revised JSON, mentally validate ALL seven sessions against ALL previously supplied hard constraints and weekly requirements, the lower-body fatigue rule, the no-kilogram rule, Korean naming, and same-week similarity. A repair that creates a new violation is a failed repair.",
      },
    },
  };
}

export function weekPrompt(input: {
  summary: ProgrammingSummary;
  month: MonthDirection;
  weekIndex: WeekIndex;
  recent?: readonly StoredStructure[];
  retryErrors?: readonly string[];
  previousDraft?: unknown;
}): unknown {
  const method = input.month.strength_method || input.month.scheme;
  const previous = input.summary.previous_week;
  const limits = hardConstraints(previous?.actual);
  const allowed = allowedStrengthProgramming(method, input.weekIndex, previous?.actual);
  const requirements = weeklyRequirements(input.month, input.weekIndex);
  const guide = prescriptionGuide(method, input.weekIndex, allowed.current_fatigue === "high" || allowed.current_fatigue === "low" ? allowed.current_fatigue : "unknown");
  const sets = allowed.lower_body_sets ?? exampleSets(method, input.weekIndex, "unknown", "squat");
  const theme = input.month.week_themes.find((row) => row.week_index === input.weekIndex)?.theme_ko ?? "";
  const longShape =
    requirements.long_conditioning_sessions_min === 1
      ? {
          note: "Choose this day in phase 1, before writing sessions. You choose the day. Do not put this on a heavy squat or deadlift day or the day after one. That day is not rest. The server will not rewrite a shorter piece into this duration.",
          time_domain: "long" as const,
          duration_min: TIME_DOMAIN_RANGES.long.min,
          long_conditioning: true,
        }
      : null;
  const exampleHeavy = (sets ?? []).some((set) => set.percent_of_tm >= 85);
  const lowerRule = lowerBodyFatigueRule(method, input.weekIndex, previous?.actual);
  const recentStructures = (input.recent ?? []).filter((row) => !row.benchmark).map(structureAvoidanceEntry);
  const highFatigue = lowerRule.active;
  const longCount = requirements.long_conditioning_sessions_min;
  const scored = scoredSimilarityFeatures();
  return {
    task: "Write the whole class week, including why. Do not pick from a catalog.",
    prompt_version: WEEKLY_PROMPT_VERSION,
    generation_phases: generationPhases({
      longCount,
      highFatigue,
      heavyDefinition: limits.heavy_lower_definition,
    }),
    decision_order: [
      "monthly strength method",
      "month plan",
      "recent actual performance and fatigue",
      "read recent weeks and list repeated structural fingerprints",
      "weekly requirements and hard constraints",
      "build the 7-day structure in structure_slots, stimulus and role before movements",
      "structural fingerprint plan, then the same-week conflict check and the recent-week check",
      "write session prescriptions only after that check, without changing the approved structure",
      "final week structure check",
      "server validation",
      "on failure, repair only the sessions in repair_scope, or intent text when the error has no session",
    ],
    personalization: null,
    week_index: input.weekIndex,
    month_summary: {
      scheme: input.month.scheme,
      primary_block: input.month.primary_block,
      focus_ko: input.month.focus_ko,
      week_theme_ko: theme,
      long_conditioning_weeks: input.month.long_conditioning_weeks,
      benchmark_week: input.month.benchmark_week,
      weekly_direction: input.month.weekly_direction,
    },
    previous_generation_source: input.summary.previous_week?.generation_source ?? null,
    summary: input.summary,
    previous_week: previous
      ? {
          week_start: previous.week_start,
          generation_source: previous.generation_source,
          intent: previous.programming_intent,
          class_summary: previous.actual?.class_summary ?? null,
        }
      : null,
    recent_structures: (input.recent ?? []).map((row) => ({
      day: row.day,
      format: row.format,
      time_domain: row.time_domain,
      stimulus: row.stimulus,
      movement_patterns: row.movement_patterns,
      equipment: row.equipment,
      volume: row.volume,
    })),
    recent_structure_avoidance: {
      rule: `Before generating this week's structure, read recent weeks and identify repeated structural fingerprints and recently used combinations of format, time_domain, stimulus, movement_pattern, and volume. Avoid unnecessary structural repetition. When progression or the strength method justifies keeping part of a recent fingerprint, preserve that training intent and vary at least some of the other dimensions. Similarity counts ${scored.join(", ")}. A session that shares ${SIMILARITY_CONFIG.threshold} or more of them with any entry below, or with another day of this same week, is rejected. Share at most ${SIMILARITY_CONFIG.threshold - 1} features with every entry and with every other day. Movement-name changes alone do not count as meaningful variation. Change the underlying training stimulus, not only movement names. A different format name that keeps the same time domain, stimulus, movement pattern, and volume is still the same structure.`,
      before_generating: [
        "Read recent weeks.",
        "Identify repeated structural fingerprints.",
        "Identify recently used combinations of format, time_domain, stimulus, movement_pattern, and volume.",
        "Avoid copying those combinations unless progression or the strength method justifies keeping part of them.",
      ],
      entries: recentStructures,
      same_week:
        "Before writing prescriptions, compare every pair of days against this same rule. If two days are unnecessarily similar, redesign the structure of one day first. Keep used_structures while you plan. Do not only rename a movement.",
    },
    structure_slots: structureSlots({ longRequired: longCount === 1, highFatigue }),
    structure_planning: {
      fingerprint: scored,
      share_at_most: SIMILARITY_CONFIG.threshold - 1,
      rejected_at: SIMILARITY_CONFIG.threshold,
      fingerprint_definition: `format + time_domain + stimulus + movement_pattern + volume, and equipment. The scored list is ${scored.join(", ")}.`,
      used_lists: ["used_stimuli", "used_formats", "used_time_domains", "used_structures"],
      compare_before_writing:
        "Draft all seven slots, record each fingerprint, compare every pair, and compare every day with recent_structure_avoidance. Redesign a similar structure before writing sets or movements.",
      preserve_approved_structure:
        "Once the weekly structure is approved, do not silently change its stimulus, format, time domain, movement pattern, volume profile, or recovery role while writing the final session. If a session cannot satisfy its assigned structure, redesign the structure before writing the final JSON.",
      variation:
        "Variation changes format, time domain, stimulus, movement pattern, volume, equipment, or work/rest. A movement substitution that keeps those features is not variation. Stimulus values are only the stimulus enum. Avoid unnecessary repetition. Repetition required by the strength method, a weekly requirement, progression, fatigue management, or recovery may be retained.",
      progression_vs_variation:
        "Strength progression may keep the same lift and the method's next percents. That is allowed. The rest of the session still changes format, time domain, stimulus, movement pattern, or volume when those dimensions do not need to match.",
      lower_body_spacing: `Prefer adequate recovery spacing between heavy lower-body exposures (${limits.heavy_lower_definition}). Do not place heavy squat and heavy deadlift on consecutive days unless the selected strength method explicitly requires or permits it and the fatigue profile stays acceptable. No implemented method requires that sequence.`,
      rest_day:
        "Place weekly requirements first, then mark rest. A rest day has rest=true, warmup_min 0, empty warmup_ko, and null work. Do not attach a warm-up or a workout.",
      long_conditioning:
        longCount === 1
          ? "Choose the single long conditioning day in phase 1, then set that day's stimulus, recovery role, and lower-body stress. Do not add it after the other sessions are written. Do not lock that session to Sunday."
          : "This week has no long conditioning session. Do not add one at the end.",
      fatigue: highFatigue
        ? "Do not increase lower-body loading. Use the existing fatigue-cut prescription on lower_body_sets for squat and deadlift. Do not invent percentages or kilograms."
        : "Use the method prescription for squat and deadlift. Do not drop a lower lift below the method.",
    },
    strength_prescription: guide,
    example_sets: {
      upper_body: allowed.upper_body_sets,
      lower_body: allowed.lower_body_sets,
      note: "Use lower_body on squat and deadlift. Use upper_body on ohp and bench. Do not copy one onto the other when they differ.",
    },
    lower_body_fatigue_rule: lowerRule,
    prescribed_weight_rule: PRESCRIBED_WEIGHT_RULE,
    name_ko_rule: NAME_KO_RULE,
    hard_constraints: limits,
    programming_guidance: limits.guidance,
    programming_space: limits.programming_space,
    weekly_requirements: requirements,
    allowed_programming: allowed,
    long_conditioning_shape: longShape,
    strength_constraints: {
      note: "Boundaries only. You still choose the lifts, the days, and the session structure.",
      max_heavy_lower_sessions: limits.heavy_lower_sessions_max,
      heavy_lower_metcon: limits.heavy_lower_metcon,
      volume_direction: limits.volume_direction,
      intensity_direction: limits.intensity_direction,
      ai_still_chooses: ["lift", "day", "session structure"],
    },
    similarity_constraints: {
      threshold: SIMILARITY_CONFIG.threshold,
      features: scored,
      note: "Avoid unnecessary structural repetition against a recent week or another day of this week. Changing only the movement name is not enough. Compare fingerprints before writing sessions. Progression may keep a lift and vary the other fingerprint features. Benchmarks may repeat.",
    },
    enums: {
      day: [...DAY_ORDER],
      lift: ["squat", "ohp", "bench", "deadlift"],
      format: ["amrap", "for_time", "emom", "intervals"],
      stimulus: [...STIMULI],
      time_domain: ["short", "medium", "long"],
      volume: ["low", "moderate", "high"],
      intensity: ["light", "moderate", "heavy"],
      equipment: [...EQUIPMENT],
    },
    enum_rule: `Do not invent values outside these enums. press is not a lift. Use ohp or bench. stimulus is exactly ${STIMULI.join(" | ")}.`,
    strength_metadata_rule:
      "If strength is null, strength_purpose, strength_volume, and strength_intensity are null. If strength_purpose is set, strength and lift are required.",
    time_domain_rules: {
      order: "Pick duration_min first. Then set time_domain from that number.",
      short: `${TIME_DOMAIN_RANGES.short.min}–${TIME_DOMAIN_RANGES.short.max} minutes. Only the day after squat or deadlift.`,
      medium: `${TIME_DOMAIN_RANGES.medium.min}–${TIME_DOMAIN_RANGES.medium.max} minutes. Hard Rx metcon is 12–20 minutes, so 14, 16, and 18 are medium.`,
      long: `${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} minutes. Not on a heavy squat or deadlift day.`,
    },
    time_domain_examples: {
      valid: [
        { time_domain: "short", duration_min: 10 },
        { time_domain: "short", duration_min: 12 },
        { time_domain: "medium", duration_min: 14 },
        { time_domain: "medium", duration_min: 16 },
        { time_domain: "medium", duration_min: 18 },
        { time_domain: "long", duration_min: 30 },
        { time_domain: "long", duration_min: 35 },
        { time_domain: "long", duration_min: 40 },
      ],
      invalid: [
        { time_domain: "short", duration_min: 14, why: "14 is medium, not short" },
        { time_domain: "short", duration_min: 16, why: "16 is medium, not short" },
        { time_domain: "medium", duration_min: 12, why: "12 is short, not medium" },
        { time_domain: "medium", duration_min: 30, why: "30 is long, not medium" },
        { time_domain: "long", duration_min: 20, why: "20 is medium, not long" },
        { time_domain: "long", duration_min: 14, why: "14 is medium, not long" },
      ],
    },
    rules: [
      ...RULES,
      "Follow month_summary.scheme for the whole month. Do not change the block in this week.",
      "Do not copy a recent weekday strength layout. Progression may keep one lift on its day. Two identical previous layouts must not be copied.",
      "why_ko is one to three Korean sentences. Do not restate the whole month.",
      "Use allowed_programming. lower_body_sets are required on squat and deadlift. upper_body_sets are required on ohp and bench. strength_prescription is the method rule. When the two differ, allowed_programming wins. Do not copy a 5/3/1 pattern unless the method is 531.",
      "weekly_requirements is a hard structural requirement for this week. Satisfy it inside sessions. The server rejects a miss and does not change duration for you.",
      "programming_space is only a boundary. Choose the day and the lift yourself.",
      "lower_body_fatigue_rule.applies_to lists every lift the fatigue cut covers. When it is active, squat and deadlift both use lower_body_sets. A deadlift at the unrestricted method sets is rejected the same way a squat would be.",
      "Plan structure_slots before writing any session. Do not use a fixed weekday template.",
      "structure_slots name the structural decisions per day. They do not assign a lift or a movement. Fill them in phase 1, compare fingerprints, and keep every day's signature apart from the others and from recent_structure_avoidance.",
      "Decide stimulus and session role before movement names. Avoid unnecessary structural repetition. Do not keep a repeated fingerprint by renaming a movement.",
      "Once the structure is approved, write sessions that keep it. If a session cannot match its slot, redesign the structure before the final JSON.",
      "A rest day stays empty. Weekly requirements, including the long conditioning session, are placed before any day is marked rest.",
    ],
    ...(input.retryErrors && input.retryErrors.length ? retrySection(input.retryErrors, input.previousDraft) : {}),
    output_shape: {
      top_level_keys: ["intent", "sessions"],
      intent: { why_ko: "한국어", focus: "한국어", scheme_note: "한국어" },
      sessions: "exactly 7 objects, one per day mon through sun",
    },
    compact_example_note:
      "Schema shape only. The day and lift in this example are not this week's plan and are not a weekday template. Copy the fields, not the training.",
    compact_example: {
      intent: {
        why_ko: "이번 주는 월 방향을 유지하고 직전 주 피로에 맞춰 하체 볼륨을 정합니다.",
        focus: "공유 클래스",
        scheme_note: `${input.month.scheme} 세트를 이번 주 전체에 씁니다.`,
      },
      sessions: [
        {
          day: "mon",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "월요일 10분. 쉬운 로잉 후 빈 바.",
          strength_purpose: "스쿼트를 이번 주 세트로 합니다.",
          strength_volume: "moderate",
          strength_intensity: exampleHeavy ? "heavy" : "moderate",
          metcon_purpose: "월요일 시간 캡 안에 끝내는 반복입니다.",
          metcon_format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_combination: "row+burpee",
          equipment: ["rower", "bodyweight"],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 16,
          strength: { lift: "squat", sets },
          conditioning: {
            benchmark: false,
            format: "amrap",
            time_domain: "medium",
            stimulus: "high_rep",
            movement_patterns: ["engine"],
            movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
            equipment: ["rower"],
            rep_structure: "16분 AMRAP. 캡 16분.",
            work_rest_structure: "시간 안에 반복합니다. 캡 16분.",
            duration_min: 16,
            volume: "moderate",
            intensity: "moderate",
            long_conditioning: false,
            purpose: "로잉을 정해진 시간 동안 반복하는 컨디셔닝이에요. 호흡이 끊기면 페이스를 낮춰요.",
          },
        },
        {
          day: "sun",
          rest: true,
          optional: false,
          warmup_min: 0,
          warmup_ko: "",
          strength_purpose: null,
          strength_volume: null,
          strength_intensity: null,
          metcon_purpose: null,
          metcon_format: null,
          time_domain: null,
          stimulus: null,
          movement_combination: null,
          equipment: [],
          volume: null,
          intensity: null,
          expected_duration: null,
          strength: null,
          conditioning: null,
        },
      ],
      sessions_must_also_include: ["tue", "wed", "thu", "fri", "sat"],
    },
    session_shape: {
      day: "mon",
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "한국어",
      strength_purpose: "한국어 또는 null",
      strength_volume: "low | moderate | high | null",
      strength_intensity: "light | moderate | heavy | null",
      metcon_purpose: "한국어",
      metcon_format: "amrap | for_time | emom | intervals",
      time_domain: "short | medium | long",
      stimulus: "heavy | high_rep | technical | null",
      movement_combination: "movement keys joined with +",
      equipment: ["barbell"],
      volume: "low | moderate | high",
      intensity: "light | moderate | heavy",
      expected_duration: 16,
      strength: { lift: "squat", sets },
      conditioning: {
        benchmark: false,
        format: "amrap",
        time_domain: "medium",
        stimulus: "high_rep",
        movement_patterns: ["engine"],
        movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }],
        equipment: ["rower"],
        rep_structure: "16분 AMRAP. 캡 16분.",
        work_rest_structure: "시간 안에 반복합니다. 캡 16분.",
        duration_min: 16,
        volume: "moderate",
        intensity: "moderate",
        long_conditioning: false,
        purpose: "로잉을 정해진 시간 동안 반복하는 컨디셔닝이에요. 호흡이 끊기면 페이스를 낮춰요.",
      },
    },
  };
}

export async function authorMonth(input: {
  summary: ProgrammingSummary;
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<
  { ok: true; direction: MonthDirection; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }
> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model", trace: noModelTrace() };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? monthlyTimeoutMs();
  const result = await authorWithRetries({
    key,
    body: monthPrompt(input.summary),
    fetchImpl,
    timeoutMs,
    maxTokens: MONTH_MAX_TOKENS,
    format: monthResponseFormat(),
    accept: (json) => {
      if (!json || typeof json !== "object") return { ok: false, reason: "bad_json", detail: "unreadable JSON" };
      const direction = parseMonthDirection(json);
      if (!direction) {
        const detail = monthShapeDetail(json);
        return { ok: false, reason: "schema", detail, errors: [detail] };
      }
      const schemaErrors = monthSchemaErrors(direction, json);
      if (schemaErrors.length) return { ok: false, reason: "schema", detail: schemaErrors[0]!, errors: schemaErrors };
      const english = englishKoPath(direction);
      if (english) return { ok: false, reason: "language", detail: english, errors: [english] };
      return { ok: true, value: direction };
    },
  });
  return result.ok ? { ok: true, direction: result.value, trace: result.trace } : result;
}

/** Did attempt two stay inside the repair scope? Logged, not enforced. */
function repairReport(previousErrors: readonly string[], previous: WeekDraft, next: WeekDraft) {
  const plan = retryRepairPlan(previousErrors);
  const changed = changedSessions(previous, next);
  const allowance = plan.week_level_requirements.length ? 1 : 0;
  const outOfScope = changed.filter((day) => plan.immutable_sessions.includes(day));
  return {
    immutable_sessions: plan.immutable_sessions,
    repair_sessions: plan.repair_sessions,
    changed_sessions: changed,
    out_of_scope_changes: outOfScope,
    within_scope: outOfScope.length <= allowance,
  };
}

export async function authorWeek(input: {
  summary: ProgrammingSummary;
  month: MonthDirection;
  weekIndex: WeekIndex;
  recent: readonly StoredStructure[];
  recentLiftMaps?: readonly string[];
  key?: string | null;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}): Promise<{ ok: true; draft: WeekDraft; trace: AuthorTrace } | { ok: false; reason: FallbackReason; trace: AuthorTrace }> {
  const key = input.key === undefined ? serverModelKey() : input.key;
  if (!key) return { ok: false, reason: "no_model", trace: noModelTrace() };
  const fetchImpl = input.fetchImpl ?? fetch;
  const timeoutMs = input.timeoutMs ?? weeklyTimeoutMs();
  const context = {
    previousActual: input.summary.previous_week?.actual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
  };
  const promptInput = {
    summary: input.summary,
    month: input.month,
    weekIndex: input.weekIndex,
    recent: input.recent,
  };
  let previousErrors: string[] = [];
  const result = await authorWithRetries({
    key,
    body: weekPrompt(promptInput),
    fetchImpl,
    timeoutMs,
    maxTokens: WEEK_MAX_TOKENS,
    format: weekResponseFormat(),
    retryBody: (errors, previous) => weekPrompt({ ...promptInput, retryErrors: errors, previousDraft: previous }),
    accept: (json, meta) => {
      const judged = judgeWeek(json, input.month, input.weekIndex, input.recent, context);
      const draft = judged.ok ? judged.draft : parseWeekDraft(normalizeWeekPayload(json).value);
      const previousDraft = meta.previous ? parseWeekDraft(normalizeWeekPayload(meta.previous).value) : null;
      const retryRepair =
        meta.attempt > 1 && previousDraft && draft && previousErrors.length
          ? repairReport(previousErrors, previousDraft, draft)
          : null;
      previousErrors = judged.ok ? [] : judged.errors;
      const diagnostics = {
        similarity: draft ? similarityDiagnostics(draft, input.recent) : null,
        errors: judged.ok ? [] : judged.errors,
        failed_constraints: judged.ok ? [] : structureValidationErrors(judged.errors),
        failure_briefs: judged.ok ? [] : constraintFailureBriefs(judged.errors),
        repair_plan: judged.ok ? null : retryRepairPlan(judged.errors),
        field_trace: sessionFieldTrace(json, draft),
        retry_repair: retryRepair,
      };
      if (!judged.ok) {
        return {
          ok: false,
          reason: judged.reason,
          detail: judged.detail,
          errors: judged.errors,
          normalizations: judged.normalizations,
          diagnostics,
        };
      }
      return { ok: true, value: judged.draft, detail: judged.detail, normalizations: judged.normalizations, diagnostics };
    },
  });
  return result.ok ? { ok: true, draft: result.value, trace: result.trace } : result;
}
