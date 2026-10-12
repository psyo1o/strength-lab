import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import { monthEmphasis, performanceRead } from "../weekly-intent";
import type { WeekActual } from "../summary";
import type {
  BlockPhase,
  ConditioningSlot,
  DaySessionGoal,
  MonthDirection,
  MonthGoalTable,
  MovementPattern,
  Stimulus,
  StoredStructure,
  TimeDomain,
  VolumeBand,
  WeekGoal,
  WeekIndex,
  WeeklyIntentPlan,
  WodFormat,
} from "../types";
import { timeDomainFromMinutes } from "./canonical";
import { strengthConditioningBan } from "./conditioning-board";
import { catalogMovement, modelSelectable, standardCatalogKeys } from "./movement-catalog";

/** A primary key may show up twice in one week and four times in the month. */
export const WEEKLY_PRIMARY_CAP = 2;
export const MONTHLY_PRIMARY_CAP = 4;

export const STRENGTH_GOAL_KEYS = ["none", "back_squat", "front_squat", "strict_press", "bench_press", "deadlift"] as const;

const FORMATS: readonly WodFormat[] = ["amrap", "for_time", "emom", "intervals", "chipper"];
const STIMULUS_CYCLE: readonly Stimulus[] = ["heavy", "high_rep", "technical"];

export type WeekTrainingLayout = {
  phase: BlockPhase;
  rest: DayKey;
  lowers: Map<DayKey, MainLift>;
  uppers: Map<DayKey, MainLift>;
  longDay: DayKey | null;
  emphasis: WeeklyIntentPlan["emphasis"];
  fatigued: boolean;
  missed: boolean;
  succeeded: boolean;
};

export function strengthFamily(key: string | null | undefined): MainLift | "none" {
  if (key === "back_squat" || key === "front_squat") return "squat";
  if (key === "strict_press") return "ohp";
  if (key === "bench_press") return "bench";
  if (key === "deadlift") return "deadlift";
  return "none";
}

export function exactStrengthKey(lift: MainLift, weekIndex: WeekIndex): string {
  if (lift === "squat") return weekIndex % 2 === 1 ? "back_squat" : "front_squat";
  if (lift === "ohp") return "strict_press";
  if (lift === "bench") return "bench_press";
  return "deadlift";
}

export function comboKey(keys: readonly string[]): string {
  return [...keys].filter(Boolean).sort().join("|");
}

function phaseFor(month: MonthDirection, weekIndex: WeekIndex, fatigued: boolean): BlockPhase {
  const method = month.strength_method || month.scheme;
  if (method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload" || weekIndex === 4) return "deload";
  if (fatigued) return "emphasis";
  if (weekIndex === 3) return "peak";
  if (weekIndex === 2) return "progression";
  return "accumulation";
}

export function restDayFor(weekIndex: WeekIndex, phase: BlockPhase): DayKey {
  if (phase === "deload") return "sun";
  const cycle: DayKey[] = ["sun", "wed", "fri"];
  return cycle[(weekIndex - 1) % cycle.length]!;
}

function calendarGap(left: DayKey, right: DayKey): number {
  return Math.abs(DAY_ORDER.indexOf(left) - DAY_ORDER.indexOf(right));
}

function choosePair(days: DayKey[], shift: number): [DayKey, DayKey] | [DayKey] {
  const pairs: Array<[DayKey, DayKey]> = [];
  for (let index = 0; index < days.length; index += 1) {
    for (let other = index + 1; other < days.length; other += 1) {
      if (calendarGap(days[index]!, days[other]!) > 1) pairs.push([days[index]!, days[other]!]);
    }
  }
  if (pairs.length === 0) return [days[0]!];
  return pairs[shift % pairs.length]!;
}

function longDayFor(training: DayKey[], lowers: DayKey[], heavy: boolean): DayKey | null {
  const blocked = new Set<DayKey>(lowers);
  if (heavy) {
    for (const day of lowers) {
      const next = DAY_ORDER[DAY_ORDER.indexOf(day) + 1];
      if (next) blocked.add(next);
    }
  }
  const open = training.filter((day) => !blocked.has(day));
  return open.find((day) => day === "sat") ?? open[open.length - 1] ?? null;
}

/** Rest, lifts, and the long day for one week. The goal table and the weekly fallback share this. */
export function weekTrainingLayout(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentSignatures?: readonly string[];
}): WeekTrainingLayout {
  const read = performanceRead(input.previousActual);
  const fatigued = read.lower_fatigue === "high";
  const missed = read.many_missed;
  const succeeded = read.strength_succeeded && !fatigued && !missed;
  const phase = phaseFor(input.month, input.weekIndex, fatigued);
  const rest = restDayFor(input.weekIndex, phase);
  const training = DAY_ORDER.filter((day) => day !== rest);
  const liftHosts = training.filter((day) => day !== "sat");
  const shift = input.weekIndex - 1 + (input.recentSignatures?.length ?? 0);
  const pair = choosePair(liftHosts, shift);
  const lowerLifts: MainLift[] = shift % 2 === 0 ? ["squat", "deadlift"] : ["deadlift", "squat"];
  const lowers = new Map<DayKey, MainLift>();
  if (fatigued) lowers.set(pair[0]!, lowerLifts[0]!);
  else {
    lowers.set(pair[0]!, lowerLifts[0]!);
    if (pair[1]) lowers.set(pair[1], lowerLifts[1]!);
  }
  const heavy = phase !== "deload";
  const wantsLong = input.month.long_conditioning_weeks.includes(input.weekIndex);
  const longDay = wantsLong ? longDayFor(training, [...lowers.keys()], heavy) : null;
  const upperLifts: MainLift[] = shift % 2 === 0 ? ["bench", "ohp"] : ["ohp", "bench"];
  const uppers = new Map<DayKey, MainLift>();
  const upperHosts = liftHosts.filter((day) => !lowers.has(day) && day !== longDay);
  upperHosts.slice(0, phase === "deload" ? 1 : 2).forEach((day, index) => uppers.set(day, upperLifts[index]!));
  const emphasis = monthEmphasis(input.month);
  return {
    phase,
    rest,
    lowers,
    uppers,
    longDay,
    emphasis: wantsLong && emphasis === "mixed" ? "long_conditioning" : emphasis,
    fatigued,
    missed,
    succeeded,
  };
}

