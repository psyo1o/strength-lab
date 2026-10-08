import { DAY_ORDER, type DayKey, type MainLift } from "../month-plan/types";
import { classMetconPurpose } from "../wod/purpose";
import { fillSessionFields } from "./session-fields";
import { exampleSets } from "./strength-methods";
import { judgeWeek, previousLowerFatigue, similarityScore, type WeekCheckContext } from "./rules";
import { strengthIsHeavy } from "./schemes";
import { stampWeeklyIntent } from "./weekly-intent";
import type { WeekActual } from "./summary";
import {
  type ConditioningDraft,
  type DayIntent,
  type Equipment,
  type IntensityBand,
  type MonthDirection,
  type MovementPattern,
  type SessionDraft,
  type Stimulus,
  type StoredStructure,
  type TimeDomain,
  type VolumeBand,
  type WeekDraft,
  type WeekIndex,
  type WeeklyIntentPlan,
  type WodFormat,
} from "./types";

/**
 * Realizes a weekly intent as sessions.
 * The same intent can land on a different format, interval, and movement combination.
 * Strength sets stay on the month's method. This layer does not invent a new method.
 */

type Piece = {
  id: string;
  format: WodFormat;
  minutes: number;
  stimulus: Stimulus;
  patterns: MovementPattern[];
  movements: Array<{ key: string; amount: string; name_ko: string }>;
  equipment: Equipment[];
  intensity: IntensityBand;
  volume: VolumeBand;
};

const DAY_KO: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

function piece(
  id: string,
  format: WodFormat,
  minutes: number,
  stimulus: Stimulus,
  patterns: MovementPattern[],
  movements: Piece["movements"],
  equipment: Equipment[],
  intensity: IntensityBand,
  volume: VolumeBand,
): Piece {
  return { id, format, minutes, stimulus, patterns, movements, equipment, intensity, volume };
}

const SPRINT = [
  piece("sprint-row", "intervals", 10, "high_rep", ["engine"], [{ key: "row", amount: "12/10cal", name_ko: "로잉" }], ["rower"], "moderate", "low"),
  piece("sprint-rope", "amrap", 12, "high_rep", ["engine"], [{ key: "double_under", amount: "30", name_ko: "더블언더" }, { key: "burpee", amount: "6", name_ko: "버피" }], ["jump_rope", "bodyweight"], "moderate", "low"),
  piece("sprint-bike", "for_time", 8, "technical", ["engine"], [{ key: "fan_bike", amount: "10/8cal", name_ko: "팬바이크" }], ["bike"], "light", "low"),
];

