import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import { classMetconPurpose } from "../../wod/purpose";
import { fillSessionFields } from "../session-fields";
import { exampleSets, olympicSets, secondLowerVolumeSets } from "../strength-methods";
import { evaluateWeek } from "../evaluate-week";
import { similarityScore, toStructure, type WeekCheckContext } from "../rules";
import { strengthIsHeavy } from "../schemes";
import type { WeekActual } from "../summary";
import {
  STIMULI,
  type ConditioningDraft,
  type DayIntent,
  type IntensityBand,
  type MonthDirection,
  type MovementDraft,
  type SessionDraft,
  type Stimulus,
  type StoredStructure,
  type VolumeBand,
  type WeekDraft,
  type WeekIndex,
  type WeeklyIntentPlan,
  type WodFormat,
} from "../types";
import { timeDomainFromMinutes } from "./canonical";
import type { DaySessionLock } from "./session-contract";
import { clockForFormat, clockPresent, derivedFor, doseIssues, readClock, renderMetconLine, rxNumbers, sameClock } from "./session-contract";
import { clockForRecipe } from "./dose-menu";
import { applyLevelToSession, capFitsSession, judgeLevels, legalCaps } from "./intensity-levels";
import type { MetconClock } from "../types";
import { jointsFor, sessionJoints, warmupIssues } from "./warmup-ramp";
import { LONG_CONDITIONING, NON_LONG_CONDITIONING } from "./contract";
import { exactStrengthKey, strengthFamily } from "./goal-table";
import { catalogMovement, equipmentForKeys, type CatalogLoad, type CatalogUnit } from "./movement-catalog";
import { movementCatalog, recipePool, roleFor, type Recipe } from "./pieces";

const DAY_KO: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

function asStructure(day: DayKey, recipe: Recipe, benchmark: boolean): StoredStructure {
  const domain = timeDomainFromMinutes(recipe.minutes);
  return {
    day,
    format: recipe.format,
    time_domain: domain,
    stimulus: recipe.stimulus,
    movement_patterns: recipe.patterns,
    movements: recipe.movements,
    equipment: recipe.equipment,
    rep_structure: `${recipe.format}:${recipe.minutes}`,
    work_rest_structure: recipe.format,
    duration_min: recipe.minutes,
    volume: recipe.volume,
    intensity: recipe.intensity,
    benchmark,
    long_conditioning: domain === "long",
  };
}

function collides(candidate: StoredStructure, chosen: readonly StoredStructure[], recent: readonly StoredStructure[]): boolean {
  for (const row of chosen) {
    if (similarityScore(candidate, row) >= 4) return true;
  }
  for (const row of recent) {
    if (row.benchmark) continue;
    if (similarityScore(candidate, row) >= 4) return true;
  }
  return false;
}

function dosesOf(movements: MovementDraft[]) {
  return movements.map((movement) => ({
    key: movement.key,
    unit: (movement.unit === "cal" || movement.unit === "m" || movement.unit === "sec" || movement.unit === "min" ? movement.unit : "reps") as "reps" | "cal" | "m" | "sec" | "min",
    amount: movement.amount_value ?? (Number(String(movement.amount).replace(/[^\d]/g, "")) || 0),
    ...(Array.isArray(movement.qty) ? { qty: movement.qty } : {}),
  }));
}

