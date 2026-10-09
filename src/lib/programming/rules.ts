import { OFFICIAL_LOAD_PAIRS } from "../month-plan/shared-line";
import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { isWodPurpose } from "../wod/purpose";
import { completeMonthDirection } from "./month-direction";
import { strengthIsHeavy } from "./schemes";
import { safetyViolations } from "./coaching/stage15/safety-policy";
import { benchmarkCountAllowed, longConditioningCountAllowed } from "./coaching/stage15/week-policy";
import { exampleSets, legacySchemeForMethod, prescriptionGuide, validateStrengthPrescription } from "./strength-methods";
import type { WeekActual } from "./summary";
import {
  EQUIPMENT,
  LOWER_BODY_LIFTS,
  MOVEMENT_PATTERNS,
  SIMILARITY_CONFIG,
  STIMULI,
  isLowerBodyLift,
  isScheme,
  isWeekIndex,
  type ConditioningDraft,
  type Equipment,
  type MonthDirection,
  type MovementPattern,
  type SessionDraft,
  type SimilarityFeature,
  type Stimulus,
  type StoredStructure,
  type WeekDraft,
} from "./types";

const BANNED_KEYS = new Set([
  "weight_kg",
  "weightkg",
  "load_kg",
  "loadkg",
  "one_rm_kg",
  "onermkg",
  "kg",
  "candidate_id",
  "candidateid",
]);

const MONTH_BANNED_KEYS = new Set(["sessions", "days", "movements", "wods", "pieces", "candidate_id", "candidateid"]);

const LOAD_KEYS = new Set(["wall_ball", "kb_swing", "kettlebell", "box_jump"]);

const KG_IN_TEXT = /\d+(?:\.\d+)?\s*kg/i;

const PULL_KEYS: Record<"snatch" | "clean" | "deadlift", string[]> = {
  snatch: ["snatch", "power_snatch"],
  clean: ["clean", "power_clean", "hang_power_clean"],
  deadlift: ["deadlift"],
};

export type Judge =
  | { ok: true; draft: WeekDraft; detail: string | null; errors: string[]; normalizations: string[] }
  | {
      ok: false;
      reason: JudgeFailure;
      detail: string;
      errors: string[];
      normalizations: string[];
    };

export type JudgeFailure = "schema" | "invented_weight" | "language" | "rule_break" | "feedback" | "weekday_pattern" | "too_similar";

const ALLOWED_LATIN = /\b(?:AMRAP|EMOM|Rx|Scaled|Benchmark|Deload|5\/3\/1|531)\b/gi;

/** Share of Hangul among Hangul and Latin letters. Allowed workout tokens are removed first. */
export const KOREAN_RATIO_MIN = 0.7;

export function koreanRatio(text: string): number {
  const stripped = text.replace(ALLOWED_LATIN, " ");
  const hangul = stripped.match(/[\uac00-\ud7a3]/g)?.length ?? 0;
  const latin = stripped.match(/[A-Za-z]/g)?.length ?? 0;
  if (latin === 0) return 1;
  return hangul / (hangul + latin);
}

/**
 * Method names the month model copies into Korean fields.
 * Replacing them does not change scheme or strength_method.
 * A field that is still under the Korean ratio after this pass stays unchanged.
 */
const MONTH_LANGUAGE_TOKENS: Array<[RegExp, string]> = [
  [/\bINTENSITY_BLOCK\b/g, "강도"],
  [/\bDELOAD_RECOVERY\b/g, "회복"],
  [/\bTECHNIQUE_SKILL\b/g, "기술"],
  [/\bACCUMULATION\b/g, "축적"],
  [/\bPROGRESSION\b/g, "진행"],
  [/\bEMPHASIS\b/g, "강조"],
  [/\bhigh_rep\b/gi, "고반복"],
  [/\btechnical\b/gi, "기술"],
  [/\bintervals\b/gi, "인터벌"],
  [/\binterval\b/gi, "인터벌"],
  [/\bvariation\b/gi, "변형"],
  [/\bengine\b/gi, "엔진"],
];

export function rewriteMonthLanguageTokens(text: string): string {
  let next = text;
  for (const [pattern, korean] of MONTH_LANGUAGE_TOKENS) next = next.replace(pattern, korean);
  return next;
}

/** Rewrite only Korean fields that clear the ratio after known method tokens are replaced. */
export function repairMonthLanguage(direction: MonthDirection): { direction: MonthDirection; normalizations: string[] } {
  const normalizations: string[] = [];
  const rewrite = (path: string, text: string): string => {
    if (koreanRatio(text) >= KOREAN_RATIO_MIN) return text;
    const next = rewriteMonthLanguageTokens(text);
    if (next === text || koreanRatio(next) < KOREAN_RATIO_MIN) return text;
    normalizations.push(`${path} latin method tokens rewritten`);
    return next;
  };
  return {
    direction: {
      ...direction,
      focus_ko: rewrite("focus_ko", direction.focus_ko),
      why_ko: rewrite("why_ko", direction.why_ko),
      week_themes: direction.week_themes.map((theme, index) => ({
        ...theme,
        theme_ko: rewrite(`week_themes[${index}].theme_ko`, theme.theme_ko),
      })),
    },
    normalizations,
  };
}

/** A *_ko, focus, or scheme_note string whose Korean ratio is below the server minimum. */
export function englishKoPath(value: unknown, path = ""): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = englishKoPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (typeof child === "string" && (key.endsWith("_ko") || key === "focus" || key === "scheme_note")) {
      const ratio = koreanRatio(child);
      if (ratio < KOREAN_RATIO_MIN) return ratio === 0 ? `${next} is English` : `${next} korean ratio ${ratio.toFixed(2)}`;
      continue;
    }
    const found = englishKoPath(child, next);
    if (found) return found;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function bannedKey(value: unknown, banned: Set<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = bannedKey(item, banned);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of Object.keys(value)) {
    if (banned.has(key.toLowerCase())) return key;
    const found = bannedKey(value[key], banned);
    if (found) return found;
  }
  return null;
}

function textHasInventedKg(value: unknown): boolean {
  const seen = new Set<unknown>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const current = stack.pop();
    if (typeof current === "string") {
      if (KG_IN_TEXT.test(current)) return true;
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      stack.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    const movementKey = typeof record.key === "string" ? record.key : "";
    for (const [key, child] of Object.entries(record)) {
      if (movementKey && LOAD_KEYS.has(movementKey) && key === "amount") continue;
      stack.push(child);
    }
  }
  return false;
}

function asInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value;
}

function asBool(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseSets(value: unknown): WeekDraft["sessions"][number]["strength"] {
  if (!isRecord(value)) return null;
  const lift = value.lift;
  if (lift !== "squat" && lift !== "ohp" && lift !== "bench" && lift !== "deadlift") return null;
  if (!Array.isArray(value.sets) || value.sets.length === 0) return null;
  const sets = [];
  for (const row of value.sets) {
    if (!isRecord(row)) return null;
    const percent = row.percent_of_tm;
    const reps = asInt(row.reps);
    const amrap = asBool(row.amrap);
    if (typeof percent !== "number" || !Number.isFinite(percent) || reps == null || amrap == null) return null;
    sets.push({ percent_of_tm: percent, reps, amrap });
  }
  return { lift, sets };
}

function parseStringList<T extends string>(value: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const out: T[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !(allowed as readonly string[]).includes(item)) return null;
    if (!out.includes(item as T)) out.push(item as T);
  }
  return out;
}

function parseConditioning(value: unknown): ConditioningDraft | null {
  if (!isRecord(value)) return null;
  const benchmark = asBool(value.benchmark);
  const format = value.format;
  const timeDomain = value.time_domain;
  const stimulus = value.stimulus;
  const patterns = parseStringList(value.movement_patterns, MOVEMENT_PATTERNS);
  const equipment = parseStringList(value.equipment, EQUIPMENT);
  const rep = asString(value.rep_structure);
  const rest = asString(value.work_rest_structure);
  const duration = asInt(value.duration_min);
  const volume = value.volume;
  const intensity = value.intensity;
  const longPiece = asBool(value.long_conditioning);
  const purpose = asString(value.purpose);
  if (benchmark == null || patterns == null || equipment == null || !rep || !rest || duration == null || longPiece == null) {
    return null;
  }
  if (!purpose || !isWodPurpose(purpose)) return null;
  if (format !== "amrap" && format !== "for_time" && format !== "emom" && format !== "intervals") return null;
  if (timeDomain !== "short" && timeDomain !== "medium" && timeDomain !== "long") return null;
  if (stimulus !== null && (typeof stimulus !== "string" || !(STIMULI as readonly string[]).includes(stimulus))) return null;
  if (volume !== "low" && volume !== "moderate" && volume !== "high") return null;
  if (intensity !== "light" && intensity !== "moderate" && intensity !== "heavy") return null;
  if (!Array.isArray(value.movements) || value.movements.length === 0) return null;
  const movements = [];
  for (const row of value.movements) {
    if (!isRecord(row)) return null;
    const key = asString(row.key);
    const amount = asString(row.amount);
    const name = asString(row.name_ko);
    if (!key || !amount || !name) return null;
    movements.push({ key, amount, name_ko: name });
  }
  return {
    benchmark,
    format,
    time_domain: timeDomain,
    stimulus: stimulus as Stimulus | null,
    movement_patterns: patterns,
    movements,
    equipment,
    rep_structure: rep,
    work_rest_structure: rest,
    duration_min: duration,
    volume,
    intensity,
    long_conditioning: longPiece,
    purpose,
  };
}

const LIFT_VALUES = ["squat", "ohp", "bench", "deadlift"] as const;

