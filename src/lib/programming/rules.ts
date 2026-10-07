import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { isWodPurpose } from "../wod/purpose";
import { completeMonthDirection } from "./month-direction";
import { strengthIsHeavy } from "./schemes";
import { exampleSets, legacySchemeForMethod, validateStrengthPrescription } from "./strength-methods";
import type { WeekActual } from "./summary";
import {
  EQUIPMENT,
  MOVEMENT_PATTERNS,
  SIMILARITY_CONFIG,
  STIMULI,
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
      reason: "schema" | "language" | "rule_break" | "feedback" | "weekday_pattern" | "too_similar";
      detail: string;
      errors: string[];
      normalizations: string[];
    };

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

function timeDomainFits(conditioning: ConditioningDraft): boolean {
  const minutes = conditioning.duration_min;
  const range = TIME_DOMAIN_RANGES[conditioning.time_domain];
  return minutes >= range.min && minutes <= range.max;
}

export function weekSchemaErrors(draft: WeekDraft, raw: unknown): string[] {
  const errors: string[] = [];
  const banned = bannedKey(raw, BANNED_KEYS);
  if (banned) errors.push(`week contains ${banned}`);
  if (textHasInventedKg(draft)) errors.push("week invents kg");
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

export function constitutionViolations(draft: WeekDraft, month: MonthDirection, weekIndex: 1 | 2 | 3 | 4): string[] {
  const errors = [...weekSchemaErrors(draft, draft)];
  const sessions = byDay(draft);
  const exposures = new Map<DayKey, Exposure>();
  for (const day of DAY_ORDER) {
    const session = sessions.get(day);
    if (!session) continue;
    exposures.set(day, exposure(session));
    if (session.strength) {
      const lower = session.strength.lift === "squat" || session.strength.lift === "deadlift";
      const voluntaryCut = session.strength_volume === "low" && lower;
      const problem = validateStrengthPrescription(month.strength_method || month.scheme, session.strength.sets, {
        day,
        weekIndex,
        lift: session.strength.lift,
        fatigue: voluntaryCut ? "high" : "unknown",
      });
      if (problem) errors.push(problem);
    }
  }
  for (let index = 0; index < DAY_ORDER.length - 1; index += 1) {
    const today = exposures.get(DAY_ORDER[index]!);
    const next = exposures.get(DAY_ORDER[index + 1]!);
    if (!today || !next) continue;
    if (today.heavySquat && (next.heavySnatch || next.heavyClean || next.heavyDeadlift)) {
      errors.push(`heavy pull the day after squat (${today.day})`);
    }
    if (today.heavyDeadlift && next.heavySquat) errors.push(`heavy squat the day after deadlift (${today.day})`);
    if (today.heavyPress && next.heavySnatch) errors.push(`heavy snatch the day after press (${today.day})`);
    const nextSession = sessions.get(DAY_ORDER[index + 1]!);
    if ((today.heavySquat || today.heavyDeadlift) && nextSession?.conditioning?.long_conditioning) {
      errors.push(`${nextSession.day} long conditioning follows a heavy squat or deadlift`);
    }
  }
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
  if (expectsLong && longs.length !== 1) {
    errors.push(
      `this week needs one long conditioning piece; weekly_requirements.long_conditioning_sessions_min=1 current=${longs.length} long means ${TIME_DOMAIN_RANGES.long.min}–${TIME_DOMAIN_RANGES.long.max} minutes`,
    );
  }
  if (!expectsLong && longs.length !== 0) errors.push("this week is not a long-conditioning week");
  for (const session of longs) {
    const minutes = session.conditioning?.duration_min ?? 0;
    if (minutes < 30 || minutes > 40) errors.push(`${session.day} long piece is not 30–40 minutes`);
    const load = exposures.get(session.day);
    if (load?.heavySquat || load?.heavyDeadlift) errors.push(`${session.day} long piece sits on a heavy squat or deadlift`);
  }
  const benchmarks = draft.sessions.filter((session) => session.conditioning?.benchmark);
  if (weekIndex === month.benchmark_week && benchmarks.length !== 1) errors.push("benchmark week needs one benchmark");
  if (weekIndex !== month.benchmark_week && benchmarks.length !== 0) errors.push("benchmark is only on the benchmark week");
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

const LOWER_LIFTS = new Set<MainLift>(["squat", "deadlift"]);
const REDUCED_INTENT = /하체.{0,16}(줄|낮|적)|볼륨을 줄|세트를 줄|부담을 줄|줄였|낮췄/;

export function previousLowerFatigue(actual: WeekActual | null | undefined): "high" | "moderate" | "low" | "unknown" {
  const signal = actual?.class_summary?.fatigue_signal;
  const volume = actual?.class_summary?.actual_volume;
  if (signal === "high" || volume === "high") return "high";
  if (signal === "low") return "low";
  if (signal === "moderate") return "moderate";
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
  const fatigue = level === "high" || level === "low" ? level : "unknown";
  const upper = exampleSets(method, weekIndex, "unknown", "bench");
  const lower = exampleSets(method, weekIndex, fatigue, "squat");
  const lowerHeavy = (lower ?? []).some((set) => set.percent_of_tm >= 85);
  const limits = hardConstraints(actual);
  return {
    equation: "method rule + current state constraint = the sets you may write",
    current_fatigue: level,
    upper_body_sets: upper,
    lower_body_sets: lower,
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

export type StructuredValidationError = {
  day: string | null;
  rule: string;
  current: number | null;
  maximum: number | null;
  severity: "hard" | "weekly_requirement";
  message: string;
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

function labelToDay(label: string): string {
  return label
    .split(",")
    .map((part) => LABEL_TO_DAY[part.trim()] ?? part.trim().toLowerCase())
    .join(",");
}

/** Turns a judge error into the retry object. The original sentence stays on `message`. */
export function structureValidationErrors(errors: readonly string[]): StructuredValidationError[] {
  return errors.map((message) => {
    const heavy = message.match(/heavy lower sessions (\d+) exceed hard_constraints\.heavy_lower_sessions_max=(\d+)/);
    if (heavy) {
      return {
        day: labelToDay(message.split(":")[0] ?? ""),
        rule: "heavy_lower_sessions_max",
        current: Number(heavy[1]),
        maximum: Number(heavy[2]),
        severity: "hard" as const,
        message,
      };
    }
    const metcon = message.match(/^([^:]+): heavy lower metcon exceeds/);
    if (metcon) {
      return {
        day: labelToDay(metcon[1] ?? ""),
        rule: "heavy_lower_metcon",
        current: 1,
        maximum: 0,
        severity: "hard" as const,
        message,
      };
    }
    if (message.includes("long conditioning") || message.includes("long_conditioning_sessions")) {
      const current = message.match(/current=(\d+)/);
      return {
        day: null,
        rule: "long_conditioning_sessions_min",
        current: current ? Number(current[1]) : 0,
        maximum: 1,
        severity: "weekly_requirement" as const,
        message,
      };
    }
    const named = message.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);
    return {
      day: named ? labelToDay(named[1] ?? "") : null,
      rule: "validation",
      current: null,
      maximum: null,
      severity: "hard" as const,
      message,
    };
  });
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
        fatigue: level,
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
  if (REDUCED_INTENT.test(text) && keptHeavy) {
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

export function weekdayPatternViolations(draft: WeekDraft, recentMaps: readonly string[], allowRepeat: boolean): string[] {
  if (allowRepeat || recentMaps.length < 2) return [];
  const current = liftMapKey(draft);
  const lastTwo = recentMaps.slice(-2);
  if (lastTwo.every((map) => map === current)) return ["weekday strength layout repeats the previous two weeks"];
  return [];
}

function koreanErrors(value: unknown): string[] {
  const found = englishKoPath(value);
  return found ? [found] : [];
}

function failed(
  reason: Extract<Judge, { ok: false }>["reason"],
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
  const constitution = constitutionViolations(draft, month, weekIndex);
  const scheme = constitution.filter((error) => error.includes("sets do not match"));
  const sameWeek = constitution.filter((error) => !schema.includes(error) && !error.includes("sets do not match"));
  const stages: Array<{ reason: "schema" | "rule_break" | "feedback" | "weekday_pattern" | "too_similar" | "language"; errors: string[] }> = [
    { reason: "schema", errors: schema },
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
  const errors = hit.flatMap((stage) => stage.errors);
  return failed(hit[0]!.reason, errors, normalized.normalizations);
}

export function liftOf(session: SessionDraft): MainLift | null {
  return session.strength?.lift ?? null;
}