function conditioningFrom(day: DayKey, recipe: Recipe, benchmark: boolean, clock: MetconClock | null): ConditioningDraft | null {
  const domain = timeDomainFromMinutes(recipe.minutes);
  const source = recipe.movements as MovementDraft[];
  const doses = dosesOf(source);
  const movements = source.map((movement, index) => {
    const rx = rxNumbers(movement.load);
    const dose = doses[index];
    return { ...movement, ...(rx ? { rx } : {}), qty: movement.qty ?? movement.amount_value ?? dose?.amount ?? null, unit: movement.unit ?? dose?.unit };
  });
  const resolved = clock ?? clockForFormat(recipe.format, recipe.minutes, movements.map((movement) => movement.key));
  const intensity = recipe.intensity === "light" || recipe.intensity === "moderate" || recipe.intensity === "heavy" ? recipe.intensity : null;
  const derived = recipe.format === "zone2"
    ? { sec: resolved.duration_sec ?? recipe.minutes * 60, rounds: null, time_source: "derived" as const }
    : derivedFor(recipe.format, recipe.minutes, doses, resolved, intensity);
  const line = renderMetconLine({
    format: recipe.format,
    clock: resolved,
    movements: movements.map((movement, index) => ({
      key: movement.key,
      amount: doses[index]?.amount ?? movement.amount_value,
      unit: doses[index]?.unit ?? movement.unit,
      qty: Array.isArray(movement.qty) ? movement.qty : doses[index]?.qty,
      load: movement.load,
    })),
  });
  return {
    benchmark,
    format: recipe.format,
    time_domain: domain,
    stimulus: recipe.stimulus,
    movement_patterns: [...recipe.patterns],
    movements,
    equipment: [...recipe.equipment],
    rep_structure: line,
    work_rest_structure: line,
    duration_min: recipe.minutes,
    volume: recipe.volume,
    intensity: recipe.intensity,
    long_conditioning: domain === "long",
    purpose: classMetconPurpose({
      names: recipe.movements.map((movement) => movement.name_ko),
      benchmark,
      longPiece: domain === "long",
      format: recipe.format,
      stimulus: recipe.stimulus,
    }),
    clock: resolved,
    ...(derived ? { derived_sec: derived.sec, derived_rounds: derived.rounds, time_source: "derived" as const } : {}),
  };
}

function stripCooldown(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() && !line.trim().toLowerCase().startsWith("cooldown"))
    .join("\n");
}

function warmup(day: DayKey, lift: MainLift | null): string {
  const label = DAY_KO[day];
  if (lift === "squat") return `${label} 스쿼트 전에 에어 스쿼트와 힙 힌지로 하체를 깨웁니다.`;
  if (lift === "deadlift") return `${label} 데드리프트 전에 힌지와 가벼운 스윙으로 뒤를 깨웁니다.`;
  if (lift === "bench" || lift === "ohp") return `${label} 누르기 전에 밴드 풀과 푸시업으로 어깨를 깨웁니다.`;
  return `${label} 본 운동 전에 호흡과 가동 범위를 먼저 맞춥니다.`;
}

export function pickRecipe(input: {
  intent: DayIntent;
  salt: number;
  previousStimulus: Stimulus | null;
  chosen: readonly StoredStructure[];
  recent: readonly StoredStructure[];
  shortClock: boolean;
  allowMono: boolean;
}): Recipe | null {
  const role = input.intent.benchmark ? "benchmark" : roleFor(input.intent.primary_training, input.intent.secondary_training);
  const ordered = recipePool({
    role,
    salt: input.salt,
    short: input.shortClock,
    long: role === "long",
    allowMono: input.allowMono,
  });
  for (const recipe of ordered) {
    if (role === "long" && timeDomainFromMinutes(recipe.minutes) !== "long") continue;
    if (role !== "long" && timeDomainFromMinutes(recipe.minutes) === "long") continue;
    if (input.shortClock && recipe.minutes > 12) continue;
    if (!input.allowMono && recipe.mono) continue;
    if (input.previousStimulus && recipe.stimulus === input.previousStimulus) continue;
    const structure = asStructure(input.intent.day, recipe, input.intent.benchmark);
    if (collides(structure, input.chosen, input.recent)) continue;
    return recipe;
  }
  return null;
}

function fatigueMode(actual: WeekActual | null | undefined): "high" | "low" | "unknown" {
  const signal = actual?.class_summary?.fatigue_signal;
  if (signal === "high") return "high";
  if (signal === "low") return "low";
  return "unknown";
}