const GYM = [
  piece("gym-ring", "emom", 16, "technical", ["gymnastic"], [{ key: "ring_row", amount: "8", name_ko: "링 로우" }, { key: "push_up", amount: "6", name_ko: "푸시업" }], ["rings", "bodyweight"], "light", "low"),
  piece("gym-burpee", "for_time", 14, "high_rep", ["gymnastic"], [{ key: "burpee", amount: "10", name_ko: "버피" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], ["bodyweight"], "moderate", "moderate"),
  piece("gym-easy", "intervals", 16, "technical", ["gymnastic"], [{ key: "push_up", amount: "8", name_ko: "푸시업" }, { key: "sit_up", amount: "8", name_ko: "싯업" }], ["bodyweight"], "light", "low"),
];

const OLY = [
  piece("oly-emom", "emom", 14, "technical", ["olympic"], [{ key: "power_clean", amount: "3", name_ko: "파워 클린" }, { key: "burpee", amount: "6", name_ko: "버피" }], ["barbell", "bodyweight"], "light", "low"),
  piece("oly-time", "for_time", 12, "technical", ["olympic"], [{ key: "power_clean", amount: "5", name_ko: "파워 클린" }], ["barbell"], "light", "low"),
  piece("oly-interval", "intervals", 18, "high_rep", ["olympic"], [{ key: "hang_power_clean", amount: "4", name_ko: "행 파워 클린" }, { key: "row", amount: "12/10cal", name_ko: "로잉" }], ["barbell", "rower"], "moderate", "moderate"),
];

const ENGINE = [
  piece("eng-bike", "amrap", 16, "high_rep", ["engine"], [{ key: "fan_bike", amount: "10/8cal", name_ko: "팬바이크" }, { key: "burpee", amount: "8", name_ko: "버피" }], ["bike", "bodyweight"], "moderate", "moderate"),
  piece("eng-ski", "for_time", 18, "high_rep", ["engine"], [{ key: "ski", amount: "200m", name_ko: "스키" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], ["ski", "bodyweight"], "moderate", "moderate"),
  piece("eng-row", "intervals", 14, "technical", ["engine"], [{ key: "row", amount: "12/10cal", name_ko: "로잉" }], ["rower"], "light", "low"),
];

const PULL = [
  piece("pull-time", "for_time", 16, "high_rep", ["pull"], [{ key: "pull_up", amount: "6", name_ko: "풀업" }, { key: "burpee", amount: "8", name_ko: "버피" }], ["pullup_bar", "bodyweight"], "moderate", "moderate"),
  piece("pull-emom", "emom", 12, "technical", ["pull"], [{ key: "ring_row", amount: "8", name_ko: "링 로우" }], ["rings"], "light", "low"),
  piece("pull-amrap", "amrap", 18, "high_rep", ["pull"], [{ key: "pull_up", amount: "5", name_ko: "풀업" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], ["pullup_bar", "bodyweight"], "moderate", "moderate"),
];

const HINGE = [
  piece("hinge-interval", "intervals", 12, "high_rep", ["hinge"], [{ key: "kb_swing", amount: "10", name_ko: "케틀벨 스윙" }, { key: "burpee", amount: "6", name_ko: "버피" }], ["kettlebell", "bodyweight"], "moderate", "low"),
  piece("hinge-time", "for_time", 10, "technical", ["hinge"], [{ key: "kb_swing", amount: "8", name_ko: "케틀벨 스윙" }], ["kettlebell"], "light", "low"),
];

const MIXED = [
  piece("mix-press", "amrap", 16, "high_rep", ["press"], [{ key: "push_up", amount: "10", name_ko: "푸시업" }, { key: "burpee", amount: "8", name_ko: "버피" }], ["bodyweight"], "moderate", "moderate"),
  piece("mix-wall", "intervals", 18, "high_rep", ["squat"], [{ key: "wall_ball", amount: "10", name_ko: "월볼" }, { key: "box_jump", amount: "8", name_ko: "박스 점프" }], ["wall_ball", "box"], "moderate", "moderate"),
  piece("mix-emom", "emom", 14, "technical", ["press"], [{ key: "push_up", amount: "6", name_ko: "푸시업" }, { key: "sit_up", amount: "8", name_ko: "싯업" }], ["bodyweight"], "light", "low"),
  piece("mix-run", "for_time", 16, "technical", ["engine"], [{ key: "run", amount: "200m", name_ko: "런" }, { key: "burpee", amount: "8", name_ko: "버피" }], ["bodyweight"], "moderate", "moderate"),
];

/**
 * Pattern and equipment are separate similarity features.
 * A body that shares either one with another body can still collide when the other four features match.
 */
const BODIES: Array<{
  patterns: MovementPattern[];
  movements: Piece["movements"];
  equipment: Equipment[];
  heavySafe: boolean;
}> = [
  { patterns: ["engine"], movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }], equipment: ["rower"], heavySafe: true },
  { patterns: ["engine"], movements: [{ key: "fan_bike", amount: "10/8cal", name_ko: "팬바이크" }], equipment: ["bike"], heavySafe: true },
  { patterns: ["engine"], movements: [{ key: "ski", amount: "200m", name_ko: "스키" }], equipment: ["ski"], heavySafe: true },
  { patterns: ["engine"], movements: [{ key: "double_under", amount: "30", name_ko: "더블언더" }], equipment: ["jump_rope"], heavySafe: true },
  { patterns: ["gymnastic"], movements: [{ key: "ring_row", amount: "8", name_ko: "링 로우" }], equipment: ["rings"], heavySafe: true },
  { patterns: ["gymnastic"], movements: [{ key: "burpee", amount: "8", name_ko: "버피" }, { key: "push_up", amount: "8", name_ko: "푸시업" }], equipment: ["bodyweight"], heavySafe: true },
  { patterns: ["pull"], movements: [{ key: "pull_up", amount: "6", name_ko: "풀업" }], equipment: ["pullup_bar"], heavySafe: true },
  { patterns: ["press"], movements: [{ key: "db_press", amount: "8", name_ko: "덤벨 프레스" }], equipment: ["dumbbell"], heavySafe: true },
  { patterns: ["olympic"], movements: [{ key: "power_clean", amount: "3", name_ko: "파워 클린" }], equipment: ["barbell"], heavySafe: false },
  { patterns: ["olympic"], movements: [{ key: "hang_power_clean", amount: "4", name_ko: "행 파워 클린" }, { key: "row", amount: "12/10cal", name_ko: "로잉" }], equipment: ["barbell", "rower"], heavySafe: false },
  { patterns: ["hinge"], movements: [{ key: "kb_swing", amount: "10", name_ko: "케틀벨 스윙" }], equipment: ["kettlebell"], heavySafe: false },
  { patterns: ["squat"], movements: [{ key: "wall_ball", amount: "10", name_ko: "월볼" }], equipment: ["wall_ball"], heavySafe: false },
  { patterns: ["squat"], movements: [{ key: "box_jump", amount: "8", name_ko: "박스 점프" }], equipment: ["box"], heavySafe: false },
  { patterns: ["pull"], movements: [{ key: "ring_row", amount: "8", name_ko: "링 로우" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], equipment: ["rings", "bodyweight"], heavySafe: true },
  { patterns: ["engine"], movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }, { key: "run", amount: "200m", name_ko: "런" }], equipment: ["rower", "bodyweight"], heavySafe: true },
  { patterns: ["hinge"], movements: [{ key: "kb_swing", amount: "8", name_ko: "케틀벨 스윙" }, { key: "burpee", amount: "6", name_ko: "버피" }], equipment: ["kettlebell", "bodyweight"], heavySafe: false },
];

