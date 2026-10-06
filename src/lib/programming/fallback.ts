import { buildWeek } from "../month-plan/build-week";
import { listPieceMaterial } from "../month-plan/pieces";
import type { DayKey, MainLift, MetconPiece, MetconStimulus, PlannedWeek, WeekIndex } from "../month-plan/types";
import { DAY_ORDER } from "../month-plan/types";
import { completeMonthDirection } from "./month-direction";
import { constitutionViolations, similarityScore, structurallySimilar } from "./rules";
import { schemeSets, strengthIsHeavy } from "./schemes";
import { fillSessionFields } from "./session-fields";
import type { WeekActual } from "./summary";
import {
  type ConditioningDraft,
  type Equipment,
  type MonthDirection,
  type MovementPattern,
  type ProgrammingIntent,
  type Scheme,
  type SessionDraft,
  type Stimulus,
  type StoredStructure,
  type TimeDomain,
  type VolumeBand,
  type WeekDraft,
  type WodFormat,
} from "./types";

const WARMUP_KO = "8–12분. 쉬운 팬바이크 2분, 인치웜 5, 팔 돌리기 10. 본운동 전에 빈 바로 맞춥니다.";

const STIMULUS_FROM_KO: Record<MetconStimulus, Stimulus> = {
  고중량: "heavy",
  고반복: "high_rep",
  기술: "technical",
};

function domain(minutes: number): TimeDomain {
  if (minutes <= 12) return "short";
  if (minutes <= 29) return "medium";
  return "long";
}

function volumeFor(minutes: number): VolumeBand {
  if (minutes >= 30) return "high";
  if (minutes >= 13) return "moderate";
  return "low";
}

function equipmentFor(key: string): Equipment {
  if (key === "wall_ball") return "wall_ball";
  if (key === "kb_swing" || key === "kettlebell") return "kettlebell";
  if (key === "box_jump") return "box";
  if (key === "fan_bike" || key === "bike" || key === "assault_bike" || key === "echo_bike") return "bike";
  if (key === "ski" || key === "ski_erg") return "ski";
  if (key === "row") return "rower";
  if (key === "double_under") return "jump_rope";
  if (key === "ring_row") return "rings";
  if (["thruster", "deadlift", "clean", "snatch", "power_clean", "power_snatch", "hang_power_clean"].includes(key)) {
    return "barbell";
  }
  return "bodyweight";
}

function uniqueEquipment(keys: string[]): Equipment[] {
  const out: Equipment[] = [];
  for (const key of keys) {
    const equipment = equipmentFor(key);
    if (!out.includes(equipment)) out.push(equipment);
  }
  return out.length ? out : ["bodyweight"];
}

/** The shared class week the screens already know, kept only as 5/3/1 fallback material. */
export function rulesDisplayWeek(weekIndex: WeekIndex): PlannedWeek {
  return buildWeek({
    weekIndex,
    maxes: {},
    sex: "m",
    recentMetcons: [],
  });
}