function olympicBar(key: string | null | undefined): boolean {
  return Boolean(key && /clean|snatch/.test(key) && !key.startsWith("dumbbell"));
}

/** 세트표와 메인 블록은 골격 movement_id 하나에서 나온다. */
function strengthFor(
  lift: MainLift | null,
  month: MonthDirection,
  weekIndex: WeekIndex,
  actual: WeekActual | null | undefined,
  exposure?: "heavy" | "volume",
  movement?: string | null,
) {
  if (movement && olympicBar(movement)) {
    return { lift: "olympic" as const, sets: olympicSets(weekIndex), movement_key: movement };
  }
  const family = movement ? strengthFamily(movement) : "none";
  const resolved = family !== "none" ? family : lift;
  if (!resolved) return null;
  const mode = resolved === "squat" || resolved === "deadlift" ? fatigueMode(actual) : "unknown";
  const key = movement && strengthFamily(movement) === resolved ? movement : exactStrengthKey(resolved, weekIndex);
  if (exposure === "volume" && mode === "high" && (resolved === "squat" || resolved === "deadlift")) {
    const volume = secondLowerVolumeSets(month.strength_method || month.scheme, weekIndex);
    if (volume) return { lift: resolved, sets: volume, movement_key: key };
  }
  const sets = exampleSets(month.strength_method || month.scheme, weekIndex, mode, resolved);
  if (!sets) return null;
  return { lift: resolved, sets, movement_key: key };
}

const FORMATS = ["amrap", "for_time", "emom", "intervals", "chipper", "partner", "zone2"] as const;
type StoredUnit = CatalogUnit | "min";

function splitStoredAmount(amount: string, unit: StoredUnit | undefined): { amount: string; unit?: StoredUnit; amount_value?: number } {
  const text = amount.replace(/\s/g, "");
  const paired = text.match(/^(\d+)(min|cal|sec|m)$/i);
  if (!paired) {
    if (/^\d+$/.test(text) && unit) return { amount: text, unit, amount_value: Number(text) };
    return unit ? { amount, unit } : { amount };
  }
  const parsed = paired[2]!.toLowerCase() as StoredUnit;
  const chosen = unit ?? parsed;
  return { amount: paired[1]!, unit: chosen, amount_value: Number(paired[1]) };
}

function hangul(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text) && !/kg|킬로/i.test(text);
}

/**
 * Accepts one day's coaching JSON. time_domain in the payload is ignored.
 * Sets come from the method table. The server stamps the clock from duration_min.
 */
/** 코드가 정한 존 2. 모델이 옵션을 비우면 이 값을 쓰고, 잘못된 옵션을 내면 거절한다. */
function zone2OwnedByIntent(intent: DayIntent): SessionDraft["zone2"] | null {
  if (intent.zone2 !== "day") return null;
  const modality = intent.zone2_modality;
  const duration = intent.zone2_duration;
  if (modality !== "row_erg" && modality !== "bike_erg" && modality !== "run") return null;
  if (duration !== 30 && duration !== 40 && duration !== 45) return null;
  return {
    form: "day",
    modality,
    duration_min: duration,
    effort: intent.zone2_effort || "conversational",
    hr: intent.zone2_hr || "unspecified",
    alternate: null,
    performed_option: null,
    completion_status: null,
    actual_duration_min: null,
    actual_rpe: null,
  };
}