function domain(minutes: number): TimeDomain {
  if (minutes <= 12) return "short";
  if (minutes <= 29) return "medium";
  return "long";
}

function poolFor(day: DayIntent): Piece[] {
  if (day.recovery_role === "easy" || day.primary_training === "recovery") return [...GYM, ...MIXED.filter((row) => row.intensity === "light")];
  if (day.primary_training === "olympic_strength" || day.primary_training === "olympic_technique" || day.movement_pattern === "olympic") return OLY;
  if (day.primary_training === "gymnastics_skill" || day.secondary_training === "gymnastics_skill") return GYM;
  if (day.primary_training === "upper_pull" || day.movement_pattern === "pull") return PULL;
  if (day.primary_training === "aerobic" || day.secondary_training === "aerobic") return ENGINE;
  if (day.secondary_training === "sprint" || day.secondary_training === "short_anaerobic") return SPRINT;
  if (day.movement_pattern === "hinge") return HINGE;
  return MIXED;
}

function asStructure(day: DayKey, row: Piece, benchmark: boolean): StoredStructure {
  return {
    day,
    format: row.format,
    time_domain: domain(row.minutes),
    stimulus: row.stimulus,
    movement_patterns: row.patterns,
    movements: row.movements,
    equipment: row.equipment,
    rep_structure: `${row.format}:${row.minutes}`,
    work_rest_structure: row.format,
    duration_min: row.minutes,
    volume: row.volume,
    intensity: row.intensity,
    benchmark,
    long_conditioning: domain(row.minutes) === "long",
  };
}