export function parseWeekDraft(value: unknown): WeekDraft | null {
  if (!isRecord(value)) return null;
  const intentRaw = value.intent;
  const sessionsRaw = value.sessions;
  if (!isRecord(intentRaw) || !Array.isArray(sessionsRaw)) return null;
  const why = asString(intentRaw.why_ko);
  const focus = asString(intentRaw.focus);
  const note = asString(intentRaw.scheme_note);
  if (!why || !focus || !note) return null;
  const sessions: SessionDraft[] = [];
  for (const row of sessionsRaw) {
    if (!isRecord(row)) return null;
    const day = row.day;
    if (typeof day !== "string" || !(DAY_ORDER as string[]).includes(day)) return null;
    const rest = asBool(row.rest);
    const optional = asBool(row.optional);
    const warmup = asInt(row.warmup_min);
    const warmupKo = typeof row.warmup_ko === "string" ? row.warmup_ko.trim() : null;
    if (rest == null || optional == null || warmup == null || warmupKo == null) return null;
    const strength = row.strength == null ? null : parseSets(row.strength);
    if (row.strength != null && !strength) return null;
    const conditioning = row.conditioning == null ? null : parseConditioning(row.conditioning);
    if (row.conditioning != null && !conditioning) return null;
    const metconPurpose = asString(row.metcon_purpose) || conditioning?.purpose || null;
    const equipment = Array.isArray(row.equipment)
      ? parseStringList(row.equipment, EQUIPMENT) ?? []
      : [];
    sessions.push({
      day: day as DayKey,
      rest,
      optional,
      warmup_min: warmup,
      warmup_ko: warmupKo,
      strength,
      conditioning,
      strength_purpose: asString(row.strength_purpose),
      strength_volume: row.strength_volume === "low" || row.strength_volume === "moderate" || row.strength_volume === "high" ? row.strength_volume : null,
      strength_intensity: row.strength_intensity === "light" || row.strength_intensity === "moderate" || row.strength_intensity === "heavy" ? row.strength_intensity : null,
      metcon_purpose: metconPurpose,
      metcon_format: row.metcon_format === "amrap" || row.metcon_format === "for_time" || row.metcon_format === "emom" || row.metcon_format === "intervals" ? row.metcon_format : null,
      time_domain: row.time_domain === "short" || row.time_domain === "medium" || row.time_domain === "long" ? row.time_domain : null,
      stimulus: row.stimulus === null ? null : typeof row.stimulus === "string" && (STIMULI as readonly string[]).includes(row.stimulus) ? (row.stimulus as Stimulus) : null,
      movement_combination: asString(row.movement_combination),
      equipment,
      volume: row.volume === "low" || row.volume === "moderate" || row.volume === "high" ? row.volume : null,
      intensity: row.intensity === "light" || row.intensity === "moderate" || row.intensity === "heavy" ? row.intensity : null,
      expected_duration: asInt(row.expected_duration),
    });
  }
  return { intent: { why_ko: why, focus, scheme_note: note }, sessions };
}

/** Keys the generation log already drops. They are not a week shape. */
const PRIVATE_TOP_LEVEL = new Set([
  "email",
  "e-mail",
  "name",
  "user_name",
  "username",
  "member_name",
  "member",
  "password",
  "password_hash",
  "phone",
]);

/** Top-level contract check. Wrappers such as class_week, week, and days are rejected here. */
export function describeWeekParse(raw: unknown): { ok: boolean; top_level_keys: string[]; errors: string[] } {
  if (!isRecord(raw)) return { ok: false, top_level_keys: [], errors: ["unreadable week"] };
  const keys = Object.keys(raw);
  const extra = keys.filter((key) => key !== "intent" && key !== "sessions" && !PRIVATE_TOP_LEVEL.has(key.toLowerCase()));
  const missing = (["intent", "sessions"] as const).filter((key) => !(key in raw));
  if (extra.length || missing.length) {
    return {
      ok: false,
      top_level_keys: keys,
      errors: [`top-level keys must be intent and sessions; found ${keys.join(", ") || "(empty)"}`],
    };
  }
  if (parseWeekDraft(raw)) return { ok: true, top_level_keys: keys, errors: [] };
  return { ok: false, top_level_keys: keys, errors: explainWeekShape(raw) };
}

function explainWeekShape(raw: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!isRecord(raw.intent)) errors.push("intent must include why_ko, focus, and scheme_note");
  else if (!asString(raw.intent.why_ko) || !asString(raw.intent.focus) || !asString(raw.intent.scheme_note)) {
    errors.push("intent must include why_ko, focus, and scheme_note");
  }
  if (!Array.isArray(raw.sessions)) {
    errors.push("sessions must be an array");
    return errors.length ? errors : ["unreadable week"];
  }
  const days = new Set<string>();
  for (const row of raw.sessions) {
    if (!isRecord(row)) {
      errors.push("a session is not an object");
      continue;
    }
    const day = typeof row.day === "string" ? row.day : "session";
    if (typeof row.day === "string") days.add(row.day);
    if (isRecord(row.strength) && typeof row.strength.lift === "string" && !(LIFT_VALUES as readonly string[]).includes(row.strength.lift)) {
      errors.push(`${day} lift ${row.strength.lift} is not allowed`);
    }
    if (isRecord(row.conditioning) && !Array.isArray(row.conditioning.equipment)) {
      errors.push(`${day} conditioning.equipment is missing`);
    }
    if (isRecord(row.conditioning)) {
      const purpose = typeof row.conditioning.purpose === "string" ? row.conditioning.purpose : "";
      if (!isWodPurpose(purpose)) errors.push(`${day} conditioning.purpose must be 1–2 Korean sentences`);
    }
  }
  if (raw.sessions.length !== 7) errors.push("week needs seven days");
  for (const day of DAY_ORDER) {
    if (!days.has(day)) errors.push(`${day} is missing`);
  }
  if (!errors.length) errors.push("unreadable week");
  return errors;
}

const MONTH_WRAPPERS = ["month_direction_only", "month_direction", "direction", "month"] as const;

export const MONTH_REQUIRED_KEYS = [
  "scheme",
  "focus_ko",
  "why_ko",
  "monthly_goal",
  "primary_block",
  "secondary_goal",
  "strength_direction",
  "conditioning_direction",
  "skill_direction",
  "volume_direction",
  "intensity_direction",
  "benchmark_direction",
  "variation_direction",
  "fatigue_direction",
  "weekly_direction",
  "evaluation_targets",
  "week_themes",
  "long_conditioning_weeks",
  "benchmark_week",
  "constraints",
  "strength_method",
  "method_rationale",
  "method_constraints",
  "progression_notes",
  "block_type",
  "weekly_progression",
  "deload_strategy",
] as const;

/** Pull a wrapped month object up to the top level. A real month object is left as-is. */
export function unwrapMonthPayload(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (isScheme(value.scheme) || typeof value.focus_ko === "string" || Array.isArray(value.week_themes)) return value;
  for (const key of MONTH_WRAPPERS) {
    if (isRecord(value[key])) return unwrapMonthPayload(value[key]);
  }
  return value;
}

export function monthShapeDetail(value: unknown): string {
  const body = unwrapMonthPayload(value);
  if (!isRecord(body)) return "month JSON is not an object";
  const missing = MONTH_REQUIRED_KEYS.filter((key) => body[key] == null || body[key] === "");
  if (missing.length) return `missing ${missing[0]}`;
  if (!isScheme(body.scheme)) return "scheme is not a month block";
  return "month JSON is missing required keys";
}

export function parseMonthDirection(value: unknown): MonthDirection | null {
  if (!isRecord(value) && !isRecord(unwrapMonthPayload(value))) return null;
  const unwrapped = unwrapMonthPayload(value);
  if (!isRecord(unwrapped)) return null;
  const body = unwrapped;
  if (!isScheme(body.scheme)) return null;
  if (typeof body.strength_method !== "string" || !body.strength_method.trim()) return null;
  const focus = asString(body.focus_ko);
  const why = asString(body.why_ko);
  if (!focus || !why) return null;
  if (!Array.isArray(body.week_themes) || body.week_themes.length !== 4) return null;
  const themes = [];
  for (const row of body.week_themes) {
    if (!isRecord(row)) return null;
    const index = asInt(row.week_index);
    const theme = asString(row.theme_ko);
    if (index == null || !isWeekIndex(index) || !theme) return null;
    themes.push({ week_index: index, theme_ko: theme });
  }
  if (!Array.isArray(body.long_conditioning_weeks) || !Array.isArray(body.constraints)) return null;
  const longs: MonthDirection["long_conditioning_weeks"] = [];
  for (const item of body.long_conditioning_weeks) {
    if (typeof item !== "number" || !isWeekIndex(item)) return null;
    longs.push(item);
  }
  const benchmark = asInt(body.benchmark_week);
  if (benchmark == null || !isWeekIndex(benchmark)) return null;
  const constraints: string[] = [];
  for (const item of body.constraints) {
    if (typeof item !== "string" || !item.trim()) return null;
    constraints.push(item.trim());
  }
  const targets = Array.isArray(body.evaluation_targets)
    ? body.evaluation_targets.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : undefined;
  return completeMonthDirection({
    scheme: body.scheme,
    focus_ko: focus,
    why_ko: why,
    week_themes: themes,
    long_conditioning_weeks: longs,
    benchmark_week: benchmark,
    constraints,
    monthly_goal: typeof body.monthly_goal === "string" ? body.monthly_goal : undefined,
    primary_block: typeof body.primary_block === "string" ? body.primary_block : undefined,
    secondary_goal: typeof body.secondary_goal === "string" ? body.secondary_goal : undefined,
    strength_direction: typeof body.strength_direction === "string" ? body.strength_direction : undefined,
    conditioning_direction: typeof body.conditioning_direction === "string" ? body.conditioning_direction : undefined,
    skill_direction: typeof body.skill_direction === "string" ? body.skill_direction : undefined,
    volume_direction: typeof body.volume_direction === "string" ? body.volume_direction : undefined,
    intensity_direction: typeof body.intensity_direction === "string" ? body.intensity_direction : undefined,
    benchmark_direction: typeof body.benchmark_direction === "string" ? body.benchmark_direction : undefined,
    variation_direction: typeof body.variation_direction === "string" ? body.variation_direction : undefined,
    fatigue_direction: typeof body.fatigue_direction === "string" ? body.fatigue_direction : undefined,
    weekly_direction: typeof body.weekly_direction === "string" ? body.weekly_direction : undefined,
    evaluation_targets: targets,
    strength_method: typeof body.strength_method === "string" ? body.strength_method : undefined,
    method_rationale: typeof body.method_rationale === "string" ? body.method_rationale : undefined,
    method_constraints: typeof body.method_constraints === "string" ? body.method_constraints : undefined,
    progression_notes: typeof body.progression_notes === "string" ? body.progression_notes : undefined,
    block_type: typeof body.block_type === "string" ? body.block_type : undefined,
    weekly_progression: typeof body.weekly_progression === "string" ? body.weekly_progression : undefined,
    deload_strategy: typeof body.deload_strategy === "string" ? body.deload_strategy : undefined,
  });
}