function zone2FromOption(value: unknown, required: boolean): SessionDraft["zone2"] | null {
  if (!required) return null;
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  const primary = body.primary;
  const alternate = body.alternate;
  if (!primary || typeof primary !== "object" || !alternate || typeof alternate !== "object") return null;
  const zone = primary as Record<string, unknown>;
  const metcon = alternate as Record<string, unknown>;
  if (typeof zone.modality !== "string" || typeof zone.duration_min !== "number") return null;
  if (metcon.kind !== "short_metcon" || !Array.isArray(metcon.movements)) return null;
  if (metcon.format !== "emom" && metcon.format !== "intervals" && metcon.format !== "amrap") return null;
  return {
    form: "day",
    modality: zone.modality,
    duration_min: zone.duration_min,
    effort: typeof zone.effort === "string" ? zone.effort : "",
    hr: typeof zone.hr === "string" ? zone.hr : "unspecified",
    alternate: {
      kind: "short_metcon",
      format: metcon.format,
      duration_min: typeof metcon.duration_min === "number" ? metcon.duration_min : 0,
      rpe: typeof metcon.rpe === "string" ? metcon.rpe : "",
      intensity: typeof metcon.intensity === "number" ? metcon.intensity : 0,
      movements: metcon.movements as MovementDraft[],
    },
    performed_option: null,
    completion_status: null,
    actual_duration_min: null,
    actual_rpe: null,
  };
}

function serverRecipeClock(
  lock: DaySessionLock,
  minutes: number,
  movements: readonly { key: string; unit?: string; amount_value?: number }[],
  echoed: MetconClock,
): boolean {
  const keys = movements.map((movement) => movement.key);
  if (keys.join("|") !== lock.metcon.map((move) => move.key).join("|")) return false;
  if (!legalCaps(lock).includes(minutes)) return false;
  if (!sameClock(echoed, clockForRecipe(lock.format, minutes, echoed.rounds, keys))) return false;
  const doses: { key: string; unit: "reps" | "cal" | "m" | "sec" | "min"; amount: number }[] = [];
  for (const movement of movements) {
    const unit = movement.unit === "reps" || movement.unit === "cal" || movement.unit === "m" || movement.unit === "sec" || movement.unit === "min" ? movement.unit : null;
    if (!unit || typeof movement.amount_value !== "number") return false;
    doses.push({ key: movement.key, unit, amount: movement.amount_value });
  }
  if (doses.length !== movements.length) return false;
  return doseIssues({ format: lock.format, minutes, movements: doses, clock: echoed, intensity: "moderate" }).length === 0;
}

