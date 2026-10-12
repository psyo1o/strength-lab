import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import { monthEmphasis, performanceRead } from "../weekly-intent";
import type { WeekActual } from "../summary";
import {
  BODY_REGIONS,
  ENERGY_SYSTEMS,
  SESSION_FOCUSES,
  STIMULI,
  type BlockPhase,
  type BodyRegion,
  type ConditioningSlot,
  type DaySessionGoal,
  type EnergySystem,
  type MonthDirection,
  type MonthGoalTable,
  type MovementPattern,
  type SessionFocus,
  type SessionTarget,
  type Stimulus,
  type StoredStructure,
  type TimeDomain,
  type WeekGoal,
  type WeekIndex,
  type WeeklyIntentPlan,
} from "../types";

const PATTERNS: readonly MovementPattern[] = ["squat", "hinge", "press", "pull", "olympic", "engine", "gymnastic"];

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
  const longDay = goal.days.find((day) => !day.rest && day.time_domain === "long")?.day ?? null;
  const lowers = new Map([...layout.lowers].filter(([day]) => day !== rest));
  const uppers = new Map([...layout.uppers].filter(([day]) => day !== rest && layout.phase !== "deload"));
  return { ...layout, rest, lowers, uppers, longDay };
}

export function placementSignature(day: DaySessionGoal): string {
  const target = day.target;
  return [day.focus ?? "", target?.movement_pattern ?? "", target?.body_region ?? "", target?.energy_system ?? "", day.stimulus ?? ""].join("|");
}

type FocusCell = {
  focus: SessionFocus;
  pattern: MovementPattern;
  region: BodyRegion;
  energy: EnergySystem;
  stimulus: Stimulus;
};

function focusCatalog(): FocusCell[] {
  const cells: FocusCell[] = [];
  for (const focus of SESSION_FOCUSES) {
    for (const pattern of PATTERNS) {
      for (const region of BODY_REGIONS) {
        for (const energy of ENERGY_SYSTEMS) {
          for (const stimulus of STIMULI) cells.push({ focus, pattern, region, energy, stimulus });
        }
      }
    }
  }
  return cells;
}

function cellSignature(cell: FocusCell): string {
  return [cell.focus, cell.pattern, cell.region, cell.energy, cell.stimulus].join("|");
}

function restGoal(day: DayKey): DaySessionGoal {
  return {
    day,
    rest: true,
    purpose: "Rest. No training is written.",
    focus: null,
    intensity: null,
    target: null,
    stimulus: null,
    time_domain: null,
  };
}

function pickCell(input: {
  day: DayKey;
  weekIndex: WeekIndex;
  blocked: ReadonlySet<string>;
  neighborStimulus: Stimulus | null;
}): FocusCell {
  const cells = focusCatalog();
  const shift = (input.weekIndex * 11 + DAY_ORDER.indexOf(input.day) * 3) % cells.length;
  for (let step = 0; step < cells.length; step += 1) {
    const cell = cells[(shift + step) % cells.length]!;
    if (input.blocked.has(cellSignature(cell))) continue;
    if (input.neighborStimulus && cell.stimulus === input.neighborStimulus) continue;
    return cell;
  }
  throw new Error(`goal table could not place week ${input.weekIndex} ${input.day}`);
}

/**
 * Four weeks of day targets. Rest and the long day follow the weekly layout.
 * A training day names focus, intensity, target, stimulus, and time domain. It does not name movements.
 */