function workText(format: WodFormat, minutes: number, names: string, variant: number): { rep: string; rest: string } {
  if (domain(minutes) === "long") {
    const rounds = variant % 2 === 0 ? 3 : 4;
    return {
      rep: `${rounds}라운드. 캡 ${minutes}분. ${names}.`,
      rest: variant % 2 === 0 ? `라운드 사이 1분 휴식. ${minutes}분 안에 끝냅니다.` : `40초 일하고 20초 쉽니다. 캡 ${minutes}분.`,
    };
  }
  if (format === "emom") {
    return {
      rep: `${minutes}분 동안 1분마다 ${names}. 캡 ${minutes}분.`,
      rest: `한 분은 한 묶음입니다. 캡 ${minutes}분.`,
    };
  }
  if (format === "intervals") {
    const work = variant % 2 === 0 ? "40초 일하고 20초" : "30초 일하고 30초";
    return {
      rep: `${minutes}분 인터벌. ${work} 쉽니다. ${names}.`,
      rest: `일과 쉼이 나뉩니다. 캡 ${minutes}분.`,
    };
  }
  if (format === "for_time") {
    const rounds = 3 + (variant % 3);
    return {
      rep: `${rounds}라운드. 캡 ${minutes}분. ${names}.`,
      rest: `끝나면 기록을 남깁니다. 캡 ${minutes}분.`,
    };
  }
  return {
    rep: `${minutes}분 동안 반복합니다. ${names}.`,
    rest: `시간 안에 라운드를 반복합니다. 캡 ${minutes}분.`,
  };
}

function conditioningFor(day: DayKey, row: Piece, benchmark: boolean, variant: number): ConditioningDraft {
  const names = row.movements.map((movement) => movement.name_ko).join(", ");
  const text = workText(row.format, row.minutes, names, variant);
  const time = domain(row.minutes);
  return {
    benchmark,
    format: row.format,
    time_domain: time,
    stimulus: row.stimulus,
    movement_patterns: row.patterns,
    movements: row.movements.map((movement) => ({ ...movement })),
    equipment: [...row.equipment],
    rep_structure: text.rep,
    work_rest_structure: text.rest,
    duration_min: row.minutes,
    volume: row.volume,
    intensity: row.intensity,
    long_conditioning: time === "long",
    purpose: classMetconPurpose({
      names: row.movements.map((movement) => movement.name_ko),
      benchmark,
      longPiece: time === "long",
      format: row.format,
      stimulus: row.stimulus,
    }),
  };
}

function lowerFatigue(actual: WeekActual | null | undefined): "high" | "low" | "unknown" {
  const level = previousLowerFatigue(actual);
  if (level === "high" || level === "low") return level;
  return "unknown";
}

function heavyLower(method: string, weekIndex: WeekIndex, fatigue: "high" | "low" | "unknown"): boolean {
  const sets = exampleSets(method, weekIndex, fatigue, "squat");
  return Boolean(sets && strengthIsHeavy(sets));
}

function assignLifts(plan: WeeklyIntentPlan, heavy: boolean, fatigue: "high" | "low" | "unknown", shift: number): Map<DayKey, MainLift> {
  const lifts = new Map<DayKey, MainLift>();
  for (const day of plan.days) {
    if (day.strength_lift === "none") continue;
    if (day.day === "sun" || day.primary_training === "rest" || day.recovery_role === "rest") continue;
    lifts.set(day.day, day.strength_lift);
  }
  if (lifts.has("sat")) {
    const lift = lifts.get("sat")!;
    lifts.delete("sat");
    const dest = DAY_ORDER.find((day) => day !== "sun" && day !== "sat" && !lifts.has(day));
    if (dest) lifts.set(dest, lift);
  }
  if (fatigue === "high" && heavy) {
    let kept = false;
    for (const day of DAY_ORDER) {
      const lift = lifts.get(day);
      if (lift !== "squat" && lift !== "deadlift") continue;
      if (!kept) kept = true;
      else lifts.delete(day);
    }
  }
  if (heavy) separateLowers(lifts);
  if (shift > 0) nudgeUpper(lifts, shift);
  return lifts;
}