export function extractDraft(display: PlannedWeek, intent: ProgrammingIntent): WeekDraft {
  const sessions: SessionDraft[] = display.days.map((day) => {
    if (day.rest || !day.piece) {
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
    const warmup = day.blocks.find((block) => block.role === "warmup");
    const stimulus = day.piece.stimulus ? STIMULUS_FROM_KO[day.piece.stimulus] : null;
    const patterns = [day.piece.pattern as MovementPattern];
    const conditioning: ConditioningDraft = {
      benchmark: day.piece.id === "sl-month-benchmark",
      format: day.piece.format,
      time_domain: domain(day.piece.minutes),
      stimulus,
      movement_patterns: patterns,
      movements: day.piece.movements.map((movement) => ({
        key: movement.key,
        amount: movement.amount,
        name_ko: movement.nameKo,
      })),
      equipment: uniqueEquipment(day.piece.movements.map((movement) => movement.key)),
      rep_structure: `${day.piece.minutes}분 ${day.piece.format}`,
      work_rest_structure: day.piece.format === "intervals" ? "라운드 사이 1분" : "쉬지 않고 반복",
      duration_min: day.piece.minutes,
      volume: volumeFor(day.piece.minutes),
      intensity: stimulus === "heavy" ? "heavy" : stimulus === "technical" ? "light" : "moderate",
      long_conditioning: day.longPiece,
    };
    return fillSessionFields({
      day: day.day,
      rest: false,
      optional: day.optional,
      warmup_min: warmup?.minutes ?? 10,
      warmup_ko: warmup?.bodyKo || WARMUP_KO,
      strength: day.lift
        ? {
            lift: day.lift.exerciseKey,
            sets: day.lift.sets.map((set) => ({
              percent_of_tm: set.percentOfTm,
              reps: set.reps,
              amrap: set.amrap,
            })),
          }
        : null,
      conditioning,
    });
  });
  return { intent, sessions };
}

const TRAINING: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];
const FORMATS: WodFormat[] = ["amrap", "for_time", "emom", "intervals"];
const STIMULI_CYCLE: Stimulus[] = ["heavy", "high_rep", "technical"];
const SCHEME_SHIFT: Record<Scheme, number> = { "531": 0, volume: 2, intensity: 4, skill: 1, deload: 3 };

/** Movements from the class catalog. The weekday slot on each piece is not a schedule. */
/** Names the admin picker already knew. This list is not a weekday schedule. */
const PICKER_MOVEMENTS: Array<{ key: string; amount: string; nameKo: string }> = [
  { key: "double_under", amount: "40", nameKo: "더블언더" },
  { key: "air_squat", amount: "15", nameKo: "에어 스쿼트" },
  { key: "fan_bike", amount: "12cal", nameKo: "팬바이크" },
  { key: "ski", amount: "250m", nameKo: "스키" },
  { key: "ring_row", amount: "8", nameKo: "링 로우" },
  { key: "row", amount: "250m", nameKo: "로잉" },
  { key: "box_jump", amount: "12", nameKo: "박스 점프" },
  { key: "run", amount: "400m", nameKo: "런" },
  { key: "wall_ball", amount: "15", nameKo: "월볼" },
  { key: "burpee", amount: "10", nameKo: "버피" },
];