export function sessionFromCoachJson(input: {
  json: unknown;
  intent: DayIntent;
  month: MonthDirection;
  weekIndex: WeekIndex;
  actual?: WeekActual | null;
  /** Scores a short piece for a retry hint. Adoption still requires the real minimum. */
  preview?: boolean;
  lock?: DaySessionLock | null;
}): SessionDraft | null {
  if (!input.json || typeof input.json !== "object") return null;
  const body = input.json as Record<string, unknown>;
  if (body.day !== input.intent.day) return null;
  if (input.intent.primary_training === "rest" || input.intent.recovery_role === "rest") return null;
  const conditioning = body.conditioning;
  if (!conditioning || typeof conditioning !== "object") return null;
  const piece = conditioning as Record<string, unknown>;
  const format = piece.format;
  const zone2Day = input.intent.zone2 === "day";
  if (typeof format !== "string" || !(FORMATS as readonly string[]).includes(format)) return null;
  if (!zone2Day && format === "zone2") return null;
  const minutes = piece.duration_min;
  const longPiece = input.intent.secondary_training === "long_conditioning";
  const steadyZone2 = input.intent.zone2 === "day" && typeof minutes === "number" && minutes >= 30 && minutes <= 45;
  const range = longPiece ? LONG_CONDITIONING : steadyZone2 ? { min: 30, max: 45 } : NON_LONG_CONDITIONING;
  if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < range.min || minutes > range.max) return null;
  const stimulus = piece.stimulus;
  if (typeof stimulus !== "string" || !(STIMULI as readonly string[]).includes(stimulus)) return null;
  const volume = piece.volume;
  const intensity = piece.intensity;
  if (volume !== "low" && volume !== "moderate" && volume !== "high") return null;
  if (intensity !== "light" && intensity !== "moderate" && intensity !== "heavy") return null;
  const aerobicMono = input.intent.primary_training === "aerobic" && input.intent.secondary_training !== "long_conditioning";
  const minMoves = input.preview || aerobicMono || format === "zone2" ? 1 : 2;
  if (!Array.isArray(piece.movements) || piece.movements.length < minMoves || piece.movements.length > 5) return null;
  const catalog = new Map(movementCatalog().map((row) => [row.key, row.name_ko]));
  const movements = [];
  for (const row of piece.movements) {
    if (!row || typeof row !== "object") return null;
    const movement = row as Record<string, unknown>;
    if (typeof movement.key !== "string" || typeof movement.amount !== "string" || typeof movement.name_ko !== "string") return null;
    if (!hangul(movement.name_ko) || /kg/i.test(movement.amount)) return null;
    const piecesName = catalog.get(movement.key);
    const standardName = catalogMovement(movement.key)?.name_ko ?? null;
    if (!piecesName && !standardName) return null;
    if (movement.name_ko !== piecesName && movement.name_ko !== standardName) return null;
    const declared =
      movement.unit === "reps" || movement.unit === "cal" || movement.unit === "m" || movement.unit === "sec" || movement.unit === "min"
        ? movement.unit
        : undefined;
    const stored = splitStoredAmount(movement.amount, declared);
    const load = storedLoad(movement.load);
    movements.push({
      key: movement.key,
      amount: stored.amount,
      name_ko: movement.name_ko,
      ...(typeof movement.movement === "string" ? { movement: movement.movement } : {}),
      ...(stored.amount_value != null ? { amount_value: stored.amount_value } : typeof movement.amount_value === "number" ? { amount_value: movement.amount_value } : {}),
      ...(stored.unit ? { unit: stored.unit } : {}),
      ...(load ? { load } : {}),
    });
  }
  const equipment = equipmentForKeys(movements.map((movement) => movement.key));
  if (longPiece && timeDomainFromMinutes(minutes) !== "long") return null;
  if (!longPiece && !steadyZone2 && timeDomainFromMinutes(minutes) === "long") return null;
  const recipe: Recipe = {
    id: "model",
    roles: [],
    format: format as WodFormat,
    minutes,
    stimulus: stimulus as Stimulus,
    patterns: input.intent.movement_pattern === "mixed" || input.intent.movement_pattern === "none" ? ["engine"] : [input.intent.movement_pattern],
    movements,
    equipment,
    intensity: intensity as IntensityBand,
    volume: volume as VolumeBand,
    mono: movements.length < 2,
  };
  const namedLift = input.intent.strength_lift;
  const lift = namedLift && namedLift !== "none" ? namedLift : null;
  const strength = strengthFor(lift, input.month, input.weekIndex, input.actual, input.intent.lower_exposure, input.intent.main_movement);
  const warmupText = typeof body.warmup_ko === "string" && body.warmup_ko.trim() ? stripCooldown(body.warmup_ko) : warmup(input.intent.day, strength?.lift === "olympic" ? null : strength?.lift ?? null);
  const echoed = readClock(piece);
  if (input.lock && !input.lock.rest && clockPresent(piece)) {
    const matchesLock = echoed != null && sameClock(echoed, input.lock.clock);
    const matchesServer = echoed != null && serverRecipeClock(input.lock, minutes, movements, echoed);
    if (!matchesLock && !matchesServer) return null;
  }
  if (input.intent.zone2 === "day") recipe.format = "zone2";
  let clock = echoed ?? (input.lock && !input.lock.rest ? input.lock.clock : null);
  if (!input.lock && format === "intervals" && typeof piece.interval_work_sec === "number" && typeof piece.interval_rest_sec === "number") {
    const base = clock ?? clockForFormat("intervals", minutes, movements.map((movement) => movement.key));
    clock = { ...base, work_sec: piece.interval_work_sec, rest_sec: piece.interval_rest_sec, sets: minutes, duration_sec: minutes * 60 };
  }
  const built = conditioningFrom(input.intent.day, recipe, input.intent.benchmark, clock);
  if (!built) return null;
  const zone2 =
    input.intent.zone2 === "day"
      ? body.zone2_option == null
        ? zone2OwnedByIntent(input.intent)
        : zone2FromOption(body.zone2_option, true)
      : null;
  if (input.intent.zone2 === "day" && !zone2) return null;
  const session = fillSessionFields(
    {
      day: input.intent.day,
      rest: false,
      optional: input.intent.day === "sat",
      warmup_min: 10,
      warmup_ko: warmupText,
      strength,
      conditioning: built,
      ...(zone2 ? { zone2 } : {}),
    },
    strength ? (input.intent.volume_profile === "low" ? "low" : "moderate") : null,
  );
  if (Array.isArray(body.session_blocks)) session.session_blocks = body.session_blocks as SessionDraft["session_blocks"];
  const metconBlock = session.session_blocks?.find((block) => block.role === "metcon");
  if (metconBlock && built.derived_sec != null) {
    metconBlock.derived_sec = built.derived_sec;
    metconBlock.time_source = "derived";
  }
  if (Array.isArray(body.warmup_phases)) session.warmup_phases = body.warmup_phases as SessionDraft["warmup_phases"];
  if (input.lock && !input.lock.steady && input.lock.format !== "zone2" && body.prescription_levels) {
    const judged = judgeLevels(body.prescription_levels, input.lock);
    if (judged) {
      session.levels = judged;
      const level3 = judged.levels.find((row) => row.level === 3);
      if (level3?.status === "pass" && level3.cap_min != null && capFitsSession(level3.cap_min, longPiece)) {
        applyLevelToSession(session, level3);
      }
    }
  }
  const warmupBlock = session.session_blocks?.find((block) => block.role === "warmup");
  if (warmupBlock) session.warmup_min = warmupBlock.minutes;
  if (session.warmup_phases?.length) {
    const verdict = warmupIssues({
      picks: session.warmup_phases,
      joints: input.lock ? sessionJoints(input.lock) : jointsFor([], strength?.lift ?? null),
      warmupMinutes: warmupBlock?.minutes ?? session.warmup_min,
      cooldownMinutes: session.session_blocks?.find((block) => block.role === "cooldown")?.minutes ?? 0,
    });
    if (verdict.reject.length) return null;
  }
  if (input.intent.zone2 === "day") applySteadyZone2(session, input.intent);
  return session;
}

