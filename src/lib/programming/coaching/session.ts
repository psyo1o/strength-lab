import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import { classMetconPurpose } from "../../wod/purpose";
import { fillSessionFields } from "../session-fields";
import { exampleSets } from "../strength-methods";
import { judgeWeek, similarityScore, toStructure, type WeekCheckContext } from "../rules";
import { strengthIsHeavy } from "../schemes";
import type { WeekActual } from "../summary";
import {
  EQUIPMENT,
  STIMULI,
  type ConditioningDraft,
  type DayIntent,
  type Equipment,
  type IntensityBand,
  type MonthDirection,
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
import { recipePool, roleFor, type Recipe } from "./pieces";

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

function conditioningFrom(day: DayKey, recipe: Recipe, benchmark: boolean): ConditioningDraft {
  const names = recipe.movements.map((movement) => movement.name_ko).join(", ");
  const domain = timeDomainFromMinutes(recipe.minutes);
  const rep =
    domain === "long"
      ? `3라운드. 캡 ${recipe.minutes}분. ${names}.`
      : recipe.format === "emom"
        ? `${recipe.minutes}분 동안 1분마다 ${names}.`
        : recipe.format === "intervals"
          ? `${recipe.minutes}분 인터벌. 40초 일하고 20초 쉽니다. ${names}.`
          : recipe.format === "for_time"
            ? `3라운드. 캡 ${recipe.minutes}분. ${names}.`
            : `${recipe.minutes}분 동안 반복합니다. ${names}.`;
  return {
    benchmark,
    format: recipe.format,
    time_domain: domain,
    stimulus: recipe.stimulus,
    movement_patterns: [...recipe.patterns],
    movements: recipe.movements.map((movement) => ({ ...movement })),
    equipment: [...recipe.equipment],
    rep_structure: rep,
    work_rest_structure: `캡 ${recipe.minutes}분 안에 마칩니다.`,
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
  };
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

function strengthFor(lift: MainLift, month: MonthDirection, weekIndex: WeekIndex, actual: WeekActual | null | undefined) {
  const mode = lift === "squat" || lift === "deadlift" ? fatigueMode(actual) : "unknown";
  const sets = exampleSets(month.strength_method || month.scheme, weekIndex, mode, lift);
  if (!sets) return null;
  return { lift, sets };
}

const FORMATS = ["amrap", "for_time", "emom", "intervals"] as const;

function hangul(text: string): boolean {
  return /[\uac00-\ud7a3]/.test(text) && !/kg|킬로/i.test(text);
}

/**
 * Accepts one day's coaching JSON. time_domain in the payload is ignored.
 * Sets come from the method table. The server stamps the clock from duration_min.
 */
export function sessionFromCoachJson(input: {
  json: unknown;
  intent: DayIntent;
  month: MonthDirection;
  weekIndex: WeekIndex;
  actual?: WeekActual | null;
}): SessionDraft | null {
  if (!input.json || typeof input.json !== "object") return null;
  const body = input.json as Record<string, unknown>;
  if (body.day !== input.intent.day) return null;
  if (input.intent.primary_training === "rest" || input.intent.recovery_role === "rest") return null;
  const conditioning = body.conditioning;
  if (!conditioning || typeof conditioning !== "object") return null;
  const piece = conditioning as Record<string, unknown>;
  const format = piece.format;
  if (typeof format !== "string" || !(FORMATS as readonly string[]).includes(format)) return null;
  const minutes = piece.duration_min;
  if (typeof minutes !== "number" || minutes < 1 || minutes > 40) return null;
  const stimulus = piece.stimulus;
  if (typeof stimulus !== "string" || !(STIMULI as readonly string[]).includes(stimulus)) return null;
  const volume = piece.volume;
  const intensity = piece.intensity;
  if (volume !== "low" && volume !== "moderate" && volume !== "high") return null;
  if (intensity !== "light" && intensity !== "moderate" && intensity !== "heavy") return null;
  if (!Array.isArray(piece.movements) || piece.movements.length === 0 || piece.movements.length > 4) return null;
  const movements = [];
  for (const row of piece.movements) {
    if (!row || typeof row !== "object") return null;
    const movement = row as Record<string, unknown>;
    if (typeof movement.key !== "string" || typeof movement.amount !== "string" || typeof movement.name_ko !== "string") return null;
    if (!hangul(movement.name_ko) || /kg/i.test(movement.amount)) return null;
    movements.push({ key: movement.key, amount: movement.amount, name_ko: movement.name_ko });
  }
  const equipment = Array.isArray(piece.equipment)
    ? piece.equipment.filter((item): item is Equipment => typeof item === "string" && (EQUIPMENT as readonly string[]).includes(item))
    : [];
  if (equipment.length === 0) return null;
  const longPiece = input.intent.secondary_training === "long_conditioning";
  if (longPiece && timeDomainFromMinutes(minutes) !== "long") return null;
  if (!longPiece && timeDomainFromMinutes(minutes) === "long") return null;
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
  const lift = longPiece || input.intent.strength_lift === "none" ? null : input.intent.strength_lift;
  const strength = lift ? strengthFor(lift, input.month, input.weekIndex, input.actual) : null;
  const warmupText = typeof body.warmup_ko === "string" && hangul(body.warmup_ko) ? body.warmup_ko : warmup(input.intent.day, strength?.lift ?? null);
  return fillSessionFields(
    {
      day: input.intent.day,
      rest: false,
      optional: input.intent.day === "sat",
      warmup_min: 10,
      warmup_ko: warmupText,
      strength,
      conditioning: conditioningFrom(input.intent.day, recipe, input.intent.benchmark),
    },
    strength ? (input.intent.volume_profile === "low" ? "low" : "moderate") : null,
  );
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
  const lift = longPiece || day.strength_lift === "none" ? null : day.strength_lift;
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
  const conditioning = conditioningFrom(day.day, scaled, day.benchmark);
  const strength = lift ? strengthFor(lift, input.month, input.weekIndex, input.actual) : null;
  return fillSessionFields(
    {
      day: day.day,
      rest: false,
      optional: day.day === "sat",
      warmup_min: 10,
      warmup_ko: warmup(day.day, strength?.lift ?? null),
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
  const judged = judgeWeek(bare(draft), input.month, input.weekIndex, recent, context(input.actual, input.recentLiftMaps));
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
  const judged = judgeWeek(bare(draft), input.month, input.weekIndex, input.recent ?? [], context(input.actual, input.recentLiftMaps));
  return { draft, judgeOk: judged.ok, errors: judged.ok ? [] : judged.errors };
}

function bare(draft: WeekDraft): WeekDraft {
  return {
    ...draft,
    intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
  };
}

function context(actual: WeekActual | null | undefined, maps: readonly string[] | undefined): WeekCheckContext {
  return { previousActual: actual ?? null, recentLiftMaps: maps ?? [] };
}
