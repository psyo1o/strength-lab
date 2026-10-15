import { OFFICIAL_LOAD_PAIRS } from "../month-plan/shared-line";
import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { isWodPurpose } from "../wod/purpose";
import { completeMonthDirection } from "./month-direction";
import { strengthIsHeavy } from "./schemes";
import { sessionHasHeavyLowerMetcon } from "./coaching/heavy-lower-metcon";
import { equipmentForKeys } from "./coaching/movement-catalog";
import { safetyViolations } from "./coaching/stage15/safety-policy";
import { benchmarkCountAllowed, longConditioningCountAllowed } from "./coaching/stage15/week-policy";
import { exampleSets, legacySchemeForMethod, prescriptionGuide, setsMatchSecondLowerVolume, validateStrengthPrescription } from "./strength-methods";
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
  [/\bDELOAD_RECOVERY\b/g, "디로드 및 회복"],
  [/\bTECHNIQUE_SKILL\b/g, "기술"],
  [/\bACCUMULATION\b/g, "축적"],
  [/\bPROGRESSION\b/g, "점진적 향상"],
  [/\bEMPHASIS\b/g, "강조"],
  [/\bDELOAD\b/g, "디로드"],
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
  const rep = asString(value.rep_structure);
  const rest = asString(value.work_rest_structure);
  const duration = asInt(value.duration_min);
  const volume = value.volume;
  const intensity = value.intensity;
  const longPiece = asBool(value.long_conditioning);
  const purpose = asString(value.purpose);
  if (benchmark == null || patterns == null || !rep || !rest || duration == null || longPiece == null) {
    return null;
  }
  if (!purpose || !isWodPurpose(purpose)) return null;
  if (
    format !== "amrap" &&
    format !== "for_time" &&
    format !== "emom" &&
    format !== "intervals" &&
    format !== "chipper" &&
    format !== "partner" &&
    format !== "zone2"
  ) {
    return null;
  }
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
  const listed = parseStringList(value.equipment, EQUIPMENT);
  const equipment = listed ?? equipmentForKeys(movements.map((movement) => movement.key));
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