function applySteadyZone2(session: SessionDraft, intent: DayIntent) {
  const zone = session.zone2;
  if (!zone || zone.form !== "day") return;
  const minutes = zone.duration_min === 45 ? 45 : 40;
  const key = zone.modality === "bike_erg" || zone.modality === "run" || zone.modality === "row_erg" ? zone.modality : "row_erg";
  const name = catalogMovement(key)?.name_ko;
  const piece = session.conditioning;
  if (!name || !piece) return;
  const stimulus = "aerobic" as const;
  const patterns: Array<"engine" | "pull"> = intent.companion_movement && /row|pull|core/i.test(intent.companion_movement) ? ["engine", "pull"] : ["engine"];
  const clock = clockForFormat("zone2", minutes, [key]);
  const line = renderMetconLine({
    format: "zone2",
    clock,
    movements: [{ key, amount: minutes, unit: "min" }],
  });
  const conditioning: NonNullable<SessionDraft["conditioning"]> = {
    ...piece,
    format: "zone2",
    time_domain: "long",
    stimulus,
    movement_patterns: patterns,
    movements: [{ key, amount: `${minutes}분`, name_ko: name, amount_value: minutes, unit: "min", qty: minutes }],
    equipment: equipmentForKeys([key]),
    rep_structure: line,
    work_rest_structure: line,
    duration_min: minutes,
    volume: "low",
    intensity: "light",
    long_conditioning: false,
    purpose: `${name} ${minutes}분, RPE 2–3. 고강도 메트콘은 두지 않습니다.`,
    clock,
    derived_sec: clock.duration_sec,
    derived_rounds: null,
    time_source: "derived",
  };
  session.conditioning = conditioning;
  session.stimulus = stimulus;
  session.metcon_format = "zone2";
  session.time_domain = "long";
  session.volume = "low";
  session.intensity = "light";
  session.expected_duration = minutes;
  session.metcon_purpose = conditioning.purpose;
  const metcon = session.session_blocks?.find((block) => block.role === "metcon");
  if (metcon) {
    metcon.minutes = minutes;
    metcon.movements = [{ key, unit: "min", amount: minutes }];
    if (clock.duration_sec != null) {
      metcon.derived_sec = clock.duration_sec;
      metcon.time_source = "derived";
    }
  }
}