export function monthSchemaErrors(direction: MonthDirection, raw: unknown): string[] {
  const errors: string[] = [];
  const banned = bannedKey(raw, new Set([...BANNED_KEYS, ...MONTH_BANNED_KEYS]));
  if (banned) errors.push(`month contains ${banned}`);
  if (textHasInventedKg(raw)) errors.push("month invents kg");
  const expectedScheme = legacySchemeForMethod(direction.strength_method);
  if (!direction.strength_method) errors.push("missing strength_method");
  else if (!expectedScheme) errors.push(`${direction.strength_method} is not an implemented strength method`);
  else if (expectedScheme !== direction.scheme) errors.push("scheme does not match strength_method");
  if (direction.long_conditioning_weeks.length !== 2) errors.push("long conditioning must be two weeks");
  if (new Set(direction.long_conditioning_weeks).size !== 2) errors.push("long conditioning weeks repeat");
  const weeks = new Set(direction.week_themes.map((row) => row.week_index));
  if (weeks.size !== 4) errors.push("week themes must cover four weeks");
  return errors;
}

/** Minute bounds for time_domain. The prompt copies these numbers. */
export const TIME_DOMAIN_RANGES = {
  short: { min: 1, max: 12 },
  medium: { min: 13, max: 29 },
  long: { min: 30, max: 40 },
} as const;

const DAY_LABEL: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export function dayLabel(day: string): string {
  return DAY_LABEL[day as DayKey] ?? day;
}

/**
 * Structural cleanup only. A null strength object cannot carry purpose, volume, or intensity.
 * Duration and time_domain are never rewritten here.
 */
export function normalizeWeekPayload(raw: unknown): { value: unknown; normalizations: string[] } {
  if (!isRecord(raw) || !Array.isArray(raw.sessions)) return { value: raw, normalizations: [] };
  const clone = structuredClone(raw) as Record<string, unknown>;
  const sessions = clone.sessions;
  if (!Array.isArray(sessions)) return { value: raw, normalizations: [] };
  const normalizations: string[] = [];
  for (const row of sessions) {
    if (!isRecord(row) || row.strength != null) continue;
    const cleared: string[] = [];
    for (const key of ["strength_purpose", "strength_volume", "strength_intensity"] as const) {
      if (row[key] != null) {
        cleared.push(key);
        row[key] = null;
      }
    }
    if (cleared.length) {
      const day = typeof row.day === "string" ? row.day : "session";
      normalizations.push(`${dayLabel(day)}: cleared ${cleared.join(", ")} because strength is null`);
    }
  }
  return { value: clone, normalizations };
}

/** Session-level copies of the strength and conditioning objects. Null on a training day is a reject. */
export const SESSION_LEVEL_FIELDS = [
  "metcon_purpose",
  "metcon_format",
  "time_domain",
  "stimulus",
  "movement_combination",
  "equipment",
  "volume",
  "intensity",
  "expected_duration",
] as const;

export type SessionFieldTrace = {
  day: string;
  missing_in_raw: string[];
  null_in_raw: string[];
  null_after_parse: string[];
  origin: "rest" | "complete" | "model_output" | "parser";
};

/**
 * Where a missing session field came from. The model wrote null or no key (model_output),
 * or the raw value existed and the parser dropped it (parser). Tells a prompt problem from a code problem.
 */
export function sessionFieldTrace(raw: unknown, draft: WeekDraft | null): SessionFieldTrace[] {
  const body = normalizeWeekPayload(raw).value;
  if (!isRecord(body) || !Array.isArray(body.sessions)) return [];
  const parsedByDay = new Map(draft?.sessions.map((session) => [session.day as string, session]) ?? []);
  const out: SessionFieldTrace[] = [];
  for (const row of body.sessions) {
    if (!isRecord(row) || typeof row.day !== "string") continue;
    const day = row.day;
    const missing: string[] = [];
    const nulls: string[] = [];
    for (const field of SESSION_LEVEL_FIELDS) {
      if (!(field in row)) missing.push(field);
      else if (row[field] == null || (Array.isArray(row[field]) && (row[field] as unknown[]).length === 0)) nulls.push(field);
    }
    const parsed = parsedByDay.get(day) ?? null;
    const afterParse: string[] = [];
    if (parsed) {
      for (const field of SESSION_LEVEL_FIELDS) {
        const value = parsed[field];
        if (value == null || (Array.isArray(value) && value.length === 0)) afterParse.push(field);
      }
    }
    const droppedByParser = afterParse.filter((field) => !missing.includes(field) && !nulls.includes(field));
    const origin: SessionFieldTrace["origin"] =
      row.rest === true ? "rest" : droppedByParser.length ? "parser" : missing.length || nulls.length ? "model_output" : "complete";
    out.push({ day, missing_in_raw: missing, null_in_raw: nulls, null_after_parse: afterParse, origin });
  }
  return out;
}

function timeDomainFits(conditioning: ConditioningDraft): boolean {
  const minutes = conditioning.duration_min;
  const range = TIME_DOMAIN_RANGES[conditioning.time_domain];
  return minutes >= range.min && minutes <= range.max;
}

const KG_MATCHES = /\d+(?:\.\d+)?\s*kg/gi;

/** The official pair for a movement, or null when the app defines no load for it. */
function officialKilograms(movementKey: string): string[] {
  const pair = OFFICIAL_LOAD_PAIRS[movementKey];
  if (!pair) return [];
  return [pair.male, pair.female].filter((value) => value.endsWith("kg")).map((value) => value.replace("kg", ""));
}

function inventedKgIn(text: string, allowed: readonly string[]): string[] {
  const found = text.match(KG_MATCHES) ?? [];
  return found.filter((token) => !allowed.includes(token.replace(/\s*kg$/i, "")));
}

export const INVENTED_WEIGHT_RETRY =
  "Do not invent prescribed kilogram values. Use the movement name without a weight unless the weight is explicitly provided by the allowed source.";

/**
 * A generated week never carries kilograms. The server adds the class wall ball, kettlebell,
 * and box loads on the screen. The one exception is a movement amount that repeats the
 * official pair for that same movement, which the rules week already writes.
 */
export function inventedWeightErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  const report = (day: DayKey | null, path: string, tokens: string[]) => {
    if (!tokens.length) return;
    const where = day ? `${dayLabel(day)}: ` : "";
    errors.push(`${where}invented prescribed weight "${tokens[0]}" in ${path}. ${INVENTED_WEIGHT_RETRY}`);
  };
  for (const [key, value] of Object.entries(draft.intent)) {
    if (typeof value !== "string") continue;
    report(null, `intent.${key}`, inventedKgIn(value, []));
  }
  const plan = draft.intent.plan;
  if (plan) {
    report(null, "intent.plan.adjustment_ko", inventedKgIn(plan.adjustment_ko, []));
    report(null, "intent.plan.quality.similarity_note_ko", inventedKgIn(plan.quality.similarity_note_ko, []));
    for (const day of plan.days) {
      report(null, `intent.plan.${day.day}.training_goal`, inventedKgIn(day.training_goal, []));
      if (day.notes_ko) report(null, `intent.plan.${day.day}.notes_ko`, inventedKgIn(day.notes_ko, []));
    }
  }
  draft.sessions.forEach((session, index) => {
    const base = `sessions[${index}]`;
    const strings: Array<[string, string | null]> = [
      ["warmup_ko", session.warmup_ko],
      ["strength_purpose", session.strength_purpose],
      ["metcon_purpose", session.metcon_purpose],
      ["movement_combination", session.movement_combination],
    ];
    for (const [field, text] of strings) if (text) report(session.day, `${base}.${field}`, inventedKgIn(text, []));
    const conditioning = session.conditioning;
    if (!conditioning) return;
    for (const field of ["rep_structure", "work_rest_structure", "purpose"] as const) {
      report(session.day, `${base}.conditioning.${field}`, inventedKgIn(conditioning[field], []));
    }
    conditioning.movements.forEach((movement, movementIndex) => {
      const path = `${base}.conditioning.movements[${movementIndex}]`;
      report(session.day, `${path}.name_ko`, inventedKgIn(movement.name_ko, []));
      report(session.day, `${path}.amount`, inventedKgIn(movement.amount, officialKilograms(movement.key)));
    });
  });
  return errors;
}