export function deterministicGoalTable(month: MonthDirection, actual?: WeekActual | null): MonthGoalTable {
  const byWeekday = new Map<DayKey, Set<string>>();
  let previous = new Set<string>();
  const weeks: WeekGoal[] = [];
  for (const weekIndex of [1, 2, 3, 4] as const) {
    const layout = weekTrainingLayout({ month, weekIndex, previousActual: actual });
    const blocked = new Set(previous);
    const weekSignatures = new Set<string>();
    let previousTrainingIndex = -2;
    let previousStimulus: Stimulus | null = null;
    let trainingIndex = 0;
    const days = DAY_ORDER.map((day) => {
      if (day === layout.rest) return restGoal(day);
      const index = DAY_ORDER.indexOf(day);
      const adjacent = index - previousTrainingIndex === 1;
      const weekday = byWeekday.get(day) ?? new Set<string>();
      const cell = pickCell({
        day,
        weekIndex,
        blocked: new Set([...blocked, ...weekSignatures, ...weekday]),
        neighborStimulus: adjacent ? previousStimulus : null,
      });
      const signature = cellSignature(cell);
      weekSignatures.add(signature);
      weekday.add(signature);
      byWeekday.set(day, weekday);
      previousTrainingIndex = index;
      previousStimulus = cell.stimulus;
      const long = day === layout.longDay;
      const time_domain: TimeDomain = long ? "long" : (weekIndex + trainingIndex) % 2 === 0 ? "short" : "medium";
      trainingIndex += 1;
      const intensity = layout.phase === "deload" ? 2 : long ? 3 : [3, 4, 4, 5, 3, 4][trainingIndex % 6]!;
      const target: SessionTarget = {
        movement_pattern: cell.pattern,
        body_region: cell.region,
        energy_system: cell.energy,
      };
      return {
        day,
        rest: false,
        purpose: `${cell.focus.replaceAll("_", " ")}. Target ${cell.pattern}, ${cell.region}, ${cell.energy}. Stimulus ${cell.stimulus.replaceAll("_", " ")}.`,
        focus: cell.focus,
        intensity,
        target,
        stimulus: cell.stimulus,
        time_domain,
      } satisfies DaySessionGoal;
    });
    previous = weekSignatures;
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

function asFocus(value: unknown): SessionFocus | null {
  return typeof value === "string" && (SESSION_FOCUSES as readonly string[]).includes(value) ? (value as SessionFocus) : null;
}

function asPattern(value: unknown): MovementPattern | null {
  return typeof value === "string" && (PATTERNS as readonly string[]).includes(value) ? (value as MovementPattern) : null;
}

function asRegion(value: unknown): BodyRegion | null {
  return typeof value === "string" && (BODY_REGIONS as readonly string[]).includes(value) ? (value as BodyRegion) : null;
}

function asEnergy(value: unknown): EnergySystem | null {
  return typeof value === "string" && (ENERGY_SYSTEMS as readonly string[]).includes(value) ? (value as EnergySystem) : null;
}

function asStimulus(value: unknown): Stimulus | null {
  return typeof value === "string" && (STIMULI as readonly string[]).includes(value) ? (value as Stimulus) : null;
}

function asDomain(value: unknown): TimeDomain | null {
  return value === "short" || value === "medium" || value === "long" ? value : null;
}

function targetFrom(value: unknown): SessionTarget | null {
  const body = asRecord(value);
  if (!body) return null;
  const movement_pattern = asPattern(body.movement_pattern);
  const body_region = asRegion(body.body_region);
  const energy_system = asEnergy(body.energy_system);
  if (!movement_pattern || !body_region || !energy_system) return null;
  return { movement_pattern, body_region, energy_system };
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
      const target = rest ? null : targetFrom(day.target);
      days.push({
        day: day.day as DayKey,
        rest,
        purpose: typeof day.purpose === "string" ? day.purpose : "",
        focus: rest ? null : asFocus(day.focus),
        intensity: rest ? null : typeof day.intensity === "number" ? day.intensity : null,
        target,
        stimulus: rest ? null : asStimulus(day.stimulus),
        time_domain: rest ? null : asDomain(day.time_domain),
      });
    }
    weeks.push({ week_index: week.week_index, goal: week.goal, days });
  }
  return { month_goal: body.month_goal, weeks };
}

/**
 * Placement check for one monthly table.
 * The same focus, target, and stimulus may not repeat on a weekday, a neighboring day, or the previous week.
 * Rest stays one day. Long time domains stay on the month's long weeks.
 */