export function layoutFromGoal(layout: WeekTrainingLayout, goal: WeekGoal): WeekTrainingLayout {
  const rest = goal.days.find((day) => day.rest)?.day ?? layout.rest;
  const lowers = new Map<DayKey, MainLift>();
  const uppers = new Map<DayKey, MainLift>();
  let longDay: DayKey | null = null;
  for (const day of goal.days) {
    if (day.rest) continue;
    const family = strengthFamily(day.strength_key);
    if (family === "squat" || family === "deadlift") lowers.set(day.day, family);
    if (family === "bench" || family === "ohp") uppers.set(day.day, family);
    if ((day.duration_min ?? 0) >= 30 || day.time_domain === "long") longDay = day.day;
  }
  return { ...layout, rest, lowers, uppers, longDay };
}

type Modality = "mono" | "gym" | "lift";

function modality(key: string): Modality | null {
  const category = catalogMovement(key)?.category ?? "";
  if (category === "monostructural") return "mono";
  if (category === "gymnastics") return "gym";
  if (category === "weightlifting" || category === "kettlebell" || category === "dumbbell") return "lift";
  return null;
}

function patternOf(key: string): MovementPattern {
  const pattern = catalogMovement(key)?.pattern;
  if (
    pattern === "squat" ||
    pattern === "hinge" ||
    pattern === "press" ||
    pattern === "pull" ||
    pattern === "olympic" ||
    pattern === "engine" ||
    pattern === "gymnastic"
  ) {
    return pattern;
  }
  return "engine";
}

function pools(): Record<Modality, string[]> {
  const out: Record<Modality, string[]> = { mono: [], gym: [], lift: [] };
  for (const key of standardCatalogKeys()) {
    const kind = modality(key);
    if (kind) out[kind].push(key);
  }
  return out;
}