export function weekSchemaErrors(draft: WeekDraft, raw: unknown): string[] {
  const errors: string[] = [];
  const banned = bannedKey(raw, BANNED_KEYS);
  if (banned) errors.push(`week contains ${banned}`);
  if (draft.sessions.length !== 7) errors.push("week needs seven days");
  const seen = new Set<string>();
  for (const session of draft.sessions) {
    if (seen.has(session.day)) errors.push(`duplicate ${session.day}`);
    seen.add(session.day);
    if (session.rest) {
      if (session.strength || session.conditioning) errors.push(`${session.day} rest still has work`);
      if (session.warmup_min !== 0) errors.push(`${session.day} rest has a warmup`);
      if (session.strength_purpose || session.metcon_purpose || session.expected_duration != null) {
        errors.push(`${session.day} rest still describes work`);
      }
      continue;
    }
    if (!session.metcon_purpose || !session.metcon_format || !session.time_domain || !session.movement_combination) {
      errors.push(`${session.day} is missing session fields`);
    }
    if (session.expected_duration == null || session.volume == null || session.intensity == null) {
      errors.push(`${session.day} is missing duration or load bands`);
    }
    if (session.equipment.length === 0) errors.push(`${session.day} lists no equipment`);
    if (session.strength) {
      if (!session.strength_purpose || !session.strength_volume || !session.strength_intensity) {
        errors.push(`${dayLabel(session.day)}: strength is present but strength_purpose, strength_volume, or strength_intensity is null`);
      }
    } else if (session.strength_purpose || session.strength_volume || session.strength_intensity) {
      const dangling = [
        session.strength_purpose ? "strength_purpose" : null,
        session.strength_volume ? "strength_volume" : null,
        session.strength_intensity ? "strength_intensity" : null,
      ].filter((item): item is string => item != null);
      errors.push(`${dayLabel(session.day)}: ${dangling.join(", ")} present but strength null`);
    }
    if (session.warmup_min < 8 || session.warmup_min > 12) errors.push(`${session.day} warmup is not 8–12`);
    if (!session.warmup_ko) errors.push(`${session.day} warmup text is empty`);
    if (!session.strength && !session.conditioning) errors.push(`${session.day} has no work`);
    if (!session.conditioning) continue;
    if (!isWodPurpose(session.conditioning.purpose)) {
      errors.push(`${session.day} conditioning.purpose must be 1–2 Korean sentences`);
    }
    if (session.metcon_format && session.metcon_format !== session.conditioning.format) {
      errors.push(`${session.day} metcon format does not match`);
    }
    if (session.time_domain && session.time_domain !== session.conditioning.time_domain) {
      errors.push(`${session.day} time domain does not match`);
    }
    if (session.volume && session.volume !== session.conditioning.volume) errors.push(`${session.day} volume does not match`);
    if (session.intensity && session.intensity !== session.conditioning.intensity) {
      errors.push(`${session.day} intensity does not match`);
    }
    if (session.expected_duration != null && session.expected_duration !== session.conditioning.duration_min) {
      errors.push(`${session.day} expected duration does not match`);
    }
    if ((session.stimulus ?? null) !== (session.conditioning.stimulus ?? null)) {
      errors.push(`${session.day} stimulus does not match`);
    }
    if (!timeDomainFits(session.conditioning)) {
      const domain = session.conditioning.time_domain;
      const range = TIME_DOMAIN_RANGES[domain];
      errors.push(
        `${dayLabel(session.day)}: time_domain=${domain} duration=${session.conditioning.duration_min} is outside ${range.min}–${range.max}`,
      );
    }
    if (session.conditioning.long_conditioning !== (session.conditioning.time_domain === "long")) {
      errors.push(`${dayLabel(session.day)}: long flag does not match duration`);
    }
    if (session.conditioning.stimulus == null || !(STIMULI as readonly string[]).includes(session.conditioning.stimulus)) {
      errors.push(`${dayLabel(session.day)}: conditioning present but stimulus null; allowed ${STIMULI.join(", ")}`);
    }
  }
  if (seen.size !== 7) errors.push("a day is missing");
  return errors;
}

type Exposure = {
  day: DayKey;
  heavySquat: boolean;
  heavyDeadlift: boolean;
  heavyPress: boolean;
  heavySnatch: boolean;
  heavyClean: boolean;
};

function movementKeys(session: SessionDraft): string[] {
  return session.conditioning?.movements.map((movement) => movement.key) ?? [];
}

function pullIsHeavy(session: SessionDraft, kind: "snatch" | "clean" | "deadlift"): boolean {
  const keys = movementKeys(session);
  if (!keys.some((key) => PULL_KEYS[kind].includes(key))) return false;
  const conditioning = session.conditioning;
  if (!conditioning) return false;
  return conditioning.stimulus === "heavy" || conditioning.intensity === "heavy";
}

export function sessionLoad(session: SessionDraft): Exposure {
  return exposure(session);
}

function exposure(session: SessionDraft): Exposure {
  const heavy = session.strength ? strengthIsHeavy(session.strength.sets) : false;
  const lift = session.strength?.lift;
  return {
    day: session.day,
    heavySquat: heavy && lift === "squat",
    heavyDeadlift: (heavy && lift === "deadlift") || pullIsHeavy(session, "deadlift"),
    heavyPress: heavy && (lift === "ohp" || lift === "bench"),
    heavySnatch: pullIsHeavy(session, "snatch"),
    heavyClean: pullIsHeavy(session, "clean"),
  };
}

function byDay(draft: WeekDraft): Map<DayKey, SessionDraft> {
  return new Map(draft.sessions.map((session) => [session.day, session]));
}

export function constitutionViolations(
  draft: WeekDraft,
  month: MonthDirection,
  weekIndex: 1 | 2 | 3 | 4,
  actual?: WeekActual | null,
): string[] {
  const errors = [...weekSchemaErrors(draft, draft)];
  const sessions = byDay(draft);
  const exposures = new Map<DayKey, Exposure>();
  for (const day of DAY_ORDER) {
    const session = sessions.get(day);
    if (!session) continue;
    exposures.set(day, exposure(session));
    if (session.strength) {
      const problem = validateStrengthPrescription(month.strength_method || month.scheme, session.strength.sets, {
        day,
        weekIndex,
        lift: session.strength.lift,
        fatigue: strengthCheckFatigue(session.strength.lift, actual),
      });
      if (problem) errors.push(problem);
    }
  }
  errors.push(
    ...safetyViolations(
      DAY_ORDER.map((day) => {
        const session = sessions.get(day);
        const load = exposures.get(day);
        if (!session || !load) return null;
        return {
          day,
          heavySquat: load.heavySquat,
          heavyDeadlift: load.heavyDeadlift,
          heavyPress: load.heavyPress,
          heavySnatch: load.heavySnatch,
          heavyClean: load.heavyClean,
          longConditioning: Boolean(session.conditioning?.long_conditioning),
        };
      }),
    ),
  );
  const training = draft.sessions.filter((session) => !session.rest);
  for (let index = 1; index < training.length; index += 1) {
    const previous = training[index - 1]!.conditioning?.stimulus;
    const current = training[index]!.conditioning?.stimulus;
    if (previous && current && previous === current) {
      errors.push(`stimulus ${current} repeats on ${training[index]!.day}`);
    }
  }
  const longs = draft.sessions.filter((session) => session.conditioning?.long_conditioning);
  const expectsLong = month.long_conditioning_weeks.includes(weekIndex);
  if (!longConditioningCountAllowed(expectsLong, longs.length)) {
    errors.push(
      expectsLong
        ? `this week needs one long conditioning piece; weekly_requirements.long_conditioning_sessions_min=1 current=${longs.length} long means ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} minutes`
        : "this week is not a long-conditioning week",
    );
  }
  for (const session of longs) {
    const minutes = session.conditioning?.duration_min ?? 0;
    if (minutes < 30 || minutes > 40) errors.push(`${session.day} long piece is not 30–40 minutes`);
  }
  const benchmarks = draft.sessions.filter((session) => session.conditioning?.benchmark);
  const benchmarkRequired = weekIndex === month.benchmark_week;
  if (!benchmarkCountAllowed(benchmarkRequired, benchmarks.length)) {
    errors.push(benchmarkRequired ? "benchmark week needs one benchmark" : "benchmark is only on the benchmark week");
  }
  return errors;
}

function listKey(values: readonly string[]): string {
  return [...values].sort().join("|");
}

/** One comparable token per configured feature. Movement names are not a feature. */
function featureValue(structure: StoredStructure, feature: SimilarityFeature): string {
  switch (feature) {
    case "format":
      return structure.format;
    case "time_domain":
      return structure.time_domain;
    case "stimulus":
      return structure.stimulus ?? "";
    case "movement_pattern":
      return listKey(structure.movement_patterns);
    case "equipment":
      return listKey(structure.equipment);
    case "volume":
      return structure.volume;
    case "rep_structure":
      return structure.rep_structure;
    case "work_rest_structure":
      return structure.work_rest_structure;
    case "duration":
      return String(structure.duration_min);
    case "intensity":
      return structure.intensity;
  }
}

/** Sum of weights for features that match. Weight 0 features stay out until the config turns them on. */
export function similarityMatch(left: StoredStructure, right: StoredStructure): { score: number; matched: SimilarityFeature[] } {
  const matched: SimilarityFeature[] = [];
  let score = 0;
  for (const feature of Object.keys(SIMILARITY_CONFIG.features) as SimilarityFeature[]) {
    const weight = SIMILARITY_CONFIG.features[feature] ?? 0;
    if (weight <= 0) continue;
    if (featureValue(left, feature) === featureValue(right, feature)) {
      score += weight;
      matched.push(feature);
    }
  }
  return { score, matched };
}

export function similarityScore(left: StoredStructure, right: StoredStructure): number {
  return similarityMatch(left, right).score;
}

export type SimilarityComparison = {
  candidate_day: string;
  compared_day: string;
  compared_scope: "same_week" | "recent";
  score: number;
  threshold: number;
  matched: SimilarityFeature[];
  similar: boolean;
};