export function goalTableErrors(table: MonthGoalTable | null, month: MonthDirection): string[] {
  if (!table) return ["goal_table is missing"];
  const errors: string[] = [];
  if (!table.month_goal.trim()) errors.push("goal_table.month_goal is empty");
  if (table.weeks.length !== 4) errors.push("goal_table.weeks: expected 4 weeks");
  const weekdaySeen = new Map<DayKey, Set<string>>();
  const ordered = [...table.weeks].sort((left, right) => left.week_index - right.week_index);
  let previous = new Set<string>();
  for (const week of ordered) {
    const seen = new Set<string>();
    if (week.days.length !== 7) errors.push(`goal_table week ${week.week_index} must contain seven days`);
    let rests = 0;
    let longs = 0;
    const training: DaySessionGoal[] = [];
    for (const day of week.days) {
      if (!DAY_ORDER.includes(day.day)) errors.push(`goal_table week ${week.week_index} day ${day.day} is not a weekday`);
      if (seen.has(day.day)) errors.push(`goal_table week ${week.week_index} repeats ${day.day}`);
      seen.add(day.day);
      if (!day.purpose.trim()) errors.push(`goal_table ${week.week_index} ${day.day} purpose is empty`);
      if (day.rest) {
        rests += 1;
        continue;
      }
      if (!day.focus || !day.target || !day.stimulus || !day.time_domain) {
        errors.push(`goal_table ${week.week_index} ${day.day} needs focus, target, stimulus, and time_domain`);
      }
      if (day.intensity == null || !Number.isInteger(day.intensity) || day.intensity < 1 || day.intensity > 5) {
        errors.push(`goal_table ${week.week_index} ${day.day} intensity must be 1–5`);
      }
      if (day.time_domain === "long") longs += 1;
      training.push(day);
      if (!day.focus || !day.target || !day.stimulus) continue;
      const signature = placementSignature(day);
      const prior = weekdaySeen.get(day.day) ?? new Set<string>();
      if (prior.has(signature)) errors.push(`goal_table ${day.day} repeats focus target stimulus ${signature}`);
      prior.add(signature);
      weekdaySeen.set(day.day, prior);
      if (previous.has(signature)) errors.push(`goal_table week ${week.week_index} ${day.day} repeats the previous week ${signature}`);
    }
    training.sort((left, right) => DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day));
    for (let index = 1; index < training.length; index += 1) {
      const left = training[index - 1]!;
      const right = training[index]!;
      if (DAY_ORDER.indexOf(right.day) - DAY_ORDER.indexOf(left.day) !== 1) continue;
      if (!left.focus || !right.focus) continue;
      if (placementSignature(left) === placementSignature(right)) {
        errors.push(`goal_table week ${week.week_index} ${left.day} and ${right.day} repeat focus target stimulus`);
      }
    }
    for (const day of DAY_ORDER) if (!seen.has(day)) errors.push(`goal_table week ${week.week_index} is missing ${day}`);
    if (rests !== 1) errors.push(`goal_table week ${week.week_index} needs exactly one rest day; current=${rests}`);
    const longRequired = month.long_conditioning_weeks.includes(week.week_index);
    if (longRequired && longs !== 1) errors.push(`goal_table week ${week.week_index} needs exactly one long day; current=${longs}`);
    if (!longRequired && longs !== 0) errors.push(`goal_table week ${week.week_index} is not a long-conditioning week`);
    previous = new Set(training.filter((day) => day.focus && day.target && day.stimulus).map((day) => placementSignature(day)));
  }
  return errors;
}

export function movementFrequency(rows: readonly StoredStructure[]): { key: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.benchmark) continue;
    for (const movement of row.movements) {
      if (!movement.key) continue;
      counts.set(movement.key, (counts.get(movement.key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ key, count }));
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
    const long = day.time_domain === "long";
    const intentLong = intent.secondary_training === "long_conditioning";
    if (long !== intentLong) errors.push(`${day.day} long conditioning must follow the monthly table`);
    if (day.target && intent.movement_pattern !== day.target.movement_pattern) {
      errors.push(`${day.day} movement_pattern must be ${day.target.movement_pattern}`);
    }
  }
  return errors;
}

export function slotsFromWeekGoal(goal: WeekGoal): Partial<Record<DayKey, ConditioningSlot>> {
  const slots: Partial<Record<DayKey, ConditioningSlot>> = {};
  for (const day of goal.days) {
    if (day.rest || !day.focus || !day.target || !day.stimulus || !day.time_domain) continue;
    const duration = day.time_domain === "long" ? 32 : day.time_domain === "medium" ? 16 : 10;
    slots[day.day] = {
      format: "amrap",
      time_domain: day.time_domain,
      duration_min: duration,
      stimulus: day.stimulus,
      movement_pattern: day.target.movement_pattern,
      primary_key: "",
      volume: "moderate",
      metcon: false,
      movement_count: 0,
      companions: [],
      stretch: day.time_domain === "long",
      purpose: day.purpose,
      from_goal: true,
      focus: day.focus,
      goal_intensity: day.intensity,
      body_region: day.target.body_region,
      energy_system: day.target.energy_system,
    };
  }
  return slots;
}

export function goalWeek(table: MonthGoalTable | null | undefined, weekIndex: WeekIndex): WeekGoal | null {
  return table?.weeks.find((week) => week.week_index === weekIndex) ?? null;
}