export function buildSession(input: {
  intent: DayIntent;
  month: MonthDirection;
  weekIndex: WeekIndex;
  actual?: WeekActual | null;
  salt: number;
  previousStimulus: Stimulus | null;
  chosen: readonly StoredStructure[];
  recent: readonly StoredStructure[];
  shortClock: boolean;
}): SessionDraft | null {
  const day = input.intent;
  if (day.primary_training === "rest" || day.recovery_role === "rest") {
    return fillSessionFields({
      day: day.day,
      rest: true,
      optional: false,
      warmup_min: 0,
      warmup_ko: "",
      strength: null,
      conditioning: null,
    });
  }
  const longPiece = day.secondary_training === "long_conditioning";
  const namedLift = day.strength_lift;
  const lift = namedLift && namedLift !== "none" ? namedLift : null;
  const recipe = pickRecipe({
    intent: day,
    salt: input.salt,
    previousStimulus: input.previousStimulus,
    chosen: input.chosen,
    recent: input.recent,
    shortClock: input.shortClock && !longPiece,
    allowMono: day.primary_training === "aerobic" && day.secondary_training !== "long_conditioning",
  });
  if (!recipe) return null;
  const scaled = longPiece ? recipe : { ...recipe, minutes: input.shortClock ? Math.min(recipe.minutes, 12) : recipe.minutes };
  if (!longPiece && timeDomainFromMinutes(scaled.minutes) === "long") return null;
  const conditioning = conditioningFrom(day.day, scaled, day.benchmark, null);
  if (!conditioning) return null;
  const strength = strengthFor(lift, input.month, input.weekIndex, input.actual, day.lower_exposure, day.main_movement);
  return fillSessionFields(
    {
      day: day.day,
      rest: false,
      optional: day.day === "sat",
      warmup_min: 10,
      warmup_ko: warmup(day.day, strength?.lift === "olympic" ? null : strength?.lift ?? null),
      strength,
      conditioning,
    },
    strength ? (day.volume_profile === "low" ? "low" : "moderate") : null,
  );
}

function heavyLowerDay(session: SessionDraft | undefined): boolean {
  if (!session?.strength) return false;
  if (session.strength.lift !== "squat" && session.strength.lift !== "deadlift") return false;
  return strengthIsHeavy(session.strength.sets);
}