function comparison(
  left: StoredStructure,
  right: StoredStructure,
  scope: SimilarityComparison["compared_scope"],
): SimilarityComparison {
  const { score, matched } = similarityMatch(left, right);
  const exempt = left.benchmark || right.benchmark;
  return {
    candidate_day: left.day,
    compared_day: right.day,
    compared_scope: scope,
    score: exempt ? 0 : score,
    threshold: SIMILARITY_CONFIG.threshold,
    matched: exempt ? [] : matched,
    similar: !exempt && score >= SIMILARITY_CONFIG.threshold,
  };
}

/** Benchmarks are measurement, so they are never a structural duplicate. */
export function structurallySimilar(left: StoredStructure, right: StoredStructure): boolean {
  if (left.benchmark || right.benchmark) return false;
  return similarityScore(left, right) >= SIMILARITY_CONFIG.threshold;
}

export function toStructure(session: SessionDraft): StoredStructure | null {
  const conditioning = session.conditioning;
  if (!conditioning) return null;
  return {
    day: session.day,
    format: conditioning.format,
    time_domain: conditioning.time_domain,
    stimulus: conditioning.stimulus,
    movement_patterns: conditioning.movement_patterns,
    movements: conditioning.movements,
    equipment: conditioning.equipment,
    rep_structure: conditioning.rep_structure,
    work_rest_structure: conditioning.work_rest_structure,
    duration_min: conditioning.duration_min,
    volume: conditioning.volume,
    intensity: conditioning.intensity,
    benchmark: conditioning.benchmark,
    long_conditioning: conditioning.long_conditioning,
  };
}

/** Every same-week and recent pair, including the closest miss. Threshold is not changed here. */
export function similarityDiagnostics(draft: WeekDraft, recent: readonly StoredStructure[]): {
  threshold: number;
  hits: SimilarityComparison[];
  closest: SimilarityComparison | null;
} {
  const fresh = draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null && !row.benchmark);
  const pairs: SimilarityComparison[] = [];
  for (let index = 0; index < fresh.length; index += 1) {
    for (let other = index + 1; other < fresh.length; other += 1) {
      pairs.push(comparison(fresh[index]!, fresh[other]!, "same_week"));
    }
    for (const prior of recent) {
      if (prior.benchmark) continue;
      pairs.push(comparison(fresh[index]!, prior, "recent"));
    }
  }
  const hits = pairs.filter((pair) => pair.similar);
  const closest = pairs.reduce<SimilarityComparison | null>(
    (best, pair) => (best == null || pair.score > best.score ? pair : best),
    null,
  );
  return { threshold: SIMILARITY_CONFIG.threshold, hits, closest };
}

export function similarityViolations(draft: WeekDraft, recent: readonly StoredStructure[]): string[] {
  return similarityDiagnostics(draft, recent).hits.map((hit) => {
    const matched = hit.matched.join(",");
    if (hit.compared_scope === "same_week") {
      return `${hit.candidate_day} and ${hit.compared_day} are structurally similar score=${hit.score} matched=${matched}`;
    }
    return `${hit.candidate_day} matches a recent structure score=${hit.score} matched=${matched}`;
  });
}

export type WeekBurden = {
  lower_strength_sessions: number;
  lower_strength_volume: number;
  heavy_lower_sessions: number;
  lower_body_metcon_exposure: number;
  strength_intensity_sum: number;
};

export type WeekCheckContext = {
  previousActual?: WeekActual | null;
  recentLiftMaps?: readonly string[];
};

const LOWER_LIFTS = new Set<MainLift>(LOWER_BODY_LIFTS);
/**
 * Lower-body programming was cut. The subject is 하체 and the action is a verb
 * that reduces volume, load, sets, intensity, or work. "피로가 낮다" is not that action.
 */
const REDUCED_INTENT =
  /하체(?:[^.。\n]{0,48}?)(?:볼륨|부하|세트|강도|훈련량|부담)(?:을|를|이|가)?\s*(?:줄(?:이|였|인|임|여|입)|낮(?:춰|추|춘|췄|춥)|감소)|하체(?:를|을)?\s*(?:줄(?:이|였|인|임|여|입)|낮(?:춰|추|춘|췄|춥)|감소)/;

/** True when the text says the lower-body prescription itself was reduced. */
export function mentionsReducedLowerIntent(text: string): boolean {
  return REDUCED_INTENT.test(text);
}

/**
 * Fatigue passed to the strength method.
 * Reported fatigue is the signal. Planned or recorded volume does not choose it.
 * Squat and deadlift share that level. Upper-body lifts stay on the method.
 */
export function strengthCheckFatigue(lift: MainLift, actual: WeekActual | null | undefined): "high" | "low" | "unknown" {
  const level = previousLowerFatigue(actual);
  if (isLowerBodyLift(lift) && (level === "high" || level === "low")) return level;
  return "unknown";
}

export function previousLowerFatigue(actual: WeekActual | null | undefined): "high" | "moderate" | "low" | "unknown" {
  const signal = actual?.class_summary?.fatigue_signal;
  if (signal === "high" || signal === "moderate" || signal === "low") return signal;
  const rated = (actual?.days ?? [])
    .map((day) => day.fatigue)
    .filter((value): value is "high" | "moderate" | "low" => value === "high" || value === "moderate" || value === "low");
  if (rated.includes("high")) return "high";
  if (rated.includes("moderate")) return "moderate";
  if (rated.length > 0 && rated.every((value) => value === "low")) return "low";
  return "unknown";
}

/**
 * Server-computed limits. The weekly prompt names this object hard_constraints.
 * A number is a maximum. Exceeding it is a reject, not a suggestion.
 * `guidance` is preference. `programming_space` is the boundary, not a weekday plan.
 */
export function hardConstraints(actual: WeekActual | null | undefined) {
  const level = previousLowerFatigue(actual);
  const high = level === "high";
  const heavyMax = high ? 1 : null;
  const metcon = high ? ("avoid" as const) : ("allowed" as const);
  return {
    authority: "MUST NOT EXCEED" as const,
    previous_lower_fatigue: level,
    previous_volume: actual?.class_summary?.actual_volume ?? null,
    previous_intensity: actual?.class_summary?.actual_intensity ?? null,
    allowed_strength_sets: high ? "method_fatigue_limit" : "method_prescription",
    heavy_lower_sessions_max: heavyMax,
    heavy_lower_metcon: metcon,
    volume_direction: high ? "do_not_increase_lower" : "method_prescription",
    intensity_direction: high ? "do_not_exceed_method_fatigue_limit" : "method_prescription",
    heavy_lower_definition: "squat or deadlift with a top set at 85% or more",
    rule: high
      ? "A heavy lower session is squat or deadlift with a top set at 85% or more. That count MUST NOT EXCEED heavy_lower_sessions_max. Do not program a heavy lower metcon. Exceeding a limit is rejected."
      : level === "low"
        ? "Previous fatigue is low. Use the method's normal prescription. Do not drop squat or deadlift below that method, and do not switch methods."
        : "No high or low fatigue signal. Use the selected method's prescription. When a maximum is present it is mandatory.",
    guidance: {
      authority: "PREFER" as const,
      volume_direction: high ? "do_not_increase_lower" : "method_prescription",
      intensity_direction: high ? "do_not_exceed_method_fatigue_limit" : "method_prescription",
      note: high
        ? "favor recovery-friendly lower-body structure"
        : "Follow the selected method. This note is guidance, not an extra cap.",
    },
    programming_space: {
      heavy_lower_slots_available: heavyMax,
      heavy_lower_metcon: metcon,
      heavy_lower_definition: "squat or deadlift with a top set at 85% or more",
      ai_still_chooses: [
        "day",
        "lift",
        "session structure",
        "accessory",
        "conditioning",
        "stimulus",
        "equipment",
        "work_rest",
        "duration",
        "variation",
      ],
      does_not_assign: "The server does not assign a weekday or a lift.",
    },
  };
}

/** This week's structural requirements. Long conditioning is required or forbidden, never rewritten. */
export function weeklyRequirements(month: MonthDirection, weekIndex: 1 | 2 | 3 | 4) {
  const required = month.long_conditioning_weeks.includes(weekIndex) ? 1 : 0;
  const min = TIME_DOMAIN_RANGES.long.min;
  const max = TIME_DOMAIN_RANGES.long.max;
  return {
    long_conditioning_sessions_min: required,
    long_conditioning_sessions_max: required,
    long_time_domain: "long" as const,
    long_duration_min: { min, max },
    benchmark_sessions: month.benchmark_week === weekIndex ? 1 : 0,
    statement:
      required === 1
        ? `This is a hard weekly structural requirement. Required: exactly 1 long conditioning session. Long means ${min}–${max} minutes. The requirement must be satisfied in the actual sessions array. The server rejects a missing long session and does not rewrite duration.`
        : "This week requires exactly 0 long conditioning sessions. Do not add one. The server does not rewrite duration.",
  };
}

function sameSetList(left: readonly { percent_of_tm: number; reps: number; amrap: boolean }[] | null, right: typeof left): boolean {
  if (!left || !right || left.length !== right.length) return false;
  return left.every((set, index) => {
    const other = right[index]!;
    return set.percent_of_tm === other.percent_of_tm && set.reps === other.reps && set.amrap === other.amrap;
  });
}

/**
 * The one lower-body fatigue rule. The prompt, the validator, the retry brief, and tests read this.
 * applies_to is every lower-body main lift. A deadlift is not a separate interpretation.
 */
