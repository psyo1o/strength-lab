import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { setsMatchScheme, strengthIsHeavy } from "./schemes";
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
  | { ok: true; draft: WeekDraft }
  | { ok: false; reason: "schema" | "rule_break" | "too_similar"; detail: string };

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
  if (benchmark == null || patterns == null || equipment == null || !rep || !rest || duration == null || longPiece == null) {
    return null;
  }
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
    sessions.push({
      day: day as DayKey,
      rest,
      optional,
      warmup_min: warmup,
      warmup_ko: warmupKo,
      strength,
      conditioning,
    });
  }
  return { intent: { why_ko: why, focus, scheme_note: note }, sessions };
}

export function parseMonthDirection(value: unknown): MonthDirection | null {
  if (!isRecord(value)) return null;
  const body = isRecord(value.direction) ? value.direction : value;
  if (!isScheme(body.scheme)) return null;
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
  return {
    scheme: body.scheme,
    focus_ko: focus,
    why_ko: why,
    week_themes: themes,
    long_conditioning_weeks: longs,
    benchmark_week: benchmark,
    constraints,
  };
}

export function monthSchemaErrors(direction: MonthDirection, raw: unknown): string[] {
  const errors: string[] = [];
  const banned = bannedKey(raw, new Set([...BANNED_KEYS, ...MONTH_BANNED_KEYS]));
  if (banned) errors.push(`month contains ${banned}`);
  if (textHasInventedKg(raw)) errors.push("month invents kg");
  if (direction.long_conditioning_weeks.length !== 2) errors.push("long conditioning must be two weeks");
  if (new Set(direction.long_conditioning_weeks).size !== 2) errors.push("long conditioning weeks repeat");
  const weeks = new Set(direction.week_themes.map((row) => row.week_index));
  if (weeks.size !== 4) errors.push("week themes must cover four weeks");
  return errors;
}

function timeDomainFits(conditioning: ConditioningDraft): boolean {
  const minutes = conditioning.duration_min;
  if (conditioning.time_domain === "short") return minutes >= 1 && minutes <= 12;
  if (conditioning.time_domain === "medium") return minutes >= 13 && minutes <= 29;
  return minutes >= 30 && minutes <= 40;
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
      continue;
    }
    if (session.warmup_min < 8 || session.warmup_min > 12) errors.push(`${session.day} warmup is not 8–12`);
    if (!session.warmup_ko) errors.push(`${session.day} warmup text is empty`);
    if (!session.strength && !session.conditioning) errors.push(`${session.day} has no work`);
    if (!session.conditioning) continue;
    if (!timeDomainFits(session.conditioning)) errors.push(`${session.day} time domain does not match duration`);
    if (session.conditioning.long_conditioning !== (session.conditioning.time_domain === "long")) {
      errors.push(`${session.day} long flag does not match duration`);
    }
    const engineOnly =
      session.conditioning.movement_patterns.length === 1 && session.conditioning.movement_patterns[0] === "engine";
    if (session.conditioning.stimulus == null && !engineOnly && !session.conditioning.benchmark) {
      errors.push(`${session.day} stimulus must be heavy, high_rep, or technical`);
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
    if (session.strength && !setsMatchScheme(month.scheme, weekIndex, session.strength.sets)) {
      errors.push(`${day} sets do not match the month scheme`);
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
  if (expectsLong && longs.length !== 1) errors.push("this week needs one long conditioning piece");
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
export function similarityScore(left: StoredStructure, right: StoredStructure): number {
  let score = 0;
  for (const feature of Object.keys(SIMILARITY_CONFIG.features) as SimilarityFeature[]) {
    const weight = SIMILARITY_CONFIG.features[feature] ?? 0;
    if (weight <= 0) continue;
    if (featureValue(left, feature) === featureValue(right, feature)) score += weight;
  }
  return score;
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

export function similarityViolations(draft: WeekDraft, recent: readonly StoredStructure[]): string[] {
  const fresh = draft.sessions.map(toStructure).filter((row): row is StoredStructure => row != null && !row.benchmark);
  const errors: string[] = [];
  for (let index = 0; index < fresh.length; index += 1) {
    for (let other = index + 1; other < fresh.length; other += 1) {
      if (structurallySimilar(fresh[index]!, fresh[other]!)) {
        errors.push(`${fresh[index]!.day} and ${fresh[other]!.day} are structurally similar`);
      }
    }
    for (const prior of recent) {
      if (prior.benchmark) continue;
      if (structurallySimilar(fresh[index]!, prior)) errors.push(`${fresh[index]!.day} matches a recent structure`);
    }
  }
  return errors;
}

export function judgeWeek(
  raw: unknown,
  month: MonthDirection,
  weekIndex: 1 | 2 | 3 | 4,
  recent: readonly StoredStructure[],
): Judge {
  const draft = parseWeekDraft(raw);
  if (!draft) return { ok: false, reason: "schema", detail: "unreadable week" };
  const schema = weekSchemaErrors(draft, raw);
  if (schema.length) return { ok: false, reason: "schema", detail: schema[0]! };
  const rules = constitutionViolations(draft, month, weekIndex);
  if (rules.length) return { ok: false, reason: "rule_break", detail: rules[0]! };
  const similar = similarityViolations(draft, recent);
  if (similar.length) return { ok: false, reason: "too_similar", detail: similar[0]! };
  return { ok: true, draft };
}

export function liftOf(session: SessionDraft): MainLift | null {
  return session.strength?.lift ?? null;
}