function zone2Draft(value: unknown): SessionDraft["zone2"] | null {
  if (!value || typeof value !== "object") return null;
  const zone = value as { form?: unknown; modality?: unknown; duration_min?: unknown; effort?: unknown; hr?: unknown };
  if (zone.form !== "day" && zone.form !== "addon") return null;
  if (typeof zone.modality !== "string" || typeof zone.duration_min !== "number") return null;
  return {
    form: zone.form,
    modality: zone.modality,
    duration_min: zone.duration_min,
    effort: typeof zone.effort === "string" ? zone.effort : "conversational",
    hr: typeof zone.hr === "string" ? zone.hr : "unspecified",
    alternate: null,
    performed_option: null,
    completion_status: null,
    actual_duration_min: null,
    actual_rpe: null,
  };
}

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
      metcon_format:
        row.metcon_format === "amrap" ||
        row.metcon_format === "for_time" ||
        row.metcon_format === "emom" ||
        row.metcon_format === "intervals" ||
        row.metcon_format === "chipper" ||
        row.metcon_format === "partner" ||
        row.metcon_format === "zone2"
          ? row.metcon_format
          : null,
      time_domain: row.time_domain === "short" || row.time_domain === "medium" || row.time_domain === "long" ? row.time_domain : null,
      stimulus: row.stimulus === null ? null : typeof row.stimulus === "string" && (STIMULI as readonly string[]).includes(row.stimulus) ? (row.stimulus as Stimulus) : null,
      movement_combination: asString(row.movement_combination),
      equipment,
      volume: row.volume === "low" || row.volume === "moderate" || row.volume === "high" ? row.volume : null,
      intensity: row.intensity === "light" || row.intensity === "moderate" || row.intensity === "heavy" ? row.intensity : null,
      expected_duration: asInt(row.expected_duration),
      ...(Array.isArray(row.session_blocks) ? { session_blocks: row.session_blocks as SessionDraft["session_blocks"] } : {}),
      ...(Array.isArray(row.warmup_phases) ? { warmup_phases: row.warmup_phases as SessionDraft["warmup_phases"] } : {}),
      ...(zone2Draft(row.zone2) ? { zone2: zone2Draft(row.zone2)! } : {}),
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
    if (isRecord(row.conditioning)) {
      const purpose = typeof row.conditioning.purpose === "string" ? row.conditioning.purpose : "";
      if (!isWodPurpose(purpose)) errors.push(`${day} conditioning.purpose must be 1–2 sentences`);
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

/**
 * deload + 531 is not a legal month. Week 4 of a 531 month is the deload phase.
 * A recovery month uses scheme deload and DELOAD_RECOVERY. The pair is rejected, not rewritten.
 */
export function schemeMethodMismatch(direction: Pick<MonthDirection, "scheme" | "strength_method">): string {
  const method = direction.strength_method || "missing";
  if (direction.scheme === "deload" && method === "531") {
    return "scheme deload does not allow strength_method 531; a recovery month uses DELOAD_RECOVERY; a 531 month uses scheme 531 and only week 4 is a deload";
  }
  if (direction.scheme === "531" && method === "DELOAD_RECOVERY") {
    return "scheme 531 does not allow strength_method DELOAD_RECOVERY; a recovery month uses scheme deload and DELOAD_RECOVERY; a 531 month uses strength_method 531";
  }
  return `scheme ${direction.scheme} does not match strength_method ${method}`;
}

export function monthSchemaErrors(direction: MonthDirection, raw: unknown): string[] {
  const errors: string[] = [];
  const banned = bannedKey(raw, new Set([...BANNED_KEYS, ...MONTH_BANNED_KEYS]));
  if (banned) errors.push(`month contains ${banned}`);
  if (textHasInventedKg(raw)) errors.push("month invents kg");
  const expectedScheme = legacySchemeForMethod(direction.strength_method);
  if (!direction.strength_method) errors.push("missing strength_method");
  else if (!expectedScheme) errors.push(`${direction.strength_method} is not an implemented strength method`);
  else if (expectedScheme !== direction.scheme) errors.push(schemeMethodMismatch(direction));
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

/**
 * The one domain that contains this duration, or null when it is outside every bucket.
 * Unlike the coaching stamp, a duration such as 60 is not called long.
 */
export function timeDomainForDuration(minutes: number): "short" | "medium" | "long" | null {
  if (minutes >= TIME_DOMAIN_RANGES.short.min && minutes <= TIME_DOMAIN_RANGES.short.max) return "short";
  if (minutes >= TIME_DOMAIN_RANGES.medium.min && minutes <= TIME_DOMAIN_RANGES.medium.max) return "medium";
  if (minutes >= TIME_DOMAIN_RANGES.long.min && minutes <= TIME_DOMAIN_RANGES.long.max) return "long";
  return null;
}

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

const SESSION_FORMATS = ["amrap", "for_time", "emom", "intervals", "chipper", "partner"] as const;
const SESSION_DOMAINS = ["short", "medium", "long"] as const;
const SESSION_VOLUMES = ["low", "moderate", "high"] as const;
const SESSION_INTENSITIES = ["light", "moderate", "heavy"] as const;

function blankSessionValue(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/**
 * Copy one session mirror only when the model left it empty and the same day's conditioning
 * already has that value. A filled time_domain or duration is never replaced.
 */
function copyNullSessionMirrors(row: Record<string, unknown>, normalizations: string[]): void {
  if (row.rest === true || !isRecord(row.conditioning)) return;
  const conditioning = row.conditioning;
  const copied: string[] = [];
  const take = (field: string, value: unknown) => {
    if (!blankSessionValue(row[field]) || blankSessionValue(value)) return;
    row[field] = value;
    copied.push(field);
  };
  if (typeof conditioning.format === "string" && (SESSION_FORMATS as readonly string[]).includes(conditioning.format)) {
    take("metcon_format", conditioning.format);
  }
  if (typeof conditioning.time_domain === "string" && (SESSION_DOMAINS as readonly string[]).includes(conditioning.time_domain)) {
    take("time_domain", conditioning.time_domain);
  }
  if (typeof conditioning.stimulus === "string" && (STIMULI as readonly string[]).includes(conditioning.stimulus)) {
    take("stimulus", conditioning.stimulus);
  }
  if (typeof conditioning.volume === "string" && (SESSION_VOLUMES as readonly string[]).includes(conditioning.volume)) {
    take("volume", conditioning.volume);
  }
  if (typeof conditioning.intensity === "string" && (SESSION_INTENSITIES as readonly string[]).includes(conditioning.intensity)) {
    take("intensity", conditioning.intensity);
  }
  if (typeof conditioning.duration_min === "number" && Number.isInteger(conditioning.duration_min)) {
    take("expected_duration", conditioning.duration_min);
  }
  if (typeof conditioning.purpose === "string" && conditioning.purpose.trim()) {
    take("metcon_purpose", conditioning.purpose.trim());
  }
  if (Array.isArray(conditioning.equipment) && conditioning.equipment.every((item) => typeof item === "string")) {
    take("equipment", [...conditioning.equipment]);
  }
  if (Array.isArray(conditioning.movements)) {
    const keys = conditioning.movements
      .filter((movement): movement is Record<string, unknown> => isRecord(movement) && typeof movement.key === "string" && movement.key.length > 0)
      .map((movement) => movement.key as string);
    if (keys.length) take("movement_combination", [...keys].sort().join("+"));
  }
  if (!copied.length) return;
  const day = typeof row.day === "string" ? row.day : "session";
  normalizations.push(`${dayLabel(day)}: copied ${copied.join(", ")} from conditioning`);
}

/**
 * Structural cleanup only. A null strength object cannot carry purpose, volume, or intensity.
 * A null session mirror is copied from the same day's conditioning. A value that is already
 * set, including a wrong time_domain or duration_min, is never rewritten.
 */
export function normalizeWeekPayload(raw: unknown): { value: unknown; normalizations: string[] } {
  if (!isRecord(raw) || !Array.isArray(raw.sessions)) return { value: raw, normalizations: [] };
  const clone = structuredClone(raw) as Record<string, unknown>;
  const sessions = clone.sessions;
  if (!Array.isArray(sessions)) return { value: raw, normalizations: [] };
  const normalizations: string[] = [];
  for (const row of sessions) {
    if (!isRecord(row)) continue;
    if (row.strength == null) {
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
    copyNullSessionMirrors(row, normalizations);
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
      errors.push(
        session.conditioning
          ? `${session.day} is missing session fields`
          : `${session.day} is missing session fields because conditioning is null`,
      );
    }
    if (session.expected_duration == null || session.volume == null || session.intensity == null) {
      errors.push(`${session.day} is missing duration or load bands`);
    }
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
      errors.push(`${session.day} conditioning.purpose must be 1–2 sentences`);
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
    const zone2Piece = session.zone2?.form === "day" || session.conditioning.format === "zone2";
    if (zone2Piece) {
      const minutes = session.conditioning.duration_min;
      if (minutes !== 30 && minutes !== 40 && minutes !== 45) {
        errors.push(`${dayLabel(session.day)}: zone2 duration=${minutes} is outside 30–45`);
      }
    } else if (!timeDomainFits(session.conditioning)) {
      const domain = session.conditioning.time_domain;
      const range = TIME_DOMAIN_RANGES[domain];
      errors.push(
        `${dayLabel(session.day)}: time_domain=${domain} duration=${session.conditioning.duration_min} is outside ${range.min}–${range.max}`,
      );
    }
    if (!zone2Piece && session.conditioning.long_conditioning !== (session.conditioning.time_domain === "long")) {
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

/**
 * 고피로 주에 하체가 둘이면 하루는 피로 컷, 다른 하루는 75% 이하 볼륨 세트다.
 * 하체가 하나뿐이면 피로 컷만 통과한다.
 */
function lowerSetProblem(
  method: string,
  weekIndex: 1 | 2 | 3 | 4,
  session: SessionDraft,
  actual: WeekActual | null | undefined,
  lowers: readonly SessionDraft[],
): string | null {
  if (!session.strength) return null;
  const fatigue = strengthCheckFatigue(session.strength.lift, actual);
  const problem = validateStrengthPrescription(method, session.strength.sets, {
    day: session.day,
    weekIndex,
    lift: session.strength.lift,
    fatigue,
  });
  if (!problem || fatigue !== "high" || !isLowerBodyLift(session.strength.lift)) return problem;
  if (!setsMatchSecondLowerVolume(method, weekIndex, session.strength.sets)) return problem;
  const anchored = lowers.filter((row) => {
    if (row.day === session.day || !row.strength || !isLowerBodyLift(row.strength.lift)) return false;
    return (
      validateStrengthPrescription(method, row.strength.sets, {
        day: row.day,
        weekIndex,
        lift: row.strength.lift,
        fatigue: "high",
      }) == null
    );
  });
  return anchored.length === 1 ? null : problem;
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
      const lowers = draft.sessions.filter((row) => row.strength && isLowerBodyLift(row.strength.lift));
      const problem = lowerSetProblem(month.strength_method || month.scheme, weekIndex, session, actual, lowers);
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
          longConditioning: Boolean(session.conditioning?.long_conditioning) && session.zone2?.form !== "day",
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
  const longs = draft.sessions.filter((session) => session.conditioning?.long_conditioning && session.zone2?.form !== "day");
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

function structureKeys(structure: StoredStructure): string[] {
  return structure.movements.map((movement) => movement.key).filter(Boolean);
}

/**
 * Conditioning keys overlap when they share 3 or more,
 * or when both pieces have exactly two keys and those two match.
 * A single shared name is not this axis. Empty lists do not match.
 */
export function movementKeysOverlap(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left.filter(Boolean));
  const b = new Set(right.filter(Boolean));
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  for (const key of a) if (b.has(key)) shared += 1;
  if (a.size === 2 && b.size === 2 && shared === 2) return true;
  return shared >= 3;
}

/** One comparable token per configured feature. movement_combo is matched by overlap, not by an empty list. */
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
    case "movement_combo":
      return listKey(structureKeys(structure));
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
    const same =
      feature === "movement_combo"
        ? movementKeysOverlap(structureKeys(left), structureKeys(right))
        : featureValue(left, feature) === featureValue(right, feature);
    if (same) {
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

function featureChangeHint(feature: SimilarityFeature): string {
  if (feature === "format") return "Set conditioning.format to a different format.";
  if (feature === "time_domain") {
    return `time_domain follows duration_min (${TIME_DOMAIN_RANGES.short.min}–${TIME_DOMAIN_RANGES.short.max} short, ${TIME_DOMAIN_RANGES.medium.min}–${TIME_DOMAIN_RANGES.medium.max} medium, ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} long). Change duration_min into a different bucket.`;
  }
  if (feature === "movement_pattern") return "movement_pattern is derived from the movements. Change the movements so the pattern list differs.";
  if (feature === "equipment") return "equipment is filled by the server from the movements. Change to movements whose catalog equipment differs. Do not return equipment.";
  if (feature === "volume") return "Set conditioning.volume to a different volume.";
  if (feature === "movement_combo") {
    return "Change the conditioning movement keys. Sharing 3 or more keys overlaps, and a 2-movement piece overlaps when both keys match.";
  }
  return "";
}

function trainingSessions(draft: WeekDraft, ignoreDays: readonly DayKey[], day: DayKey): SessionDraft[] {
  const ignored = new Set(ignoreDays.filter((key) => key !== day));
  return DAY_ORDER.map((key) => draft.sessions.find((session) => session.day === key)).filter(
    (session): session is SessionDraft => Boolean(session && !session.rest && session.conditioning && !ignored.has(session.day)),
  );
}

function neighborStimuli(draft: WeekDraft, day: DayKey, ignoreDays: readonly DayKey[]): Stimulus[] {
  const ordered = trainingSessions(draft, ignoreDays, day);
  const index = ordered.findIndex((session) => session.day === day);
  if (index < 0) return [];
  return [ordered[index - 1], ordered[index + 1]]
    .map((session) => session?.conditioning?.stimulus)
    .filter((stimulus): stimulus is Stimulus => Boolean(stimulus));
}

function stimulusConstraint(current: string, neighbors: readonly string[]): string {
  const blocked = new Set(neighbors);
  const allowed = STIMULI.filter((stimulus) => !blocked.has(stimulus));
  const alternatives = allowed.filter((stimulus) => stimulus !== current);
  const forbid = neighbors.length ? `Do not set conditioning.stimulus to ${[...new Set(neighbors)].join(" or ")}.` : "";
  const must = allowed.length ? `conditioning.stimulus must be ${allowed.join(" or ")}.` : "";
  const choice = alternatives.length
    ? `If you change conditioning.stimulus, set it to ${alternatives.join(" or ")}.`
    : current
      ? `Keep conditioning.stimulus as ${current}. Change a different matched feature.`
      : "";
  return [forbid, must, choice, "A new movement name is not a stimulus change."].filter(Boolean).join(" ");
}

/** Retry text. The canonical score line stays at the front so later parsers still match it. */
export function similarityRetryText(
  draft: WeekDraft,
  recent: readonly StoredStructure[],
  error: string,
  focusDay?: DayKey,
  ignoreDays: readonly DayKey[] = [],
): string {
  const score = Number(error.match(/score=(\d+)/)?.[1] ?? String(SIMILARITY_CONFIG.threshold));
  const need = Math.max(1, score - (SIMILARITY_CONFIG.threshold - 1));
  const matched = (error.match(/matched=([a-z_,]*)/)?.[1] ?? "")
    .split(",")
    .filter((feature): feature is SimilarityFeature => feature in SIMILARITY_CONFIG.features && (SIMILARITY_CONFIG.features[feature as SimilarityFeature] ?? 0) > 0);
  const same = error.match(/^(mon|tue|wed|thu|fri|sat|sun) and (mon|tue|wed|thu|fri|sat|sun) are structurally similar/);
  const recentHit = error.match(/^(mon|tue|wed|thu|fri|sat|sun) matches a recent structure/);
  const leftDay = (same?.[1] ?? recentHit?.[1]) as DayKey | undefined;
  const rightDay = same?.[2] as DayKey | undefined;
  const fresh = draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const left = leftDay ? fresh.find((row) => row.day === leftDay) : undefined;
  const right = rightDay
    ? fresh.find((row) => row.day === rightDay)
    : left
      ? recent.find((prior) => {
          if (prior.benchmark) return false;
          const hit = similarityMatch(left, prior);
          return hit.score === score && hit.matched.join(",") === matched.join(",");
        })
      : undefined;
  const focus =
    focusDay ??
    (leftDay && rightDay ? (DAY_ORDER.indexOf(rightDay) > DAY_ORDER.indexOf(leftDay) ? rightDay : leftDay) : leftDay);
  const mine = focus ? fresh.find((row) => row.day === focus) ?? left : left;
  const other = focus === leftDay ? right : focus === rightDay ? left : right;
  const values = matched.map((feature) => {
    const yours = mine ? featureValue(mine, feature) : "?";
    const theirs = other ? featureValue(other, feature) : "?";
    return `your ${feature}=${yours || "empty"} matches ${other?.day ?? "recent"} ${feature}=${theirs || "empty"}`;
  });
  const levers = matched.filter((feature) => feature !== "stimulus").map((feature) => featureChangeHint(feature)).filter(Boolean);
  const stimulusLine = stimulusConstraint(mine?.stimulus ?? "", focus ? neighborStimuli(draft, focus, ignoreDays) : []);
  const only = focus ? `Change only ${focus}.` : "";
  return `${error}. ${values.join("; ")}. Change at least ${need} of those matched features so the score is below ${SIMILARITY_CONFIG.threshold}. ${only} ${levers.join(" ")} ${stimulusLine} Renaming a movement does not change a feature. The threshold stays ${SIMILARITY_CONFIG.threshold}.`;
}

export type OverlapSession = {
  day: string;
  scope: "neighbor" | "same_week" | "recent";
  week_start: string | null;
  format: string;
  duration_min: number;
  time_domain: string;
  stimulus: string | null;
  movement_pattern: string;
  movements: { key: string; amount: string }[];
  volume: string;
  equipment: string[];
  matched: string[];
  score: number | null;
};

function overlapView(structure: StoredStructure, scope: OverlapSession["scope"], matched: readonly string[], score: number | null): OverlapSession {
  return {
    day: structure.day,
    scope,
    week_start: structure.source_week_start ?? null,
    format: structure.format,
    duration_min: structure.duration_min,
    time_domain: structure.time_domain,
    stimulus: structure.stimulus,
    movement_pattern: [...structure.movement_patterns].sort().join("+"),
    movements: structure.movements.map((row) => ({ key: row.key, amount: row.amount })),
    volume: structure.volume,
    equipment: [...structure.equipment],
    matched: [...matched],
    score,
  };
}

/** The other day's real session when stimulus or structure overlaps. Threshold stays 4. */
export function overlapSessionsFor(
  draft: WeekDraft,
  day: DayKey,
  recent: readonly StoredStructure[] = [],
  ignoreDays: readonly DayKey[] = [],
): OverlapSession[] {
  const ignored = new Set(ignoreDays.filter((key) => key !== day));
  const fresh = draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null && !ignored.has(row.day));
  const mine = fresh.find((row) => row.day === day);
  if (!mine) return [];
  const rows: OverlapSession[] = [];
  const ordered = trainingSessions(draft, ignoreDays, day);
  const index = ordered.findIndex((session) => session.day === day);
  for (const neighbor of [ordered[index - 1], ordered[index + 1]]) {
    const stimulus = neighbor?.conditioning?.stimulus;
    if (!neighbor?.conditioning || !stimulus || stimulus !== mine.stimulus) continue;
    const structure = toStructure(neighbor);
    if (structure) rows.push(overlapView(structure, "neighbor", ["stimulus"], null));
  }
  for (const other of fresh) {
    if (other.day === day) continue;
    const hit = comparison(mine, other, "same_week");
    if (!hit.similar) continue;
    rows.push(overlapView(other, "same_week", hit.matched, hit.score));
  }
  for (const prior of recent) {
    if (prior.benchmark) continue;
    const hit = comparison(mine, prior, "recent");
    if (!hit.similar) continue;
    rows.push(overlapView(prior, "recent", hit.matched, hit.score));
  }
  return rows;
}

/** Training days that still score at or above the threshold against a recent week. */
export function recentOverlapDays(draft: WeekDraft, recent: readonly StoredStructure[]): DayKey[] {
  const days = new Set<DayKey>();
  for (const hit of similarityDiagnostics(draft, recent).hits) {
    if (hit.compared_scope !== "recent") continue;
    if ((DAY_ORDER as readonly string[]).includes(hit.candidate_day)) days.add(hit.candidate_day as DayKey);
  }
  return DAY_ORDER.filter((day) => days.has(day));
}

/** One recent-week overlap brief for a single day rewrite. Threshold stays 4. */
export function recentOverlapPayload(draft: WeekDraft, day: DayKey, recent: readonly StoredStructure[]) {
  const sessions = overlapSessionsFor(draft, day, recent).filter((row) => row.scope === "recent");
  return {
    instruction:
      "This day still scores 4 or more against a recent week after the weekday swap. Change at least one matched axis. matched lists those axes. Each session has format, duration_min, time_domain, stimulus, movement_pattern, and movements with key and amount. Do not copy that session. This day is rewritten once. A remaining overlap is a head signal, not a reason to reject the day. The threshold stays 4.",
    sessions,
  };
}

export function overlapRetryErrors(rows: readonly OverlapSession[]): string[] {
  return rows.map((row) => {
    const moves = row.movements.map((movement) => `${movement.key} ${movement.amount}`).join(", ") || "none";
    const score = row.score == null ? "neighbor stimulus" : `score=${row.score}`;
    return `${row.scope} ${row.day} overlaps ${score} matched=${row.matched.join(",")}. format=${row.format} duration_min=${row.duration_min} time_domain=${row.time_domain} stimulus=${row.stimulus ?? "none"} movement_pattern=${row.movement_pattern} movements=${moves} volume=${row.volume} equipment=${row.equipment.join("+") || "none"}. Write a different format, a different stimulus, and different movement keys from this session. Do not copy it. The threshold stays 4.`;
  });
}

/**
 * Errors this day would add against the other training days and recent weeks.
 * Threshold stays SIMILARITY_CONFIG.threshold.
 */
export function adoptionCollisionErrors(
  draft: WeekDraft,
  day: DayKey,
  recent: readonly StoredStructure[] = [],
  ignoreDays: readonly DayKey[] = [],
): string[] {
  const ignored = new Set(ignoreDays.filter((key) => key !== day));
  const ordered = DAY_ORDER.map((key) => draft.sessions.find((session) => session.day === key)).filter(
    (session): session is SessionDraft => Boolean(session && !session.rest && session.conditioning && !ignored.has(session.day)),
  );
  const index = ordered.findIndex((session) => session.day === day);
  if (index < 0) return [];
  const stimulus = ordered[index]?.conditioning?.stimulus;
  const errors: string[] = [];
  for (const neighbor of [ordered[index - 1], ordered[index + 1]]) {
    const other = neighbor?.conditioning?.stimulus;
    if (stimulus && other && stimulus === other) errors.push(`stimulus ${stimulus} repeats on ${day}`);
  }
  for (const line of similarityViolations(draft, recent)) {
    const same = line.match(/^(mon|tue|wed|thu|fri|sat|sun) and (mon|tue|wed|thu|fri|sat|sun) are structurally similar/);
    if (same && (ignored.has(same[1] as DayKey) || ignored.has(same[2] as DayKey))) continue;
    if (line.startsWith(`${day} `) || line.includes(` and ${day} `)) errors.push(line);
  }
  return [...new Set(errors)];
}

function scoredStructureView(structure: StoredStructure) {
  return {
    format: structure.format,
    stimulus: structure.stimulus,
    movement_pattern: [...structure.movement_patterns].sort().join("+"),
    volume: structure.volume,
  };
}

export type SimilarityDecision = {
  score: number;
  threshold: number;
  compared_scope: "same_week" | "recent";
  candidate_day: string;
  compared_day: string;
  compared_week_id: number | null;
  compared_week_start: string | null;
  matched: SimilarityFeature[];
  judgment: "too_similar";
  candidate: ReturnType<typeof scoredStructureView>;
  compared: ReturnType<typeof scoredStructureView>;
};

/**
 * Hits only. The score, the matched features, and both sessions' four fields.
 * The threshold and the comparison itself stay in similarityDiagnostics.
 */
export function similarityDecisionLog(draft: WeekDraft, recent: readonly StoredStructure[]): SimilarityDecision[] {
  const fresh = draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null && !row.benchmark);
  const decisions: SimilarityDecision[] = [];
  for (let index = 0; index < fresh.length; index += 1) {
    const candidate = fresh[index]!;
    for (let other = index + 1; other < fresh.length; other += 1) {
      const compared = fresh[other]!;
      const hit = comparison(candidate, compared, "same_week");
      if (!hit.similar) continue;
      decisions.push({
        score: hit.score,
        threshold: hit.threshold,
        compared_scope: hit.compared_scope,
        candidate_day: hit.candidate_day,
        compared_day: hit.compared_day,
        compared_week_id: null,
        compared_week_start: null,
        matched: hit.matched,
        judgment: "too_similar",
        candidate: scoredStructureView(candidate),
        compared: scoredStructureView(compared),
      });
    }
    for (const prior of recent) {
      if (prior.benchmark) continue;
      const hit = comparison(candidate, prior, "recent");
      if (!hit.similar) continue;
      decisions.push({
        score: hit.score,
        threshold: hit.threshold,
        compared_scope: hit.compared_scope,
        candidate_day: hit.candidate_day,
        compared_day: hit.compared_day,
        compared_week_id: prior.source_week_id ?? null,
        compared_week_start: prior.source_week_start ?? null,
        matched: hit.matched,
        judgment: "too_similar",
        candidate: scoredStructureView(candidate),
        compared: scoredStructureView(prior),
      });
    }
  }
  return decisions;
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

/** 피로 신호는 목표 주 시작보다 14일이 넘으면 쓰지 않는다. 날짜가 없으면 직전 주로 본다. */
export const FATIGUE_TTL_DAYS = 14;

export function fatigueExpired(actual: WeekActual | null | undefined, weekStart?: string | null): boolean {
  if (!weekStart || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return false;
  const dates = (actual?.days ?? []).map((day) => day.date).filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
  if (!dates.length) return false;
  const latest = dates.slice().sort().at(-1)!;
  const gap = (Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${latest}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(gap) && gap > FATIGUE_TTL_DAYS;
}

export function actualWithoutStaleFatigue(actual: WeekActual | null | undefined, weekStart?: string | null): WeekActual | null | undefined {
  if (!actual || !fatigueExpired(actual, weekStart)) return actual;
  return {
    ...actual,
    class_summary: actual.class_summary ? { ...actual.class_summary, fatigue_signal: "low" } : actual.class_summary,
    days: actual.days.map((day) => ({ ...day, fatigue: day.fatigue ? "low" : day.fatigue })),
  };
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
    const domainRange = message.match(/time_domain=(\w+) duration=(\d+) is outside/);
    if (domainRange) {
      const days = keysFromLabels(message.split(":")[0] ?? "");
      return structured(message, {
        rule: "time_domain_range",
        constraint: "time_domain",
        priority: REPAIR_PRIORITY.schema,
        severity: "hard",
        current: Number(domainRange[2]),
        affected_session: days,
        affected_features: ["conditioning.duration_min", "conditioning.time_domain", "time_domain", "expected_duration", "conditioning.long_conditioning"],
      });
    }
    if (message.includes("long flag does not match")) {
      return structured(message, {
        rule: "long_conditioning_flag",
        constraint: "time_domain",
        priority: REPAIR_PRIORITY.schema,
        severity: "hard",
        affected_session: keysFromLabels(message.split(":")[0] ?? ""),
        affected_features: ["conditioning.long_conditioning", "conditioning.time_domain"],
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
    if (error.rule === "time_domain_range") {
      const day = error.affected_session[0] ?? "that day";
      const labeled = error.message.match(/time_domain=(\w+)/)?.[1] ?? "the previous label";
      const minutes = error.current;
      const required = minutes == null ? null : timeDomainForDuration(minutes);
      const ranges = `${TIME_DOMAIN_RANGES.short.min}–${TIME_DOMAIN_RANGES.short.max} short, ${TIME_DOMAIN_RANGES.medium.min}–${TIME_DOMAIN_RANGES.medium.max} medium, ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} long`;
      if (required && minutes != null) {
        return `Previous attempt set time_domain=${labeled} on ${day} while duration_min=${minutes}. duration_min chooses time_domain: ${ranges}. ${minutes} is ${required}, not ${labeled}. Set conditioning.time_domain and the session time_domain to ${required}, set expected_duration to ${minutes}, and set long_conditioning ${required === "long" ? "true" : "false"}. Do not rewrite other days.`;
      }
      return `Previous attempt set time_domain=${labeled} on ${day} while duration_min=${minutes ?? "unknown"} is outside ${TIME_DOMAIN_RANGES.short.min}–${TIME_DOMAIN_RANGES.long.max}. No legal time_domain contains that duration. Change duration_min into one bucket (${ranges}), then set time_domain from the new duration. Do not label an out-of-range duration as long. Do not rewrite other days.`;
    }
    if (error.rule === "long_conditioning_flag") {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt set long_conditioning incorrectly on ${day}. long_conditioning is true only when time_domain is long (${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} minutes). Set the flag from the domain after duration_min. Do not rewrite other days.`;
    }
    if (error.rule === "stimulus_repeat") {
      const stimulus = error.message.match(/^stimulus (\w+) repeats/)?.[1] ?? "that stimulus";
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt repeated stimulus ${stimulus} on ${day}, the same as the previous training day. Change conditioning.stimulus and the session stimulus on ${day} to a different allowed stimulus. A new movement name is not a stimulus change. Do not rewrite other days.`;
    }
    if (error.rule === "intent_prescription_mismatch") {
      return "Previous attempt wrote that lower-body load was reduced, but a squat or deadlift set is still heavier than the high-fatigue prescription. Remove that claim from why_ko, focus, and scheme_note, or the sets stay rejected. Do not leave the sentence in place while the sets stay heavy.";
    }
    if (error.rule === "schema" && error.message.includes("missing session fields") && error.message.includes("conditioning is null")) {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt left ${day} without a conditioning object: ${error.message}. Add conditioning on ${day} and fill metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration from it. Do not invent those fields without conditioning. Do not rewrite other days.`;
    }
    if (error.rule === "schema" && (error.message.includes("missing session fields") || error.message.includes("missing duration or load bands"))) {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt left ${day} incomplete: ${error.message}. Copy metcon_purpose, metcon_format, time_domain, stimulus, movement_combination, equipment, volume, intensity, and expected_duration from that day's conditioning object. Leave a field null only when conditioning does not have it. Do not rewrite a time_domain or duration_min that is already set. Do not rewrite other days.`;
    }
    if (error.rule === "schema" && error.message.includes("does not match")) {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt disagreed with itself on ${day}: ${error.message}. Session-level copies must equal that day's conditioning object. expected_duration equals duration_min, and both time_domain fields are the domain duration_min chooses. Do not overwrite a duration that is already inside its labeled domain. Do not rewrite other days.`;
    }
    if (error.rule === "schema" && error.message.includes("warmup is not")) {
      const day = error.affected_session[0] ?? "that day";
      return `Previous attempt set warmup_min outside 8–12 on ${day}. Set warmup_min to a minute from 8 through 12. A rest day stays at 0. Do not rewrite other days.`;
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
  return sessionHasHeavyLowerMetcon(session);
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
      const problem = lowerSetProblem(method, weekIndex, session, actual, lower);
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
    if (!session.strength || !strengthIsHeavy(session.strength.sets)) return false;
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

/**
 * Explanations are English. Display translation is later.
 * This stage does not reject a week. englishKoPath stays for that later pass.
 */
function koreanErrors(_draft: WeekDraft): string[] {
  return [];
}

/** Order problems a weekday swap can fix. The similarity threshold stays 4, and only neighboring training days count. */
export function orderViolations(draft: WeekDraft): string[] {
  const errors: string[] = [];
  const training = draft.sessions.filter((session) => !session.rest && session.conditioning);
  for (let index = 1; index < training.length; index += 1) {
    const previous = training[index - 1]!;
    const current = training[index]!;
    const previousStimulus = previous.conditioning?.stimulus;
    const currentStimulus = current.conditioning?.stimulus;
    if (previousStimulus && currentStimulus && previousStimulus === currentStimulus) {
      errors.push(`stimulus ${currentStimulus} repeats on ${current.day}`);
    }
    const left = toStructure(previous);
    const right = toStructure(current);
    if (left && right && structurallySimilar(left, right)) {
      const hit = comparison(left, right, "same_week");
      errors.push(`${previous.day} and ${current.day} are structurally similar score=${hit.score} matched=${hit.matched.join(",")}`);
    }
  }
  const sessions = byDay(draft);
  errors.push(
    ...safetyViolations(
      DAY_ORDER.map((day) => {
        const session = sessions.get(day);
        if (!session || session.rest) return null;
        const load = exposure(session);
        return {
          day,
          heavySquat: load.heavySquat,
          heavyDeadlift: load.heavyDeadlift,
          heavyPress: load.heavyPress,
          heavySnatch: load.heavySnatch,
          heavyClean: load.heavyClean,
          longConditioning: Boolean(session.conditioning?.long_conditioning) && session.zone2?.form !== "day",
        };
      }),
    ),
  );
  return [...new Set(errors)];
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