function separateLowers(lifts: Map<DayKey, MainLift>): void {
  const order = DAY_ORDER.filter((day) => day !== "sun");
  const lowers = () => order.filter((day) => lifts.get(day) === "squat" || lifts.get(day) === "deadlift");
  for (let guard = 0; guard < 4; guard += 1) {
    const days = lowers();
    let moved = false;
    for (let index = 1; index < days.length; index += 1) {
      const previous = order.indexOf(days[index - 1]!);
      const current = order.indexOf(days[index]!);
      if (current - previous > 1) continue;
      const day = days[index]!;
      const lift = lifts.get(day)!;
      lifts.delete(day);
      const dest = order.find((candidate) => {
        if (candidate === "sat" || lifts.has(candidate)) return false;
        return lowers().every((other) => Math.abs(order.indexOf(other) - order.indexOf(candidate)) > 1);
      });
      if (dest) lifts.set(dest, lift);
      moved = true;
      break;
    }
    if (!moved) return;
  }
}

function nudgeUpper(lifts: Map<DayKey, MainLift>, shift: number): void {
  const uppers = DAY_ORDER.filter((day) => lifts.get(day) === "bench" || lifts.get(day) === "ohp");
  const target = uppers[0];
  if (!target) return;
  const lift = lifts.get(target)!;
  const open = DAY_ORDER.filter((day) => day !== "sun" && day !== "sat" && !lifts.has(day));
  const dest = open[shift % Math.max(1, open.length)];
  if (!dest) return;
  lifts.delete(target);
  lifts.set(dest, lift);
}

function chooseLong(plan: WeeklyIntentPlan, lifts: Map<DayKey, MainLift>, heavy: boolean, required: boolean, shift: number): DayKey | null {
  if (!required) return null;
  const heavyDays = new Set(DAY_ORDER.filter((day) => heavy && (lifts.get(day) === "squat" || lifts.get(day) === "deadlift")));
  const after = new Set<DayKey>();
  for (const day of heavyDays) {
    const next = DAY_ORDER[DAY_ORDER.indexOf(day) + 1];
    if (next && next !== "sun") after.add(next);
  }
  const preferred = plan.days.find((day) => day.secondary_training === "long_conditioning" && day.primary_training !== "rest")?.day ?? null;
  const order: DayKey[] = ["sat", "thu", "tue", "fri", "wed", "mon"];
  const rotated = order.map((_, index) => order[(index + shift) % order.length]!);
  const open = rotated.filter((day) => !lifts.has(day) && !heavyDays.has(day) && !after.has(day));
  if (preferred && open.includes(preferred)) return preferred;
  return open[0] ?? null;
}

function chooseBenchmark(plan: WeeklyIntentPlan, longDay: DayKey | null, required: boolean): DayKey | null {
  if (!required) return null;
  const marked = plan.days.find((day) => day.benchmark && day.day !== longDay && day.primary_training !== "rest" && day.recovery_role !== "rest");
  if (marked) return marked.day;
  return DAY_ORDER.find((day) => day !== "sun" && day !== longDay) ?? "thu";
}

const FORMAT_CYCLE: WodFormat[] = ["amrap", "for_time", "emom", "intervals"];
const STIMULUS_CYCLE: Stimulus[] = ["high_rep", "technical", "heavy"];
const VOLUME_CYCLE: VolumeBand[] = ["low", "moderate", "high"];

function minutesFor(time: TimeDomain, salt: number): number {
  if (time === "short") return [8, 10, 12][Math.abs(salt) % 3]!;
  if (time === "medium") return [14, 16, 18, 22][Math.abs(salt) % 4]!;
  return [30, 32, 34, 36][Math.abs(salt) % 4]!;
}

