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

function lowerDaysOf(assigned: Map<DayKey, GoalCategory>): DayKey[] {
  return [...assigned.entries()].filter(([, category]) => category === "lower").map(([day]) => day);
}

function categoryConflict(assigned: Map<DayKey, GoalCategory>): boolean {
  if (!GOAL_TABLE_RULES.forbidConsecutiveSameCategory) return false;
  for (const [day, category] of assigned) {
    const next = DAY_ORDER[DAY_ORDER.indexOf(day) + 1];
    if (next && assigned.get(next) === category) return true;
  }
  return false;
}

/**
 * 프로필 훈련일만 쓸 때 긴 컨디셔닝 자리를 남긴다.
 * 기본 6일 배치는 weekTrainingLayout을 그대로 쓴다.
 */
function placeProfileWeek(
  training: readonly DayKey[],
  weekIndex: WeekIndex,
  wantsLong: boolean,
  heavy: boolean,
): { categories: Map<DayKey, GoalCategory>; longDay: DayKey | null } | null {
  const assigned = placeCategories(training, weekIndex);
  if (!assigned) return null;
  if (!wantsLong) return { categories: assigned, longDay: null };
  const host = longDayFor([...training], lowerDaysOf(assigned), heavy);
  if (host) return { categories: assigned, longDay: host };
  const lowers = lowerDaysOf(assigned);
  const others = training.filter((day) => !lowers.includes(day));
  for (const lower of lowers) {
    for (const other of others) {
      const trial = new Map(assigned);
      const moved = trial.get(other);
      const kept = trial.get(lower);
      if (!moved || !kept) continue;
      trial.set(other, kept);
      trial.set(lower, moved);
      if (categoryConflict(trial)) continue;
      const opened = longDayFor([...training], lowerDaysOf(trial), heavy);
      if (opened) return { categories: trial, longDay: opened };
    }
  }
  return null;
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
  if (fatigued || missed) lowers.set(pair[0]!, lowerLifts[0]!);
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
  const restDays = new Set(goal.days.filter((day) => day.rest).map((day) => day.day));
  const rest = goal.days.find((day) => day.rest)?.day ?? layout.rest;
  const longDay = goal.days.find((day) => !day.rest && day.time_domain === "long")?.day ?? null;
  const lowers = new Map([...layout.lowers].filter(([day]) => !restDays.has(day)));
  const uppers = new Map([...layout.uppers].filter(([day]) => !restDays.has(day) && layout.phase !== "deload"));
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

/** 주 4–6일의 기존 절대 수치. 고강도 3, 피로 2, 딜로드 1, 하체 2, 피로 하체 1, 올림픽 4. */
const HISTORICAL_WEEK_CAPS = {
  maxHighIntensity: 3,
  maxHighIntensityFatigued: 2,
  maxHighIntensityDeload: 1,
  maxLowerLifts: 2,
  maxLowerLiftsFatigued: 1,
  maxOlympicDays: 4,
} as const;

export const GOAL_TABLE_RULES = {
  categories: ["lower", "upper", "full", "engine", "gymnastics"] as const,
  focusCategory: {
    lower_strength: "lower",
    upper_strength: "upper",
    weightlifting_cycling: "full",
    engine_endurance: "engine",
    gymnastics_skill: "gymnastics",
  } satisfies Record<SessionFocus, "lower" | "upper" | "full" | "engine" | "gymnastics">,
  share: {
    lower: { min: 1, max: 2 },
    upper: { min: 1, max: 2 },
    full: { min: 0, max: 2 },
    engine: { min: 0, max: 2 },
    gymnastics: { min: 0, max: 2 },
  },
  forbidConsecutiveSameCategory: true,
  loadDeltaMax: 2,
  monopolyFails: true,
  /** 강도 4 이상이 고강도다. 월간 표와 주간 규칙이 같은 기준을 본다. */
  highIntensity: 4,
  /**
   * 훈련일 수별 절대 수치.
   * 주 2일만 고강도 상한이 1이다. 주 4–6일은 HISTORICAL_WEEK_CAPS 그대로다.
   */
  byTrainingDays: {
    2: { ...HISTORICAL_WEEK_CAPS, maxHighIntensity: 1, maxHighIntensityFatigued: 1 },
    3: HISTORICAL_WEEK_CAPS,
    4: HISTORICAL_WEEK_CAPS,
    5: HISTORICAL_WEEK_CAPS,
    6: HISTORICAL_WEEK_CAPS,
    7: HISTORICAL_WEEK_CAPS,
  },
  /**
   * 존 2는 주 6일 프로그램의 별도 하루다. 생성기와 검증기가 이 표만 본다.
   * 고강도(4 이상)와 별도인 저강도이고, 고강도 상한에 넣지 않는다.
   */
  zone2: {
    form: "day",
    blocks: { day: 1 },
    duration: {
      day: [40, 45],
      deload: [30],
    },
    /** RPE 2–3 대화 가능 페이스. 딜로드도 같다. 딜로드에서 바뀌는 것은 30분뿐이다. */
    effort: ["conversational"],
    hr: ["60-70", "unspecified"],
    modalities: ["row_erg", "bike_erg", "assault_bike", "run", "ski_erg"],
    /**
     * heavy 하체 다음 날과 하체 날의 존 2 A·B에서 뺀다.
     * 순환으로 목록이 비어도 이 키는 다시 넣지 않는다.
     */
    bannedOnLowerAdjacent: "run",
    /** day의 주간 intensity_profile. 1–2만 허용하고 light로 둔다. */
    dayIntensity: ["light"],
    countsTowardHighIntensity: false,
    /**
     * 존 2 날의 대체안. 기본값 A 대신 하는 짧은 메트콘이고, 둘을 더해 하지 않는다.
     * 형식·시간·RPE·강도·동작은 이 목록만 허용한다.
     */
    shortMetcon: {
      formats: ["emom", "intervals", "amrap"],
      duration: { normal: [12, 15], deload: [10] },
      rpe: ["4", "5"],
      intensity: [2, 3],
      ergo: ["row_erg", "bike_erg", "assault_bike", "ski_erg"],
      bodyweight: ["push_up", "ring_row", "abmat_sit_up", "hanging_knee_raise"],
    },
  },
} as const;

/** 프로필 훈련일 수. available_days가 없으면 기본 6일이다. 월간·뼈대·검증이 이 함수만 읽는다. */
export function profileTrainingDayCount(month: { available_days?: readonly DayKey[] | null }): number {
  const listed = month.available_days;
  if (!listed?.length) return 6;
  return new Set(listed.filter((day) => DAY_ORDER.includes(day))).size;
}

/** 휴식일 = 7 - 프로필 훈련일 수. 검사는 이 수와 정확히 같아야 한다. */
export function expectedRestDays(month: { available_days?: readonly DayKey[] | null }): number {
  return 7 - profileTrainingDayCount(month);
}

export function weekCapsFor(trainingDays: number) {
  const table = GOAL_TABLE_RULES.byTrainingDays;
  if (trainingDays === 2) return table[2];
  if (trainingDays === 3) return table[3];
  if (trainingDays === 4) return table[4];
  if (trainingDays === 5) return table[5];
  if (trainingDays === 7) return table[7];
  return table[6];
}

export function absoluteWeekCaps(input: { trainingDays: number; deload: boolean; fatigued: boolean }): {
  maxHighIntensity: number;
  maxLowerLifts: number;
  maxOlympicDays: number;
} {
  const row = weekCapsFor(input.trainingDays);
  return {
    maxHighIntensity: input.deload ? row.maxHighIntensityDeload : input.fatigued ? row.maxHighIntensityFatigued : row.maxHighIntensity,
    maxLowerLifts: input.fatigued ? row.maxLowerLiftsFatigued : row.maxLowerLifts,
    maxOlympicDays: row.maxOlympicDays,
  };
}

export type GoalCategory = (typeof GOAL_TABLE_RULES.categories)[number];

const FOCUS_FOR: Record<GoalCategory, SessionFocus> = {
  lower: "lower_strength",
  upper: "upper_strength",
  full: "weightlifting_cycling",
  engine: "engine_endurance",
  gymnastics: "gymnastics_skill",
};

const REGION_FOR: Record<GoalCategory, BodyRegion> = {
  lower: "lower",
  upper: "upper",
  full: "full",
  engine: "full",
  gymnastics: "upper",
};

function rotateCategories(shift: number): GoalCategory[] {
  const items = GOAL_TABLE_RULES.categories;
  const offset = ((shift % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function calendarNeighbors(day: DayKey): [DayKey, DayKey] {
  const index = DAY_ORDER.indexOf(day);
  return [DAY_ORDER[(index + 6) % 7]!, DAY_ORDER[(index + 1) % 7]!];
}

function placeCategories(training: readonly DayKey[], weekIndex: WeekIndex): Map<DayKey, GoalCategory> | null {
  const prefs = rotateCategories(weekIndex - 1);
  const counts: Record<GoalCategory, number> = { lower: 0, upper: 0, full: 0, engine: 0, gymnastics: 0 };
  const assigned = new Map<DayKey, GoalCategory>();
  for (const day of training) {
    const blocked = new Set<GoalCategory>();
    if (GOAL_TABLE_RULES.forbidConsecutiveSameCategory) {
      for (const neighbor of calendarNeighbors(day)) {
        const category = assigned.get(neighbor);
        if (category) blocked.add(category);
      }
    }
    const open = prefs.filter((category) => !blocked.has(category) && counts[category] < GOAL_TABLE_RULES.share[category].max);
    open.sort((left, right) => {
      const leftNeed = counts[left] < GOAL_TABLE_RULES.share[left].min ? 0 : 1;
      const rightNeed = counts[right] < GOAL_TABLE_RULES.share[right].min ? 0 : 1;
      if (leftNeed !== rightNeed) return leftNeed - rightNeed;
      return prefs.indexOf(left) - prefs.indexOf(right);
    });
    const pick = open[0];
    if (!pick) return null;
    assigned.set(day, pick);
    counts[pick] += 1;
  }
  for (const category of GOAL_TABLE_RULES.categories) {
    if (counts[category] < GOAL_TABLE_RULES.share[category].min) return null;
  }
  const used = GOAL_TABLE_RULES.categories.filter((category) => counts[category] > 0);
  if (GOAL_TABLE_RULES.monopolyFails && used.length < 2) return null;
  return assigned;
}

function cellSignature(cell: FocusCell): string {
  return [cell.focus, cell.pattern, cell.region, cell.energy, cell.stimulus].join("|");
}

function categoryOfFocus(focus: SessionFocus | null): GoalCategory | null {
  if (!focus) return null;
  return GOAL_TABLE_RULES.focusCategory[focus];
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

function pickWithin(input: {
  category: GoalCategory;
  weekIndex: WeekIndex;
  dayIndex: number;
  blocked: ReadonlySet<string>;
  neighborStimulus: Stimulus | null;
}): FocusCell | null {
  const focus = FOCUS_FOR[input.category];
  const region = REGION_FOR[input.category];
  const span = PATTERNS.length * ENERGY_SYSTEMS.length * STIMULI.length;
  for (let step = 0; step < span; step += 1) {
    const pattern = PATTERNS[(input.weekIndex * 3 + input.dayIndex + step) % PATTERNS.length]!;
    const energy = ENERGY_SYSTEMS[(input.weekIndex + input.dayIndex + step) % ENERGY_SYSTEMS.length]!;
    const stimulus = STIMULI[(input.weekIndex * 2 + input.dayIndex + Math.floor(step / PATTERNS.length)) % STIMULI.length]!;
    if (input.neighborStimulus && stimulus === input.neighborStimulus && step < span - STIMULI.length) continue;
    const cell: FocusCell = { focus, pattern, region, energy, stimulus };
    if (input.blocked.has(cellSignature(cell))) continue;
    return cell;
  }
  return null;
}

function intensityFor(layout: WeekTrainingLayout, trainingIndex: number, previous: number | null): number {
  const base = layout.phase === "deload" || layout.fatigued ? 2 : 3 + (trainingIndex % 2);
  if (previous == null) return base;
  const low = Math.max(1, previous - GOAL_TABLE_RULES.loadDeltaMax);
  const high = Math.min(5, previous + GOAL_TABLE_RULES.loadDeltaMax);
  return Math.min(high, Math.max(low, base));
}

export type GoalTableBuild =
  | { ok: true; table: MonthGoalTable }
  | { ok: false; reason: string };

/**
 * 월 방향, 주차, 직전 주 부하, 가용 요일로 표를 만든다.
 * 한 범주만 남거나 GOAL_TABLE_RULES를 어기면 표를 돌려주지 않는다.
 */
export function buildGoalTable(input: { month: MonthDirection; previousActual?: WeekActual | null }): GoalTableBuild {
  const byWeekday = new Map<DayKey, Set<string>>();
  let previous = new Set<string>();
  const previousIntensity = new Map<DayKey, number>();
  const weeks: WeekGoal[] = [];
  for (const weekIndex of [1, 2, 3, 4] as const) {
    const layout = weekTrainingLayout({
      month: input.month,
      weekIndex,
      previousActual: input.previousActual,
    });
    const available = input.month.available_days?.filter((day) => DAY_ORDER.includes(day));
    const profileDays = Boolean(available?.length);
    const trainingDays = profileDays ? DAY_ORDER.filter((day) => available!.includes(day)) : DAY_ORDER.filter((day) => day !== layout.rest);
    const wantsLong = input.month.long_conditioning_weeks.includes(weekIndex);
    const placed = profileDays ? placeProfileWeek(trainingDays, weekIndex, wantsLong, layout.phase !== "deload") : null;
    if (profileDays && !placed) return { ok: false, reason: `goal table week ${weekIndex} could not satisfy GOAL_TABLE_RULES` };
    const categories = profileDays ? placed!.categories : placeCategories(trainingDays, weekIndex);
    if (!categories) return { ok: false, reason: `goal table week ${weekIndex} could not satisfy GOAL_TABLE_RULES` };
    const longDay = profileDays ? placed!.longDay : layout.longDay;
    const blocked = new Set(previous);
    const weekSignatures = new Set<string>();
    let previousTrainingIndex = -2;
    let previousStimulus: Stimulus | null = null;
    let trainingIndex = 0;
    const days: DaySessionGoal[] = [];
    for (const day of DAY_ORDER) {
      const restDay = profileDays ? !available!.includes(day) : day === layout.rest;
      if (restDay) {
        days.push(restGoal(day));
        continue;
      }
      const category = categories.get(day);
      if (!category) return { ok: false, reason: `goal table week ${weekIndex} ${day} has no category` };
      const index = DAY_ORDER.indexOf(day);
      const adjacent = index - previousTrainingIndex === 1;
      const weekday = byWeekday.get(day) ?? new Set<string>();
      const cell = pickWithin({
        category,
        weekIndex,
        dayIndex: index,
        blocked: new Set([...blocked, ...weekSignatures, ...weekday]),
        neighborStimulus: adjacent ? previousStimulus : null,
      });
      if (!cell) return { ok: false, reason: `goal table week ${weekIndex} ${day} could not place a target` };
      const signature = cellSignature(cell);
      weekSignatures.add(signature);
      weekday.add(signature);
      byWeekday.set(day, weekday);
      previousTrainingIndex = index;
      previousStimulus = cell.stimulus;
      const long = day === longDay;
      const time_domain: TimeDomain = long ? "long" : (weekIndex + trainingIndex) % 2 === 0 ? "short" : "medium";
      const intensity = intensityFor(layout, trainingIndex, previousIntensity.get(day) ?? null);
      trainingIndex += 1;
      days.push({
        day,
        rest: false,
        purpose: `${cell.focus.replaceAll("_", " ")}. Target ${cell.pattern}, ${cell.region}, ${cell.energy}. Stimulus ${cell.stimulus.replaceAll("_", " ")}.`,
        focus: cell.focus,
        intensity,
        target: {
          movement_pattern: cell.pattern,
          body_region: cell.region,
          energy_system: cell.energy,
        },
        stimulus: cell.stimulus,
        time_domain,
      });
    }
    for (const day of days) {
      if (!day.rest && day.intensity != null) previousIntensity.set(day.day, day.intensity);
    }
    previous = weekSignatures;
    const theme = input.month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
    weeks.push({
      week_index: weekIndex,
      goal: theme || `${input.month.monthly_goal} week ${weekIndex}.`,
      days,
    });
  }
  const table = { month_goal: input.month.monthly_goal, weeks };
  const errors = goalTableErrors(table, input.month);
  if (errors.length) return { ok: false, reason: errors[0]! };
  return { ok: true, table };
}

/**
 * Four weeks of day targets. Rest and the long day follow the weekly layout.
 * A training day names focus, intensity, target, stimulus, and time domain. It does not name movements.
 * 규칙을 만족하지 못하면 예외다. 한 범주 표를 조용히 돌려주지 않는다.
 */
export function deterministicGoalTable(month: MonthDirection, actual?: WeekActual | null): MonthGoalTable {
  const built = buildGoalTable({ month, previousActual: actual });
  if (!built.ok) throw new Error(built.reason);
  return built.table;
}

/** 생성기와 검증기가 같이 쓰는 범주·비율·부하 한도. */
export function goalTableRuleErrors(table: MonthGoalTable): string[] {
  const errors: string[] = [];
  const previousIntensity = new Map<DayKey, number>();
  const ordered = [...table.weeks].sort((left, right) => left.week_index - right.week_index);
  for (const week of ordered) {
    const training = week.days
      .filter((day) => !day.rest)
      .sort((left, right) => DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day));
    const counts: Record<GoalCategory, number> = { lower: 0, upper: 0, full: 0, engine: 0, gymnastics: 0 };
    for (const day of training) {
      const category = categoryOfFocus(day.focus);
      if (category) counts[category] += 1;
    }
    const used = GOAL_TABLE_RULES.categories.filter((category) => counts[category] > 0);
    if (GOAL_TABLE_RULES.monopolyFails && training.length > 0 && used.length < 2) {
      errors.push(`goal_table week ${week.week_index} is a single category`);
    }
    for (const category of GOAL_TABLE_RULES.categories) {
      const count = counts[category];
      const share = GOAL_TABLE_RULES.share[category];
      if (count < share.min || count > share.max) {
        errors.push(`goal_table week ${week.week_index} ${category} count ${count} is outside ${share.min}-${share.max}`);
      }
    }
    if (GOAL_TABLE_RULES.forbidConsecutiveSameCategory) {
      const byDay = new Map(week.days.map((day) => [day.day, day]));
      for (const day of training) {
        const nextName = calendarNeighbors(day.day)[1];
        const next = byDay.get(nextName);
        if (!next || next.rest) continue;
        const left = categoryOfFocus(day.focus);
        const right = categoryOfFocus(next.focus);
        if (left && right && left === right) {
          errors.push(`goal_table week ${week.week_index} ${day.day} and ${next.day} repeat category ${left}`);
        }
      }
    }
    for (const day of training) {
      if (day.intensity == null) continue;
      const prior = previousIntensity.get(day.day);
      if (prior != null && Math.abs(day.intensity - prior) > GOAL_TABLE_RULES.loadDeltaMax) {
        errors.push(
          `goal_table week ${week.week_index} ${day.day} intensity moved more than ${GOAL_TABLE_RULES.loadDeltaMax}`,
        );
      }
    }
    for (const day of training) {
      if (day.intensity != null) previousIntensity.set(day.day, day.intensity);
    }
  }
  return errors;
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
    const expectedRest = expectedRestDays(month);
    const restLabel = expectedRest === 1 ? "exactly one rest day" : `exactly ${expectedRest} rest days`;
    if (rests !== expectedRest) errors.push(`goal_table week ${week.week_index} needs ${restLabel}; current=${rests}`);
    const method = month.strength_method || month.scheme;
    const deload = week.week_index === 4 || method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload";
    const caps = absoluteWeekCaps({ trainingDays: profileTrainingDayCount(month), deload, fatigued: false });
    const high = training.filter((day) => (day.intensity ?? 0) >= GOAL_TABLE_RULES.highIntensity).length;
    if (high > caps.maxHighIntensity) {
      errors.push(`goal_table week ${week.week_index} high intensity days ${high} exceed ${caps.maxHighIntensity}`);
    }
    const longRequired = month.long_conditioning_weeks.includes(week.week_index);
    if (longRequired && longs !== 1) errors.push(`goal_table week ${week.week_index} needs exactly one long day; current=${longs}`);
    if (!longRequired && longs !== 0) errors.push(`goal_table week ${week.week_index} is not a long-conditioning week`);
    previous = new Set(training.filter((day) => day.focus && day.target && day.stimulus).map((day) => placementSignature(day)));
  }
  errors.push(...goalTableRuleErrors(table));
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