export function assembleWeek(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  plan: WeeklyIntentPlan;
  actual?: WeekActual | null;
  recent?: readonly StoredStructure[];
  recentLiftMaps?: readonly string[];
  salt?: number;
}): { draft: WeekDraft; judgeOk: boolean; errors: string[] } {
  const salt = input.salt ?? 0;
  const recent = input.recent ?? [];
  const sessions: SessionDraft[] = [];
  const chosen: StoredStructure[] = [];
  let previousStimulus: Stimulus | null = null;
  for (const intent of input.plan.days) {
    const previous = sessions[sessions.length - 1];
    const shortClock = heavyLowerDay(previous);
    const session = buildSession({
      intent,
      month: input.month,
      weekIndex: input.weekIndex,
      actual: input.actual,
      salt: salt + DAY_ORDER.indexOf(intent.day),
      previousStimulus,
      chosen,
      recent,
      shortClock,
    });
    if (!session) {
      return {
        draft: {
          intent: { why_ko: input.plan.why_ko, focus: input.plan.focus, scheme_note: input.plan.scheme_note, plan: input.plan },
          sessions,
        },
        judgeOk: false,
        errors: [`${intent.day} has no legal piece`],
      };
    }
    sessions.push(session);
    const structure = toStructure(session);
    if (structure && !session.rest) {
      chosen.push(structure);
      previousStimulus = session.conditioning?.stimulus ?? previousStimulus;
    }
  }
  const draft: WeekDraft = {
    intent: {
      why_ko: input.plan.why_ko,
      focus: input.plan.focus,
      scheme_note: input.plan.scheme_note,
      plan: input.plan,
    },
    sessions,
  };
  const judged = evaluateWeek(bare(draft), input.month, input.weekIndex, recent, context(input.actual, input.recentLiftMaps));
  return { draft, judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors };
}

export function assembleLegalWeek(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  plan: WeeklyIntentPlan;
  actual?: WeekActual | null;
  recent?: readonly StoredStructure[];
  recentLiftMaps?: readonly string[];
}): { draft: WeekDraft; judgeOk: boolean; errors: string[]; salt: number } {
  let last = assembleWeek({ ...input, salt: 0 });
  if (last.judgeOk) return { ...last, salt: 0 };
  for (let salt = 1; salt < 12; salt += 1) {
    const next = assembleWeek({ ...input, salt });
    last = next;
    if (next.judgeOk) return { ...next, salt };
  }
  return { ...last, salt: 11 };
}

export function replaceDays(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  plan: WeeklyIntentPlan;
  draft: WeekDraft;
  days: readonly DayKey[];
  actual?: WeekActual | null;
  recent?: readonly StoredStructure[];
  recentLiftMaps?: readonly string[];
  salt: number;
}): { draft: WeekDraft; judgeOk: boolean; errors: string[] } {
  const sessions = input.draft.sessions.map((session) => ({ ...session }));
  for (const day of input.days) {
    const intent = input.plan.days.find((row) => row.day === day);
    const index = sessions.findIndex((session) => session.day === day);
    if (!intent || index < 0) continue;
    const others = sessions.filter((session) => session.day !== day);
    const chosen = others.map(toStructure).filter((row): row is StoredStructure => row != null);
    const previous = sessions[index - 1];
    const built = buildSession({
      intent,
      month: input.month,
      weekIndex: input.weekIndex,
      actual: input.actual,
      salt: input.salt + 5,
      previousStimulus: previous?.conditioning?.stimulus ?? null,
      chosen,
      recent: input.recent ?? [],
      shortClock: heavyLowerDay(previous),
    });
    if (built) sessions[index] = built;
  }
  const draft: WeekDraft = { ...input.draft, sessions };
  const judged = evaluateWeek(bare(draft), input.month, input.weekIndex, input.recent ?? [], context(input.actual, input.recentLiftMaps));
  return { draft, judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors };
}

function bare(draft: WeekDraft): WeekDraft {
  return {
    ...draft,
    intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
  };
}

function storedLoad(value: unknown): CatalogLoad | null {
  if (!value || typeof value !== "object") return null;
  const load = value as { male?: unknown; female?: unknown };
  const male = typeof load.male === "string" ? load.male : null;
  const female = typeof load.female === "string" ? load.female : null;
  if (!male && !female) return null;
  return { male, female };
}

function context(actual: WeekActual | null | undefined, maps: readonly string[] | undefined): WeekCheckContext {
  return { previousActual: actual ?? null, recentLiftMaps: maps ?? [] };
}