function worstScore(
  day: DayKey,
  row: Piece,
  benchmark: boolean,
  chosen: readonly StoredStructure[],
  recent: readonly StoredStructure[],
): number {
  if (benchmark) return 0;
  const structure = asStructure(day, row, false);
  let worst = 0;
  for (const prior of [...chosen, ...recent]) {
    if (prior.benchmark) continue;
    worst = Math.max(worst, similarityScore(structure, prior));
  }
  return worst;
}

function enumeratePieces(day: DayIntent, long: boolean, salt: number): Piece[] {
  const preferred = new Set(poolFor(day).flatMap((row) => row.patterns));
  const bodies = [...BODIES].sort((left, right) => {
    const leftPreferred = left.patterns.some((pattern) => preferred.has(pattern)) ? 0 : 1;
    const rightPreferred = right.patterns.some((pattern) => preferred.has(pattern)) ? 0 : 1;
    return leftPreferred - rightPreferred;
  });
  const times: TimeDomain[] = long ? ["long"] : ["short", "medium"];
  const volumes: VolumeBand[] = long ? ["high", "moderate", "low"] : VOLUME_CYCLE;
  const out: Piece[] = [];
  for (const body of bodies) {
    for (const format of FORMAT_CYCLE) {
      for (const stimulus of STIMULUS_CYCLE) {
        if (stimulus === "heavy" && !body.heavySafe) continue;
        for (const time of times) {
          for (const volume of volumes) {
            out.push({
              id: `piece-${out.length}`,
              format,
              minutes: minutesFor(time, salt + out.length),
              stimulus,
              volume,
              intensity: stimulus === "technical" ? "light" : "moderate",
              patterns: body.patterns,
              movements: body.movements,
              equipment: body.equipment,
            });
          }
        }
      }
    }
  }
  const shift = Math.abs(salt) % Math.max(1, out.length);
  return out.map((_, index) => out[(index + shift) % out.length]!);
}

function pickPiece(
  day: DayIntent,
  chosen: readonly StoredStructure[],
  recent: readonly StoredStructure[],
  lastStimulus: Stimulus | null,
  salt: number,
  long: boolean,
  benchmark: boolean,
): Piece {
  const pool = enumeratePieces(day, long, salt);
  let best: { row: Piece; score: number } | null = null;
  for (const row of pool) {
    if (lastStimulus != null && row.stimulus === lastStimulus) continue;
    const score = worstScore(day.day, row, benchmark, chosen, recent);
    if (score >= 4) continue;
    if (!best || score < best.score) best = { row, score };
    if (best.score <= 2) break;
  }
  if (best) return best.row;
  for (const row of pool) {
    const score = worstScore(day.day, row, benchmark, chosen, recent);
    if (score >= 4) continue;
    if (!best || score < best.score) best = { row, score };
  }
  return best?.row ?? pool[0]!;
}