function pickKeys(input: {
  count: number;
  ban: ReadonlySet<string>;
  weekCounts: Map<string, number>;
  monthCounts: Map<string, number>;
  used: Set<string>;
  pools: Record<Modality, string[]>;
}): string[] | null {
  const ok = (key: string) =>
    !input.ban.has(key) && (input.weekCounts.get(key) ?? 0) < WEEKLY_PRIMARY_CAP && (input.monthCounts.get(key) ?? 0) < MONTHLY_PRIMARY_CAP;
  const take = (groups: string[][]): string[] | null => {
    const walk = (index: number, chosen: string[]): string[] | null => {
      if (chosen.length === input.count) {
        if (new Set(chosen).size !== chosen.length) return null;
        const combo = comboKey(chosen);
        if (input.used.has(combo)) return null;
        return chosen;
      }
      const group = groups[index % groups.length] ?? [];
      for (const key of group) {
        if (!ok(key) || chosen.includes(key)) continue;
        const next = walk(index + 1, [...chosen, key]);
        if (next) return next;
      }
      return null;
    };
    return walk(0, []);
  };
  if (input.count >= 3) return take([input.pools.mono, input.pools.gym, input.pools.lift]);
  return take([input.pools.gym, input.pools.lift]) ?? take([input.pools.mono, input.pools.gym]);
}

function restGoal(day: DayKey): DaySessionGoal {
  return {
    day,
    rest: true,
    strength_key: null,
    purpose: "Rest. No training is written.",
    format: null,
    duration_min: null,
    time_domain: null,
    stimulus: null,
    movement_pattern: null,
    primary_keys: [],
  };
}

function remember(keys: readonly string[], weekCounts: Map<string, number>, monthCounts: Map<string, number>, used: Set<string>) {
  used.add(comboKey(keys));
  for (const key of keys) {
    weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }
}

/**
 * Four weeks of day goals. Rest, strength, and the long day follow the weekly layout.
 * Conditioning keys rotate inside the weekly and monthly caps, and no key set is reused.
 */