export function lowerBodyFatigueRule(method: string, weekIndex: 1 | 2 | 3 | 4, actual: WeekActual | null | undefined) {
  const level = previousLowerFatigue(actual);
  const fatigue = level === "high" || level === "low" ? level : "unknown";
  const sets = exampleSets(method, weekIndex, fatigue, "squat");
  const unrestricted = exampleSets(method, weekIndex, "unknown", "squat");
  const guide = prescriptionGuide(method, weekIndex, fatigue);
  const active = level === "high";
  const lifts = LOWER_BODY_LIFTS.join(" and ");
  return {
    name: "LOWER_BODY_FATIGUE_RULE" as const,
    applies_to: [...LOWER_BODY_LIFTS],
    mode: active ? ("fatigue_cut" as const) : ("method_prescription" as const),
    active,
    previous_lower_fatigue: level,
    sets,
    range: guide?.mode === "range" ? { percent: guide.percent, reps: guide.reps, set_count: guide.set_count } : null,
    forbidden_sets: active && unrestricted && !sameSetList(sets, unrestricted) ? unrestricted : null,
    statement: active
      ? `Previous lower-body fatigue is HIGH. lower_body_sets applies to ALL lower-body strength lifts: ${lifts}. Do not read the fatigue cut as squat-only. If deadlift is the lower session, deadlift uses these same sets. The unrestricted method sets are rejected on ${lifts} this week.`
      : `Previous lower-body fatigue is not high. ${lifts} use the method prescription. Do not drop a lower lift below the method.`,
  };
}

/**
 * Method rule plus the current fatigue limit.
 * Upper-body sets stay on the method. Lower-body sets use the fatigue limit when fatigue is high.
 */
export function allowedStrengthProgramming(
  method: string,
  weekIndex: 1 | 2 | 3 | 4,
  actual: WeekActual | null | undefined,
) {
  const level = previousLowerFatigue(actual);
  const rule = lowerBodyFatigueRule(method, weekIndex, actual);
  const upper = exampleSets(method, weekIndex, "unknown", "bench");
  const lower = rule.sets;
  const lowerHeavy = (lower ?? []).some((set) => set.percent_of_tm >= 85);
  const limits = hardConstraints(actual);
  return {
    equation: "method rule + current state constraint = the sets you may write",
    current_fatigue: level,
    upper_body_sets: upper,
    lower_body_sets: lower,
    lower_body_rule: rule,
    heavy_lower_slots_available: limits.programming_space.heavy_lower_slots_available,
    lower_lift_count_max: level === "high" && lowerHeavy ? 1 : null,
    rule:
      level === "high"
        ? lowerHeavy
          ? "Squat and deadlift must use lower_body_sets. Those sets are still a heavy lower session, so this week can include at most one squat or deadlift. Do not add a second lower lift. Do not copy upper_body_sets onto a lower lift."
          : "Squat and deadlift must use lower_body_sets. Do not copy upper_body_sets or the unrestricted method sets onto squat or deadlift. A heavy lower session is a top set at 85% or more, and that count must stay within heavy_lower_slots_available."
        : level === "low"
          ? "Previous fatigue is low. Use lower_body_sets for squat and deadlift and upper_body_sets for ohp and bench. Do not drop a lower lift below the method, and do not switch methods."
          : "No high or low fatigue signal. Use the method sets for every lift.",
  };
}

export type ErrorSeverity = "hard" | "weekly_requirement" | "quality";

/**
 * One judge error as the retry sees it. `day` keeps the older comma-joined label form.
 * `affected_session` is the day list the repair may touch. `repair_scope` says how narrow that is.
 */
export type StructuredValidationError = {
  day: string | null;
  rule: string;
  current: number | null;
  maximum: number | null;
  severity: ErrorSeverity;
  message: string;
  constraint: string;
  priority: number;
  affected_session: DayKey[];
  affected_features: string[];
  repair_scope: string;
};

const LABEL_TO_DAY: Record<string, string> = {
  Monday: "monday",
  Tuesday: "tuesday",
  Wednesday: "wednesday",
  Thursday: "thursday",
  Friday: "friday",
  Saturday: "saturday",
  Sunday: "sunday",
};

const LABEL_TO_KEY: Record<string, DayKey> = {
  Monday: "mon",
  Tuesday: "tue",
  Wednesday: "wed",
  Thursday: "thu",
  Friday: "fri",
  Saturday: "sat",
  Sunday: "sun",
};

function labelToDay(label: string): string {
  return label
    .split(",")
    .map((part) => LABEL_TO_DAY[part.trim()] ?? part.trim().toLowerCase())
    .join(",");
}

function keysFromLabels(label: string): DayKey[] {
  const out: DayKey[] = [];
  for (const part of label.split(",")) {
    const trimmed = part.trim();
    const key = LABEL_TO_KEY[trimmed] ?? ((DAY_ORDER as readonly string[]).includes(trimmed) ? (trimmed as DayKey) : null);
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function dayAfter(day: DayKey): DayKey | null {
  const index = DAY_ORDER.indexOf(day);
  return index >= 0 && index < DAY_ORDER.length - 1 ? DAY_ORDER[index + 1]! : null;
}

/**
 * Repair order for the retry. Every check still runs; this only orders the list the model reads.
 * 1 schema, 2 hard constraints, 3 weekly requirements, 4 prescription or invented weight,
 * 5 fatigue prescription, 6 same-week similarity, 7 recent similarity, 8 Korean naming.
 */
export const REPAIR_PRIORITY = {
  schema: 1,
  hard_constraint: 2,
  weekly_requirement: 3,
  prescription: 4,
  invented_weight: 4,
  lower_body_fatigue: 5,
  similarity_same_week: 6,
  similarity_recent: 7,
  korean_naming: 8,
} as const;

function scopeFor(days: DayKey[], mode: "only" | "one_of"): string {
  if (!days.length) return "all_sessions";
  if (days.length === 1) return `${days[0]}_only`;
  return mode === "one_of" ? `one_of:${days.join(",")}` : `only:${days.join(",")}`;
}

function structured(
  message: string,
  partial: Partial<StructuredValidationError> & Pick<StructuredValidationError, "rule" | "constraint" | "priority" | "severity">,
): StructuredValidationError {
  const affected = partial.affected_session ?? [];
  return {
    day: partial.day ?? (affected.length ? affected.map((key) => LABEL_TO_DAY[dayLabel(key)] ?? key).join(",") : null),
    rule: partial.rule,
    current: partial.current ?? null,
    maximum: partial.maximum ?? null,
    severity: partial.severity,
    message,
    constraint: partial.constraint,
    priority: partial.priority,
    affected_session: affected,
    affected_features: partial.affected_features ?? [],
    repair_scope: partial.repair_scope ?? scopeFor(affected, "only"),
  };
}

/** Turns a judge error into the retry object. The original sentence stays on `message`. */
export function structureValidationErrors(errors: readonly string[]): StructuredValidationError[] {
  return errors.map((message) => {
    const heavy = message.match(/heavy lower sessions (\d+) exceed hard_constraints\.heavy_lower_sessions_max=(\d+)/);
    if (heavy) {
      const days = keysFromLabels(message.split(":")[0] ?? "");
      return structured(message, {
        rule: "heavy_lower_sessions_max",
        constraint: "heavy_lower",
        priority: REPAIR_PRIORITY.hard_constraint,
        severity: "hard",
        current: Number(heavy[1]),
        maximum: Number(heavy[2]),
        affected_session: days,
        affected_features: ["strength.sets", "strength.lift"],
        repair_scope: scopeFor(days, "one_of"),
      });
    }
    const metcon = message.match(/^([^:]+): heavy lower metcon exceeds/);
    if (metcon) {
      return structured(message, {
        rule: "heavy_lower_metcon",
        constraint: "heavy_lower",
        priority: REPAIR_PRIORITY.hard_constraint,
        severity: "hard",
        current: 1,
        maximum: 0,
        affected_session: keysFromLabels(metcon[1] ?? ""),
        affected_features: ["conditioning.stimulus", "conditioning.intensity", "conditioning.movement_patterns"],
      });
    }
    if (message.includes("long conditioning") || message.includes("long_conditioning_sessions")) {
      const current = message.match(/current=(\d+)/);
      const named = keysFromLabels(message.match(/^(mon|tue|wed|thu|fri|sat|sun)\b/)?.[1] ?? "");
      return structured(message, {
        rule: "long_conditioning_sessions_min",
        constraint: "long_conditioning",
        priority: REPAIR_PRIORITY.weekly_requirement,
        severity: "weekly_requirement",
        current: current ? Number(current[1]) : named.length ? 1 : 0,
        maximum: 1,
        affected_session: named,
        affected_features: ["conditioning.duration_min", "conditioning.time_domain", "conditioning.long_conditioning"],
        repair_scope: named.length ? scopeFor(named, "only") : "week:change_exactly_one_session_to_long",
      });
    }
    const fatigueCut = message.match(/^(mon|tue|wed|thu|fri|sat|sun) sets do not match the strength method: fatigue cut/);
    if (fatigueCut) {
      return structured(message, {
        rule: "lower_body_fatigue_cut",
        constraint: "lower_body_fatigue",
        priority: REPAIR_PRIORITY.lower_body_fatigue,
        severity: "hard",
        affected_session: keysFromLabels(fatigueCut[1]!),
        affected_features: ["strength.sets"],
      });
    }
    const prescription = message.match(/^(mon|tue|wed|thu|fri|sat|sun) sets do not match/);
    if (prescription) {
      return structured(message, {
        rule: "strength_prescription",
        constraint: "prescription",
        priority: REPAIR_PRIORITY.prescription,
        severity: "hard",
        affected_session: keysFromLabels(prescription[1]!),
        affected_features: ["strength.sets"],
      });
    }
    const invented = message.match(/^(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday): )?invented prescribed weight "[^"]*" in (\S+)\./);
    if (invented) {
      const days = invented[1] ? keysFromLabels(invented[1]) : [];
      return structured(message, {
        rule: "invented_weight",
        constraint: "invented_weight",
        priority: REPAIR_PRIORITY.invented_weight,
        severity: "hard",
        affected_session: days,
        affected_features: [invented[2] ?? "text"],
        repair_scope: days.length ? scopeFor(days, "only") : "intent_only",
      });
    }
    const sameWeek = message.match(/^(mon|tue|wed|thu|fri|sat|sun) and (mon|tue|wed|thu|fri|sat|sun) are structurally similar score=(\d+) matched=([a-z_,]*)/);
    if (sameWeek) {
      const first = sameWeek[1] as DayKey;
      const second = sameWeek[2] as DayKey;
      const later = DAY_ORDER.indexOf(second) > DAY_ORDER.indexOf(first) ? second : first;
      return structured(message, {
        rule: "similarity_same_week",
        constraint: "similarity",
        priority: REPAIR_PRIORITY.similarity_same_week,
        severity: "hard",
        current: Number(sameWeek[3]),
        maximum: SIMILARITY_CONFIG.threshold - 1,
        affected_session: [later],
        affected_features: (sameWeek[4] ?? "").split(",").filter(Boolean),
        repair_scope: `${later}_only`,
      });
    }
    const recent = message.match(/^(mon|tue|wed|thu|fri|sat|sun) matches a recent structure score=(\d+) matched=([a-z_,]*)/);
    if (recent) {
      return structured(message, {
        rule: "similarity_recent",
        constraint: "similarity",
        priority: REPAIR_PRIORITY.similarity_recent,
        severity: "hard",
        current: Number(recent[2]),
        maximum: SIMILARITY_CONFIG.threshold - 1,
        affected_session: [recent[1] as DayKey],
        affected_features: (recent[3] ?? "").split(",").filter(Boolean),
      });
    }
    const korean = message.match(/^(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday): )?(\S+) (?:korean ratio|is English)/);
    if (korean) {
      return structured(message, {
        rule: "korean_naming",
        constraint: "korean_naming",
        priority: REPAIR_PRIORITY.korean_naming,
        severity: "quality",
        affected_session: korean[1] ? keysFromLabels(korean[1]) : [],
        affected_features: [korean[2] ?? "text"],
        repair_scope: korean[1] ? undefined : "intent_only",
      });
    }
    const sequence = message.match(/^heavy (?:pull|squat|snatch) the day after \w+ \((mon|tue|wed|thu|fri|sat|sun)\)/);
    if (sequence) {
      const day = sequence[1] as DayKey;
      const next = dayAfter(day);
      const days = next ? [day, next] : [day];
      return structured(message, {
        rule: "heavy_sequence",
        constraint: "hard_constraint",
        priority: REPAIR_PRIORITY.hard_constraint,
        severity: "hard",
        affected_session: days,
        affected_features: ["strength.lift", "strength.sets", "conditioning.movements"],
        repair_scope: scopeFor(days, "one_of"),
      });
    }
    const repeats = message.match(/^stimulus \w+ repeats on (mon|tue|wed|thu|fri|sat|sun)/);
    if (repeats) {
      return structured(message, {
        rule: "stimulus_repeat",
        constraint: "hard_constraint",
        priority: REPAIR_PRIORITY.hard_constraint,
        severity: "hard",
        affected_session: [repeats[1] as DayKey],
        affected_features: ["conditioning.stimulus", "stimulus"],
      });
    }
    if (message.includes("benchmark")) {
      return structured(message, {
        rule: "benchmark_sessions",
        constraint: "weekly_requirement",
        priority: REPAIR_PRIORITY.weekly_requirement,
        severity: "weekly_requirement",
        repair_scope: "week:change_exactly_one_session",
      });
    }
    if (message.startsWith("weekday strength layout")) {
      return structured(message, {
        rule: "weekday_pattern",
        constraint: "weekly_requirement",
        priority: REPAIR_PRIORITY.weekly_requirement,
        severity: "weekly_requirement",
        affected_features: ["strength.lift"],
        repair_scope: "week:move_one_lift_to_another_day",
      });
    }
    if (message.startsWith("intent says")) {
      return structured(message, {
        rule: "intent_prescription_mismatch",
        constraint: "lower_body_fatigue",
        priority: REPAIR_PRIORITY.lower_body_fatigue,
        severity: "hard",
        repair_scope: "intent_only",
      });
    }
    const keyed = message.match(/^(mon|tue|wed|thu|fri|sat|sun) /);
    const named = message.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
    const days = keysFromLabels(keyed?.[1] ?? message.split(":")[0] ?? "");
    const affected = days.length ? days : named ? keysFromLabels(named[1]!) : [];
    return structured(message, {
      day: named ? labelToDay(named[1] ?? "") : affected.length ? affected.map((key) => LABEL_TO_DAY[dayLabel(key)] ?? key).join(",") : null,
      rule: "schema",
      constraint: "schema",
      priority: REPAIR_PRIORITY.schema,
      severity: "hard",
      affected_session: affected,
      affected_features: ["session fields"],
    });
  });
}