function buildDraft(
  plan: WeeklyIntentPlan,
  month: MonthDirection,
  weekIndex: WeekIndex,
  fatigue: "high" | "low" | "unknown",
  recent: readonly StoredStructure[],
  attempt: number,
): WeekDraft {
  const method = month.strength_method || month.scheme;
  const heavy = heavyLower(method, weekIndex, fatigue);
  const lifts = assignLifts(plan, heavy, fatigue, attempt);
  const longRequired = month.long_conditioning_weeks.includes(weekIndex);
  const longDay = chooseLong(plan, lifts, heavy, longRequired, attempt);
  const benchmarkDay = chooseBenchmark(plan, longDay, month.benchmark_week === weekIndex);
  const chosen: StoredStructure[] = [];
  let lastStimulus: Stimulus | null = null;
  const cores = DAY_ORDER.map((key, index) => {
    const intent = plan.days.find((day) => day.day === key)!;
    if (intent.primary_training === "rest" || intent.recovery_role === "rest" || key === "sun") {
      return {
        day: key,
        rest: true,
        optional: false,
        warmup_min: 0,
        warmup_ko: "",
        strength: null,
        conditioning: null,
      };
    }
    const lift = key === longDay ? null : (lifts.get(key) ?? null);
    if (key === longDay) lifts.delete(key);
    const long = key === longDay;
    const benchmark = key === benchmarkDay && !long;
    const row = pickPiece(intent, chosen, recent, lastStimulus, weekIndex * 5 + index + attempt * 3, long, benchmark);
    const conditioning = conditioningFor(key, row, benchmark, weekIndex + attempt);
    chosen.push(asStructure(key, row, benchmark));
    lastStimulus = row.stimulus;
    const sets = lift ? exampleSets(method, weekIndex, lift === "squat" || lift === "deadlift" ? fatigue : "unknown", lift) : null;
    const barbell = Boolean(lift) || conditioning.equipment.includes("barbell");
    const name = lift === "squat" ? "스쿼트" : lift === "deadlift" ? "데드리프트" : lift === "bench" ? "벤치" : lift === "ohp" ? "프레스" : "바벨";
    return {
      day: key,
      rest: false,
      optional: key === "sat",
      warmup_min: 10,
      warmup_ko: barbell
        ? `${DAY_KO[key]} 10분. 쉬운 로잉 2분, 인치웜 5, 팔 돌리기 10. ${name} 전에 빈 바로 맞춥니다.`
        : `${DAY_KO[key]} 10분. 쉬운 로잉 2분, 인치웜 5, 팔 돌리기 10. 맨몸과 머신으로 엽니다.`,
      strength: lift && sets ? { lift, sets } : null,
      conditioning,
    };
  });
  const sessions: SessionDraft[] = cores.map((core) => {
    const lift = core.strength?.lift;
    const volume = !lift ? null : fatigue === "high" && (lift === "squat" || lift === "deadlift") ? "low" : plan.block_phase === "deload" ? "low" : "moderate";
    return fillSessionFields(core, volume);
  });
  const stamped = stampWeeklyIntent({ intent: { why_ko: plan.why_ko, focus: plan.focus, scheme_note: plan.scheme_note }, sessions }, plan);
  return stamped as WeekDraft;
}

export function realizeWeekFromIntent(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  plan: WeeklyIntentPlan;
  recent?: readonly StoredStructure[];
  previousActual?: WeekActual | null;
  recentLiftMaps?: readonly string[];
}): WeekDraft {
  const fatigue = lowerFatigue(input.previousActual);
  const recent = input.recent ?? [];
  const context: WeekCheckContext = {
    previousActual: input.previousActual ?? null,
    recentLiftMaps: input.recentLiftMaps ?? [],
  };
  let last = buildDraft(input.plan, input.month, input.weekIndex, fatigue, recent, 0);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const draft = buildDraft(input.plan, input.month, input.weekIndex, fatigue, recent, attempt);
    last = draft;
    const bare: WeekDraft = {
      ...draft,
      intent: { why_ko: draft.intent.why_ko, focus: draft.intent.focus, scheme_note: draft.intent.scheme_note },
    };
    const judged = judgeWeek(bare, input.month, input.weekIndex, recent, context);
    if (judged.ok) return stampWeeklyIntent(judged.draft, input.plan) as WeekDraft;
  }
  return last;
}

export function structuralSignature(draft: WeekDraft): string {
  return draft.sessions
    .filter((session) => session.conditioning)
    .map((session) =>
      [
        session.day,
        session.conditioning?.format,
        session.conditioning?.time_domain,
        session.conditioning?.stimulus,
        session.conditioning?.movement_patterns.join("+"),
        session.conditioning?.work_rest_structure,
        session.conditioning?.duration_min,
        session.strength?.lift ?? "-",
        session.strength?.sets.map((set) => `${set.percent_of_tm}x${set.reps}`).join("/") ?? "-",
      ].join(":"),
    )
    .join("|");
}