export function deterministicGoalTable(month: MonthDirection, actual?: WeekActual | null): MonthGoalTable {
  const catalog = pools();
  const monthCounts = new Map<string, number>();
  const used = new Set<string>();
  const weeks: WeekGoal[] = [];
  for (const weekIndex of [1, 2, 3, 4] as const) {
    const layout = weekTrainingLayout({ month, weekIndex, previousActual: actual });
    const weekCounts = new Map<string, number>();
    const training = DAY_ORDER.filter((day) => day !== layout.rest);
    let metcons = 0;
    const days = DAY_ORDER.map((day) => {
      if (day === layout.rest) return restGoal(day);
      const lift = layout.lowers.get(day) ?? (layout.phase === "deload" ? null : layout.uppers.get(day)) ?? null;
      const long = day === layout.longDay;
      const metcon = long || metcons < 4;
      if (metcon) metcons += 1;
      const count = metcon ? 3 : 2;
      const keys = pickKeys({
        count,
        ban: new Set(strengthConditioningBan(lift)),
        weekCounts,
        monthCounts,
        used,
        pools: catalog,
      });
      if (!keys) throw new Error(`goal table could not place week ${weekIndex} ${day}`);
      remember(keys, weekCounts, monthCounts, used);
      const slotIndex = training.indexOf(day);
      const minutes = long ? 32 : metcon ? [12, 16, 18, 14][slotIndex % 4]! : 10;
      const format = FORMATS[slotIndex % FORMATS.length]!;
      const stimulus = STIMULUS_CYCLE[slotIndex % STIMULUS_CYCLE.length]!;
      const domain = timeDomainFromMinutes(minutes);
      const strength = lift ? exactStrengthKey(lift, weekIndex) : null;
      return {
        day,
        rest: false,
        strength_key: strength,
        purpose: `${format} ${minutes} min around ${keys.join(", ")}.`,
        format,
        duration_min: minutes,
        time_domain: domain,
        stimulus,
        movement_pattern: patternOf(keys[0]!),
        primary_keys: keys,
      } satisfies DaySessionGoal;
    });
    const theme = month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
    weeks.push({
      week_index: weekIndex,
      goal: theme || `${month.monthly_goal} week ${weekIndex}.`,
      days,
    });
  }
  return { month_goal: month.monthly_goal, weeks };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function blankToNull(value: unknown): string | null {
  if (typeof value !== "string" || value === "none" || value === "") return null;
  return value;
}

/** Read a model goal table. Invalid shapes return null and the caller reports the field errors. */
export function parseGoalTable(value: unknown): MonthGoalTable | null {
  const body = asRecord(value);
  if (!body || typeof body.month_goal !== "string" || !Array.isArray(body.weeks)) return null;
  const weeks: WeekGoal[] = [];
  for (const row of body.weeks) {
    const week = asRecord(row);
    if (!week || (week.week_index !== 1 && week.week_index !== 2 && week.week_index !== 3 && week.week_index !== 4)) return null;
    if (typeof week.goal !== "string" || !Array.isArray(week.days)) return null;
    const days: DaySessionGoal[] = [];
    for (const item of week.days) {
      const day = asRecord(item);
      if (!day || typeof day.day !== "string") return null;
      const rest = day.rest === true;
      const duration = typeof day.duration_min === "number" ? day.duration_min : null;
      days.push({
        day: day.day as DayKey,
        rest,
        strength_key: rest ? null : blankToNull(day.strength_key),
        purpose: typeof day.purpose === "string" ? day.purpose : "",
        format: rest ? null : (blankToNull(day.format) as WodFormat | null),
        duration_min: rest ? null : duration,
        time_domain: rest ? null : duration != null && duration > 0 ? timeDomainFromMinutes(duration) : null,
        stimulus: rest ? null : (blankToNull(day.stimulus) as Stimulus | null),
        movement_pattern: rest ? null : (blankToNull(day.movement_pattern) as MovementPattern | null),
        primary_keys: rest ? [] : asKeys(day.primary_keys),
      });
    }
    weeks.push({ week_index: week.week_index, goal: week.goal, days });
  }
  return { month_goal: body.month_goal, weeks };
}

function selectable(key: string): boolean {
  const row = catalogMovement(key);
  return Boolean(row && modelSelectable(row));
}

/**
 * Rotation check for one monthly table.
 * The same primary key is capped per week and per month. A key set is not reused.
 * The week being programmed also keeps the fatigue lower-lift cap and the month's long days.
 */
export function goalTableErrors(
  table: MonthGoalTable | null,
  month: MonthDirection,
  options?: { weekIndex?: WeekIndex; fatigued?: boolean; recentCombos?: readonly string[] },
): string[] {
  if (!table) return ["goal_table is missing"];
  const errors: string[] = [];
  if (!table.month_goal.trim()) errors.push("goal_table.month_goal is empty");
  if (table.weeks.length !== 4) errors.push("goal_table.weeks: expected 4 weeks");
  const monthCounts = new Map<string, number>();
  const used = new Set<string>();
  const recent = new Set(options?.recentCombos ?? []);
  for (const week of table.weeks) {
    const seen = new Set<string>();
    const weekCounts = new Map<string, number>();
    if (week.days.length !== 7) errors.push(`goal_table week ${week.week_index} must contain seven days`);
    let rests = 0;
    let lowers = 0;
    let longs = 0;
    for (const day of week.days) {
      if (!DAY_ORDER.includes(day.day)) errors.push(`goal_table week ${week.week_index} day ${day.day} is not a weekday`);
      if (seen.has(day.day)) errors.push(`goal_table week ${week.week_index} repeats ${day.day}`);
      seen.add(day.day);
      if (!day.purpose.trim()) errors.push(`goal_table ${week.week_index} ${day.day} purpose is empty`);
      if (day.rest) {
        rests += 1;
        continue;
      }
      if (day.strength_key && !STRENGTH_GOAL_KEYS.includes(day.strength_key as (typeof STRENGTH_GOAL_KEYS)[number])) {
        errors.push(`goal_table ${week.week_index} ${day.day} strength_key ${day.strength_key} is not an exact lift`);
      }
      const family = strengthFamily(day.strength_key);
      if (family === "squat" || family === "deadlift") lowers += 1;
      if ((day.duration_min ?? 0) >= 30 || day.time_domain === "long") longs += 1;
      if (!day.format || !day.stimulus || !day.movement_pattern) {
        errors.push(`goal_table ${week.week_index} ${day.day} needs format, stimulus, and movement_pattern`);
      }
      const minutes = day.duration_min ?? 0;
      const long = minutes >= 30;
      if (long && (minutes < 30 || minutes > 40)) errors.push(`goal_table ${week.week_index} ${day.day} long piece is not 30–40 minutes`);
      if (!long && (minutes < 8 || minutes > 20)) errors.push(`goal_table ${week.week_index} ${day.day} duration_min is not 8–20`);
      if (day.primary_keys.length < 2 || day.primary_keys.length > 3) {
        errors.push(`goal_table ${week.week_index} ${day.day} primary_keys: length ${day.primary_keys.length}; allowed 2–3`);
      }
      if (new Set(day.primary_keys).size !== day.primary_keys.length) {
        errors.push(`goal_table ${week.week_index} ${day.day} repeats a primary key`);
      }
      for (const key of day.primary_keys) {
        if (!selectable(key)) errors.push(`goal_table ${week.week_index} ${day.day} key ${key} is not selectable`);
        if (strengthConditioningBan(family).includes(key)) errors.push(`goal_table ${week.week_index} ${day.day} key ${key} repeats the strength lift`);
        weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
        monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
      }
      if (day.primary_keys.length >= 2) {
        const combo = comboKey(day.primary_keys);
        if (used.has(combo) || recent.has(combo)) errors.push(`goal_table reuses movement combination ${combo}`);
        used.add(combo);
      }
    }
    for (const day of DAY_ORDER) if (!seen.has(day)) errors.push(`goal_table week ${week.week_index} is missing ${day}`);
    if (rests !== 1) errors.push(`goal_table week ${week.week_index} needs exactly one rest day; current=${rests}`);
    for (const [key, count] of weekCounts) {
      if (count > WEEKLY_PRIMARY_CAP) errors.push(`goal_table week ${week.week_index} uses ${key} ${count} times; weekly cap is ${WEEKLY_PRIMARY_CAP}`);
    }
    const longRequired = month.long_conditioning_weeks.includes(week.week_index);
    if (longRequired && longs !== 1) errors.push(`goal_table week ${week.week_index} needs exactly one long day; current=${longs}`);
    if (!longRequired && longs !== 0) errors.push(`goal_table week ${week.week_index} is not a long-conditioning week`);
    const cap = options?.fatigued && options.weekIndex === week.week_index ? 1 : 2;
    if (lowers > cap) errors.push(`goal_table week ${week.week_index} lower lifts ${lowers} exceed ${cap}`);
  }
  for (const [key, count] of monthCounts) {
    if (count > MONTHLY_PRIMARY_CAP) errors.push(`goal_table uses ${key} ${count} times; monthly cap is ${MONTHLY_PRIMARY_CAP}`);
  }
  return errors;
}

export function recentCombos(rows: readonly StoredStructure[]): string[] {
  const combos: string[] = [];
  for (const row of rows) {
    if (row.benchmark) continue;
    const keys = row.movements.map((movement) => movement.key).filter(Boolean);
    if (keys.length >= 2) combos.push(comboKey(keys));
  }
  return combos;
}

export function weekGoalAlignmentErrors(plan: WeeklyIntentPlan, goal: WeekGoal): string[] {
  const errors: string[] = [];
  for (const day of goal.days) {
    const intent = plan.days.find((row) => row.day === day.day);
    if (!intent) {
      errors.push(`${day.day} is missing from the weekly plan`);
      continue;
    }
    const rest = intent.primary_training === "rest" || intent.recovery_role === "rest";
    if (day.rest !== rest) errors.push(`${day.day} rest must follow the monthly table (${day.rest ? "rest" : "train"})`);
    if (day.rest) continue;
    const family = strengthFamily(day.strength_key);
    if (intent.strength_lift !== family) errors.push(`${day.day} strength_lift must be ${family}`);
    const long = (day.duration_min ?? 0) >= 30 || day.time_domain === "long";
    const intentLong = intent.secondary_training === "long_conditioning";
    if (long !== intentLong) errors.push(`${day.day} long conditioning must follow the monthly table`);
  }
  return errors;
}

export function slotsFromWeekGoal(goal: WeekGoal): Partial<Record<DayKey, ConditioningSlot>> {
  const slots: Partial<Record<DayKey, ConditioningSlot>> = {};
  for (const day of goal.days) {
    if (day.rest || !day.format || !day.stimulus || !day.movement_pattern || day.duration_min == null) continue;
    const keys = day.primary_keys;
    const long = day.time_domain === "long" || day.duration_min >= 30;
    slots[day.day] = {
      format: day.format,
      time_domain: long ? "long" : timeDomainFromMinutes(day.duration_min),
      duration_min: day.duration_min,
      stimulus: day.stimulus,
      movement_pattern: day.movement_pattern,
      primary_key: keys[0] ?? "",
      volume: long ? "moderate" : "moderate",
      metcon: keys.length >= 3,
      movement_count: keys.length,
      companions: keys.slice(1),
      stretch: long,
      purpose: day.purpose,
      strength_key: day.strength_key,
      primary_keys: keys,
    };
  }
  return slots;
}

export function goalWeek(table: MonthGoalTable | null | undefined, weekIndex: WeekIndex): WeekGoal | null {
  return table?.weeks.find((week) => week.week_index === weekIndex) ?? null;
}