const INTENT_ONLY_REPAIR_NOTE =
  " This error is not associated with a session. Do not treat repair_sessions as empty work. Use an intent-only repair: change only the relevant intent text, such as scheme_note, and preserve all sessions unchanged.";

/** One sentence per violation. Retry uses this so the next attempt sees the count it must not repeat. */
export function constraintFailureBriefs(errors: readonly string[]): string[] {
  return structureValidationErrors(errors).map((error) => {
    const brief = failureBrief(error);
    return error.repair_scope === "intent_only" && error.affected_session.length === 0 ? `${brief}${INTENT_ONLY_REPAIR_NOTE}` : brief;
  });
}

function failureBrief(error: StructuredValidationError): string {
    if (error.rule === "heavy_lower_sessions_max" && error.current != null && error.maximum != null) {
      return `Previous attempt violated hard constraint: heavy_lower_sessions_max = ${error.maximum}. Previous output contained ${error.current} heavy lower sessions. You MUST produce <= ${error.maximum} heavy lower session. Reduce one of ${error.affected_session.join(", ")}; do not touch other days.`;
    }
    if (error.rule === "heavy_lower_metcon") {
      return "Previous attempt violated hard constraint: heavy_lower_metcon = avoid. Previous output contained a heavy lower metcon. You MUST produce 0 heavy lower metcons.";
    }
    if (error.rule === "long_conditioning_sessions_min") {
      return `Previous attempt violated weekly requirement: long conditioning required = 1. Previous output contained ${error.current ?? 0}. At least one conditioning session must satisfy the long-duration requirement of 30–40 minutes. You MUST produce exactly 1 long conditioning session. Do not expect the server to change duration.`;
    }
    if (error.rule === "lower_body_fatigue_cut") {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt violated LOWER_BODY_FATIGUE_RULE on ${day}. The fatigue cut applies to squat AND deadlift. Rewrite only ${day} strength.sets to lower_body_sets exactly. A 90% AMRAP set is not allowed on a lower lift this week.`;
    }
    if (error.rule === "invented_weight") {
      return `Previous attempt invented a prescribed weight in ${error.affected_features[0] ?? "text"}. ${INVENTED_WEIGHT_RETRY}`;
    }
    if (error.rule === "similarity_same_week" || error.rule === "similarity_recent") {
      const day = error.affected_session[0] ?? "that day";
      const features = error.affected_features.join(", ");
      return `Previous attempt failed similarity on ${day}: score ${error.current} >= ${SIMILARITY_CONFIG.threshold}, matched ${features}. Change ${day} only. Change at least ${Math.max(1, (error.current ?? SIMILARITY_CONFIG.threshold) - SIMILARITY_CONFIG.threshold + 1)} of those matched features (format, time_domain, stimulus, movement_pattern, equipment, volume). Renaming a movement does not change a feature. Do not rewrite the other days.`;
    }
    if (error.rule === "korean_naming") {
      return `Previous attempt wrote ${error.affected_features[0] ?? "a Korean field"} with too little Korean. name_ko and every *_ko field are natural Korean names and sentences without kilograms or English abbreviations. Keep the English identity in key.`;
    }
    if (error.rule === "schema" && error.affected_session.length) {
      return `Previous attempt left ${error.affected_session.join(", ")} incomplete: ${error.message}. Fill every session-level field on that day from its own strength and conditioning objects. Do not rewrite other days.`;
    }
    return `Previous attempt violated: ${error.message} Do not repeat this violation. Keep every session that was already valid.`;
}

export type RepairPlan = {
  principle: string;
  immutable_sessions: DayKey[];
  repair_sessions: DayKey[];
  week_level_requirements: string[];
  intent_only: boolean;
  errors: StructuredValidationError[];
  priority_order: string[];
};

/**
 * Attempt-two scope. Sessions that passed every check are immutable.
 * Only the days named by an error change, plus at most one session a week-level requirement needs.
 */
export function retryRepairPlan(errors: readonly string[]): RepairPlan {
  const structuredErrors = structureValidationErrors(errors).sort((left, right) => left.priority - right.priority);
  const failing = new Set<DayKey>();
  const weekLevel: string[] = [];
  let intentOnly = false;
  for (const error of structuredErrors) {
    for (const day of error.affected_session) failing.add(day);
    if (!error.affected_session.length) {
      if (error.repair_scope === "intent_only") intentOnly = true;
      else weekLevel.push(error.repair_scope);
    }
  }
  const repair = DAY_ORDER.filter((day) => failing.has(day));
  const immutable = DAY_ORDER.filter((day) => !failing.has(day));
  const intentOnlyEmpty = intentOnly && repair.length === 0;
  return {
    principle: intentOnlyEmpty
      ? "This failure is not associated with a session. repair_sessions is empty, and that is not empty work. Repair only the relevant intent text, such as scheme_note, and preserve all sessions unchanged."
      : "Every session that passed validation is immutable. Modify only repair_sessions. A week-level requirement may change exactly one additional session, and you name it.",
    immutable_sessions: immutable,
    repair_sessions: repair,
    week_level_requirements: [...new Set(weekLevel)],
    intent_only: intentOnly,
    errors: structuredErrors,
    priority_order: [
      "1 schema / missing required fields",
      "2 hard constraints",
      "3 weekly requirements",
      "4 invalid prescription / invented weight",
      "5 fatigue prescription",
      "6 same-week similarity",
      "7 recent-week similarity",
      "8 Korean naming quality",
    ],
  };
}

/** Days whose session JSON changed between two drafts. Rest days count too. */
export function changedSessions(previous: WeekDraft | null, next: WeekDraft): DayKey[] {
  if (!previous) return [];
  const before = new Map(previous.sessions.map((session) => [session.day, JSON.stringify(session)]));
  return next.sessions.filter((session) => before.get(session.day) !== JSON.stringify(session)).map((session) => session.day);
}

/** Same object the prompt sends as hard_constraints. */
export function fatigueConstraintInput(actual: WeekActual | null | undefined) {
  return hardConstraints(actual);
}

function isLowerMetcon(session: SessionDraft): boolean {
  const conditioning = session.conditioning;
  if (!conditioning) return false;
  return conditioning.movement_patterns.some((pattern) => pattern === "squat" || pattern === "hinge");
}

function heavyLowerMetcon(session: SessionDraft): boolean {
  const conditioning = session.conditioning;
  if (!conditioning || !isLowerMetcon(session)) return false;
  return conditioning.stimulus === "heavy" || conditioning.intensity === "heavy";
}

export function weekBurden(draft: WeekDraft): WeekBurden {
  let lowerSessions = 0;
  let lowerVolume = 0;
  let heavyLower = 0;
  let lowerMetcon = 0;
  let intensity = 0;
  for (const session of draft.sessions) {
    const lift = session.strength?.lift;
    if (lift && LOWER_LIFTS.has(lift)) {
      lowerSessions += 1;
      lowerVolume += session.strength?.sets.length ?? 0;
      if (session.strength && strengthIsHeavy(session.strength.sets)) heavyLower += 1;
    }
    for (const set of session.strength?.sets ?? []) intensity += set.percent_of_tm;
    if (isLowerMetcon(session)) lowerMetcon += 1;
  }
  return {
    lower_strength_sessions: lowerSessions,
    lower_strength_volume: lowerVolume,
    heavy_lower_sessions: heavyLower,
    lower_body_metcon_exposure: lowerMetcon,
    strength_intensity_sum: intensity,
  };
}

/** Metrics where the first week is strictly heavier than the second. */
export function heavierThan(left: WeekBurden, right: WeekBurden): string[] {
  const keys = [
    "lower_strength_sessions",
    "lower_strength_volume",
    "heavy_lower_sessions",
    "lower_body_metcon_exposure",
    "strength_intensity_sum",
  ] as const;
  return keys.filter((key) => left[key] > right[key]);
}

export function feedbackViolations(
  draft: WeekDraft,
  month: MonthDirection,
  weekIndex: 1 | 2 | 3 | 4,
  actual: WeekActual | null | undefined,
): string[] {
  const level = previousLowerFatigue(actual);
  const method = month.strength_method || month.scheme;
  const errors: string[] = [];
  const lower = draft.sessions.filter((session) => session.strength && LOWER_LIFTS.has(session.strength.lift));
  if (level === "high" || level === "low") {
    for (const session of lower) {
      if (!session.strength) continue;
      const problem = validateStrengthPrescription(method, session.strength.sets, {
        day: session.day,
        weekIndex,
        lift: session.strength.lift,
        fatigue: strengthCheckFatigue(session.strength.lift, actual),
      });
      if (problem) errors.push(problem);
    }
  }
  if (level === "high") {
    const heavy = lower.filter((session) => session.strength && strengthIsHeavy(session.strength.sets));
    const max = hardConstraints(actual).heavy_lower_sessions_max ?? 1;
    if (heavy.length > max) {
      const days = heavy.map((session) => dayLabel(session.day)).join(", ");
      errors.push(`${days}: heavy lower sessions ${heavy.length} exceed hard_constraints.heavy_lower_sessions_max=${max}`);
    }
    for (const session of draft.sessions) {
      if (heavyLowerMetcon(session)) {
        errors.push(`${dayLabel(session.day)}: heavy lower metcon exceeds hard_constraints.heavy_lower_metcon=avoid`);
      }
    }
  }
  const text = `${draft.intent.why_ko}\n${draft.intent.focus}\n${draft.intent.scheme_note}`;
  const keptHeavy = lower.some((session) => {
    if (!session.strength) return false;
    return (
      validateStrengthPrescription(method, session.strength.sets, {
        day: session.day,
        weekIndex,
        lift: session.strength.lift,
        fatigue: "high",
      }) != null
    );
  });
  if (mentionsReducedLowerIntent(text) && keptHeavy) {
    errors.push("intent says lower load was reduced but the prescription is heavier than the fatigue limit");
  }
  return errors;
}

/** Day to primary lift. Same string is used for the fixed-weekday check. */
export function liftMapKey(draft: WeekDraft): string {
  return DAY_ORDER.map((day) => {
    const lift = draft.sessions.find((session) => session.day === day)?.strength?.lift ?? "-";
    return `${day}:${lift}`;
  }).join(",");
}

export function monthAllowsSameLiftDays(month: MonthDirection): boolean {
  const text = [
    month.weekly_direction,
    month.strength_direction,
    month.weekly_progression,
    month.progression_notes,
    month.constraints.join("\n"),
  ].join("\n");
  return /같은 요일|요일별 배치를 유지|주차.*진행|same weekday/i.test(text);
}

/** Same lift-map string the final gate already compares. Skeleton validation calls this too. */
export function strengthLayoutRepeats(current: string, recentMaps: readonly string[], allowRepeat: boolean): string[] {
  if (allowRepeat || recentMaps.length < 2) return [];
  const lastTwo = recentMaps.slice(-2);
  if (lastTwo.every((map) => map === current)) return ["weekday strength layout repeats the previous two weeks"];
  return [];
}

export function weekdayPatternViolations(draft: WeekDraft, recentMaps: readonly string[], allowRepeat: boolean): string[] {
  return strengthLayoutRepeats(liftMapKey(draft), recentMaps, allowRepeat);
}

/** Korean checks per session so the retry knows which day to fix. The intent is checked on its own. */
function koreanErrors(draft: WeekDraft): string[] {
  const errors: string[] = [];
  const intent = englishKoPath(draft.intent, "intent");
  if (intent) errors.push(intent);
  draft.sessions.forEach((session, index) => {
    const found = englishKoPath(session, `sessions[${index}]`);
    if (found) errors.push(`${dayLabel(session.day)}: ${found}`);
  });
  return errors;
}

function dedupe(errors: string[]): string[] {
  return [...new Set(errors)];
}

function isLowerSetMismatch(draft: WeekDraft, error: string): boolean {
  const day = error.match(/^(mon|tue|wed|thu|fri|sat|sun) sets do not match/)?.[1];
  if (!day) return false;
  const lift = draft.sessions.find((session) => session.day === day)?.strength?.lift;
  return isLowerBodyLift(lift);
}

function failed(
  reason: JudgeFailure,
  errors: string[],
  normalizations: string[] = [],
): Judge {
  return { ok: false, reason, detail: errors[0] ?? "validation failed", errors, normalizations };
}

/**
 * Parse → schema → strength scheme → fatigue/feedback → fixed weekday
 * → same-week conflict → similarity → Korean.
 */
export function judgeWeek(
  raw: unknown,
  month: MonthDirection,
  weekIndex: 1 | 2 | 3 | 4,
  recent: readonly StoredStructure[],
  context: WeekCheckContext = {},
): Judge {
  const normalized = normalizeWeekPayload(raw);
  const body = normalized.value;
  const parsed = describeWeekParse(body);
  if (!parsed.ok) return failed("schema", parsed.errors, normalized.normalizations);
  const draft = parseWeekDraft(body);
  if (!draft) return failed("schema", ["unreadable week"], normalized.normalizations);
  const schema = weekSchemaErrors(draft, body);
  const constitution = constitutionViolations(draft, month, weekIndex, context.previousActual);
  const level = previousLowerFatigue(context.previousActual);
  const setErrors = constitution.filter((error) => error.includes("sets do not match"));
  // High and low fatigue own the lower-body sets. feedbackViolations reports that same check.
  const scheme =
    level === "high" || level === "low"
      ? setErrors.filter((error) => !isLowerSetMismatch(draft, error))
      : setErrors;
  const sameWeek = constitution.filter((error) => !schema.includes(error) && !error.includes("sets do not match"));
  const stages: Array<{ reason: JudgeFailure; errors: string[] }> = [
    { reason: "schema", errors: schema },
    { reason: "invented_weight", errors: inventedWeightErrors(draft) },
    { reason: "rule_break", errors: scheme },
    { reason: "feedback", errors: feedbackViolations(draft, month, weekIndex, context.previousActual) },
    {
      reason: "weekday_pattern",
      errors: weekdayPatternViolations(draft, context.recentLiftMaps ?? [], monthAllowsSameLiftDays(month)),
    },
    { reason: "rule_break", errors: sameWeek },
    { reason: "too_similar", errors: similarityViolations(draft, recent) },
    { reason: "language", errors: koreanErrors(draft) },
  ];
  const hit = stages.filter((stage) => stage.errors.length > 0);
  if (!hit.length) return { ok: true, draft, detail: null, errors: [], normalizations: normalized.normalizations };
  const errors = dedupe(hit.flatMap((stage) => stage.errors));
  return failed(hit[0]!.reason, errors, normalized.normalizations);
}

export function liftOf(session: SessionDraft): MainLift | null {
  return session.strength?.lift ?? null;
}