export function knownFallbackMovements(): Array<{ key: string; amount: string; nameKo: string }> {
  const out: Array<{ key: string; amount: string; nameKo: string }> = [];
  const seen = new Set<string>();
  const rows = [
    ...PICKER_MOVEMENTS,
    ...listPieceMaterial("m").flatMap((piece) =>
      piece.movements.map((movement) => ({ key: movement.key, amount: movement.amount, nameKo: movement.nameKo })),
    ),
  ];
  for (const movement of rows) {
    const id = `${movement.key}:${movement.amount.replace(/\s+/g, "")}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(movement);
  }
  return out;
}

export function highLowerFatigue(actual: WeekActual | null | undefined): boolean {
  if (!actual) return false;
  const signal = actual.class_summary?.fatigue_signal;
  const volume = actual.class_summary?.actual_volume;
  if (signal === "high" && volume === "high") return true;
  return actual.days.some((day) => day.lower_body && day.completed && (day.fatigue === "high" || signal === "high"));
}

function strengthFor(lift: MainLift, scheme: Scheme, weekIndex: WeekIndex): NonNullable<SessionDraft["strength"]> {
  return { lift, sets: schemeSets(scheme, weekIndex) };
}

function dayIndex(day: DayKey): number {
  return TRAINING.indexOf(day);
}

function lowerPairs(days: DayKey[]): Array<[DayKey, DayKey]> {
  const pairs: Array<[DayKey, DayKey]> = [];
  for (let left = 0; left < days.length; left += 1) {
    for (let right = left + 1; right < days.length; right += 1) {
      if (dayIndex(days[right]!) - dayIndex(days[left]!) >= 2) pairs.push([days[left]!, days[right]!]);
    }
  }
  return pairs;
}

function lowerVolume(highLower: boolean, lift: MainLift, scheme: Scheme): VolumeBand {
  if (highLower && (lift === "squat" || lift === "deadlift")) return "low";
  if (scheme === "volume") return "high";
  if (scheme === "deload") return "low";
  return "moderate";
}

function pieceConditioning(
  piece: MetconPiece,
  options: { format: WodFormat; minutes: number; stimulus: Stimulus | null; benchmark: boolean; longPiece: boolean },
): ConditioningDraft {
  return {
    benchmark: options.benchmark,
    format: options.format,
    time_domain: domain(options.minutes),
    stimulus: options.stimulus,
    movement_patterns: [piece.pattern as MovementPattern],
    movements: piece.movements.map((movement) => ({
      key: movement.key,
      amount: movement.amount,
      name_ko: movement.nameKo,
    })),
    equipment: uniqueEquipment(piece.movements.map((movement) => movement.key)),
    rep_structure: `${options.minutes}분 ${options.format}`,
    work_rest_structure: options.format === "intervals" || options.format === "emom" ? "일과 쉼이 나뉩니다" : "쉬지 않고 반복",
    duration_min: options.minutes,
    volume: volumeFor(options.minutes),
    intensity: options.stimulus === "heavy" ? "heavy" : options.stimulus === "technical" ? "light" : "moderate",
    long_conditioning: options.longPiece,
  };
}

function asStructure(conditioning: ConditioningDraft, day: DayKey): StoredStructure {
  return {
    day,
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

function bannedKeys(day: DayKey, lifts: Map<DayKey, MainLift>, heavy: boolean): string[] {
  if (!heavy) return [];
  const previous = dayIndex(day) > 0 ? lifts.get(TRAINING[dayIndex(day) - 1]!) : undefined;
  if (previous === "squat") return ["deadlift", "snatch", "power_snatch", "clean", "power_clean", "hang_power_clean"];
  if (previous === "deadlift") return ["squat", "air_squat", "front_squat", "thruster", "lunge"];
  if (previous === "ohp" || previous === "bench") return ["snatch", "power_snatch"];
  return [];
}

function pieceAllowed(piece: MetconPiece, bans: string[], avoidLower: boolean): boolean {
  if (piece.id === "sl-month-benchmark" || piece.id === "wed-long") return false;
  if (avoidLower && (piece.pattern === "squat" || piece.pattern === "hinge")) return false;
  const keys = piece.movements.map((movement) => movement.key);
  return !bans.some((ban) => keys.includes(ban));
}

function avoidRepeat(conditioning: ConditioningDraft, previous: Stimulus | null): ConditioningDraft {
  if (!conditioning.stimulus || conditioning.stimulus !== previous) return conditioning;
  const stimulus = STIMULI_CYCLE.find((item) => item !== previous) ?? "technical";
  return {
    ...conditioning,
    stimulus,
    intensity: stimulus === "heavy" ? "heavy" : stimulus === "technical" ? "light" : "moderate",
  };
}

function pickConditioning(input: {
  day: DayKey;
  minutes: number;
  benchmark: boolean;
  longPiece: boolean;
  previousStimulus: Stimulus | null;
  bans: string[];
  avoidLower: boolean;
  chosen: StoredStructure[];
  recent: readonly StoredStructure[];
  seed: number;
}): ConditioningDraft {
  const material = listPieceMaterial("m");
  const benchmarkPiece = material.find((piece) => piece.id === "sl-month-benchmark");
  const longPieceRow = material.find((piece) => piece.id === "wed-long");
  if (input.benchmark && benchmarkPiece) {
    return pieceConditioning(benchmarkPiece, {
      format: "for_time",
      minutes: 20,
      stimulus: "high_rep",
      benchmark: true,
      longPiece: false,
    });
  }
  if (input.longPiece && longPieceRow) {
    return pieceConditioning(longPieceRow, {
      format: "for_time",
      minutes: 35,
      stimulus: null,
      benchmark: false,
      longPiece: true,
    });
  }
  const pool = material.filter((piece) => pieceAllowed(piece, input.bans, input.avoidLower));
  const candidates: ConditioningDraft[] = [];
  const span = Math.max(pool.length, 1) * FORMATS.length * STIMULI_CYCLE.length;
  for (let step = 0; step < span; step += 1) {
    const offset = input.seed + step;
    const piece = pool[offset % Math.max(pool.length, 1)];
    if (!piece) break;
    const format = FORMATS[offset % FORMATS.length]!;
    const stimulus = STIMULI_CYCLE[Math.floor(offset / FORMATS.length) % STIMULI_CYCLE.length]!;
    if (stimulus === input.previousStimulus) continue;
    candidates.push(
      pieceConditioning(piece, {
        format,
        minutes: input.minutes,
        stimulus,
        benchmark: false,
        longPiece: false,
      }),
    );
  }
  let best = candidates[0];
  let bestScore = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const structure = asStructure(candidate, input.day);
    const priors = [...input.chosen, ...input.recent];
    if (!priors.some((prior) => structurallySimilar(structure, prior))) return candidate;
    const score = priors.reduce((sum, prior) => sum + similarityScore(structure, prior), 0);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  if (best) return best;
  const fallbackPiece = pool[0] ?? material[0]!;
  return pieceConditioning(fallbackPiece, {
    format: "emom",
    minutes: input.minutes,
    stimulus: input.previousStimulus === "technical" ? "high_rep" : "technical",
    benchmark: false,
    longPiece: false,
  });
}

export function buildFallbackWeek(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  intent: ProgrammingIntent;
  recent?: readonly StoredStructure[];
  previousActual?: WeekActual | null;
}): WeekDraft {
  const month = input.month;
  const weekIndex = input.weekIndex;
  const recent = input.recent ?? [];
  const highLower = highLowerFatigue(input.previousActual);
  const heavy = strengthIsHeavy(schemeSets(month.scheme, weekIndex));
  const shift = SCHEME_SHIFT[month.scheme];
  const lowerPool = highLower ? TRAINING.filter((day) => day !== "mon" && day !== "tue") : TRAINING;
  const pairs = lowerPairs(lowerPool);
  const pair = pairs[(weekIndex - 1 + shift + 5) % pairs.length]!;
  const lowerLifts: MainLift[] = (weekIndex + shift) % 2 === 0 ? ["squat", "deadlift"] : ["deadlift", "squat"];
  const lifts = new Map<DayKey, MainLift>([
    [pair[0], lowerLifts[0]!],
    [pair[1], lowerLifts[1]!],
  ]);
  const lowerDays = new Set(lifts.keys());
  const dayAfterLower = new Set(
    [...lowerDays].map((day) => TRAINING[dayIndex(day) + 1]).filter((day): day is DayKey => day != null),
  );
  const longPool = TRAINING.filter((day) => !lowerDays.has(day) && !dayAfterLower.has(day) && day !== "wed");
  const longDay = month.long_conditioning_weeks.includes(weekIndex)
    ? (longPool[(weekIndex + shift) % Math.max(longPool.length, 1)] ?? null)
    : null;
  const benchmarkPool = TRAINING.filter((day) => day !== longDay && !dayAfterLower.has(day) && day !== "thu");
  const benchmarkDay =
    month.benchmark_week === weekIndex ? (benchmarkPool[(weekIndex + shift) % Math.max(benchmarkPool.length, 1)] ?? "fri") : null;
  const upper: MainLift[] = (weekIndex + shift) % 2 === 0 ? ["ohp", "bench"] : ["bench", "ohp"];
  TRAINING.filter((day) => !lowerDays.has(day))
    .slice(0, 2)
    .forEach((day, index) => lifts.set(day, upper[index]!));

  const chosen: StoredStructure[] = [];
  let previousStimulus: Stimulus | null = null;
  const sessions = DAY_ORDER.map((day) => {
    if (day === "sun") {
      return fillSessionFields({
        day,
        rest: true,
        optional: false,
        warmup_min: 0,
        warmup_ko: "",
        strength: null,
        conditioning: null,
      });
    }
    const lift = lifts.get(day) ?? null;
    const conditioning = avoidRepeat(pickConditioning({
      day,
      minutes: day === longDay ? 35 : day === benchmarkDay ? 20 : dayAfterLower.has(day) ? 10 : 14 + ((dayIndex(day) + shift) % 3) * 2,
      benchmark: day === benchmarkDay,
      longPiece: day === longDay,
      previousStimulus,
      bans: bannedKeys(day, lifts, heavy),
      avoidLower: highLower && (day === "mon" || day === "tue"),
      chosen,
      recent,
      seed: dayIndex(day) + weekIndex * 3 + shift,
    }), previousStimulus);
    const structure = asStructure(conditioning, day);
    if (!structure.benchmark) chosen.push(structure);
    previousStimulus = conditioning.stimulus;
    return fillSessionFields(
      {
        day,
        rest: false,
        optional: day === "sat",
        warmup_min: 10,
        warmup_ko: WARMUP_KO,
        strength: lift ? strengthFor(lift, month.scheme, weekIndex) : null,
        conditioning,
      },
      lift ? lowerVolume(highLower, lift, month.scheme) : null,
    );
  });
  const schemeNote = highLower
    ? `${month.primary_block} 블록입니다. 지난주 하체 피로가 높아 주 초 하체 볼륨을 줄입니다. ${input.intent.scheme_note}`
    : `${month.primary_block} 블록을 따릅니다. ${input.intent.scheme_note}`;
  return { intent: { ...input.intent, scheme_note: schemeNote }, sessions };
}

export function draftForScheme(month: MonthDirection, weekIndex: WeekIndex, intent: ProgrammingIntent): WeekDraft {
  return buildFallbackWeek({ month, weekIndex, intent });
}

export function fallbackIntent(month: MonthDirection, weekIndex: WeekIndex, reason: string): ProgrammingIntent {
  return {
    why_ko: `${month.scheme} 블록 ${weekIndex}주입니다. 모델 응답을 쓰지 않고 이 달의 방식으로 채웁니다. 이유 코드는 ${reason}입니다.`,
    focus: month.focus_ko,
    scheme_note: `${month.scheme}는 이번 달 전체의 선택입니다. 주마다 방식을 바꾸지 않습니다.`,
  };
}

export function fallbackMonth(prior: { summary_ko: string; next_scheme: MonthDirection["scheme"] } | null): MonthDirection {
  const scheme = prior?.next_scheme ?? "531";
  return completeMonthDirection({
    scheme,
    focus_ko: prior ? "지난 달 평가가 고른 한 달" : "저장한 1RM으로 5/3/1 블록을 엽니다",
    why_ko: prior?.summary_ko || "이전 월 평가가 없어 5/3/1 블록을 한 달 동안 유지합니다.",
    week_themes: [
      { week_index: 1, theme_ko: "블록을 엽니다" },
      { week_index: 2, theme_ko: "긴 컨디셔닝 한 번" },
      { week_index: 3, theme_ko: "같은 방식을 이어 갑니다" },
      { week_index: 4, theme_ko: "벤치마크로 측정합니다" },
    ],
    long_conditioning_weeks: [2, 4],
    benchmark_week: 4,
    constraints: ["하루 WOD는 이 방향에 없습니다.", "회원마다 다른 WOD는 만들지 않습니다."],
  });
}

export function assertFallbackLegal(draft: WeekDraft, month: MonthDirection, weekIndex: WeekIndex): void {
  const errors = constitutionViolations(draft, month, weekIndex);
  if (errors.length) throw new Error(`fallback broke a rule: ${errors[0]}`);
}
