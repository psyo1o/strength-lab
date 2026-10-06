import { buildWeek } from "../month-plan/build-week";
import { listPieceMaterial } from "../month-plan/pieces";
import type { DayKey, MainLift, MetconPiece, MetconStimulus, PlannedWeek, WeekIndex } from "../month-plan/types";
import { DAY_ORDER } from "../month-plan/types";
import { completeMonthDirection } from "./month-direction";
import { constitutionViolations, similarityScore, structurallySimilar } from "./rules";
import { fatigueCutSets, schemeSets, strengthIsHeavy } from "./schemes";
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

const DAY_KO: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

const LOADED_KEYS = new Set([
  "thruster",
  "clean",
  "snatch",
  "power_clean",
  "power_snatch",
  "hang_power_clean",
  "deadlift",
  "squat",
  "front_squat",
]);

const ENGINE_KEYS = new Set(["run", "row", "ski", "ski_erg", "fan_bike", "bike", "assault_bike", "echo_bike", "double_under"]);

function patternOf(key: string): MovementPattern {
  if (["thruster", "air_squat", "front_squat", "squat", "lunge", "ohs", "overhead_squat", "wall_ball", "pistol"].includes(key)) {
    return "squat";
  }
  if (["deadlift", "kb_swing", "kettlebell", "sdhp"].includes(key)) return "hinge";
  if (["clean", "snatch", "power_clean", "power_snatch", "hang_power_clean", "push_jerk"].includes(key)) return "olympic";
  if (key === "handstand" || key === "hspu" || key === "muscle_up") return "gymnastic";
  if (["pull_up", "kipping_pull_up", "ring_row", "toes_to_bar"].includes(key)) return "pull";
  if (["push_up", "push_press", "dip", "ring_dip"].includes(key)) return "press";
  if (key === "burpee" || key === "sit_up" || key === "knee_raise") return "gymnastic";
  if (ENGINE_KEYS.has(key)) return "engine";
  return "gymnastic";
}

function patternsFor(keys: string[]): MovementPattern[] {
  const out: MovementPattern[] = [];
  for (const key of keys) {
    const pattern = patternOf(key);
    if (!out.includes(pattern)) out.push(pattern);
  }
  return out.length ? out : ["engine"];
}

function stimulusFor(keys: string[]): Stimulus {
  if (keys.some((key) => LOADED_KEYS.has(key))) return "heavy";
  if (keys.some((key) => key === "handstand" || key === "hspu" || key === "muscle_up" || key === "pistol")) return "technical";
  return "high_rep";
}

function stationFitsMinute(key: string, amount: string): boolean {
  const compact = amount.replace(/\s/g, "").toLowerCase();
  const meters = compact.match(/^(\d+)m/);
  if (meters && (key === "run" || key === "ski" || key === "row" || key === "ski_erg")) return Number(meters[1]) <= 200;
  const calories = compact.match(/^(\d+)cal/);
  if (calories) return Number(calories[1]) <= 12;
  const seconds = compact.match(/^(\d+)초/);
  if (seconds) return Number(seconds[1]) <= 40;
  const reps = compact.match(/^(\d+)$/);
  if (reps) return Number(reps[1]) <= 12;
  return !compact.includes("x");
}

function formatAllowed(piece: MetconPiece, format: WodFormat): boolean {
  if (format !== "emom") return true;
  return piece.movements.every((movement) => stationFitsMinute(movement.key, movement.amount));
}

function comboKey(keys: string[]): string {
  return [...keys].sort().join("+");
}

function workText(
  format: WodFormat,
  minutes: number,
  names: string,
  longPiece: boolean,
): { rep: string; rest: string } {
  if (longPiece) {
    return {
      rep: `3라운드. 캡 ${minutes}분. ${names}.`,
      rest: `라운드 사이 1분 휴식. ${minutes}분 안에 끝냅니다.`,
    };
  }
  if (format === "emom") {
    return {
      rep: `${minutes}분 EMOM. 1분마다 동작을 바꿉니다: ${names}.`,
      rest: `한 동작은 1분 안에 끝납니다. 캡 ${minutes}분.`,
    };
  }
  if (format === "intervals") {
    return {
      rep: `${minutes}분 인터벌. ${names}.`,
      rest: `일과 쉼이 나뉩니다. 캡 ${minutes}분.`,
    };
  }
  if (format === "for_time") {
    return {
      rep: `${minutes}분 캡. ${names}.`,
      rest: `끝나면 기록을 남깁니다. 캡 ${minutes}분.`,
    };
  }
  return {
    rep: `${minutes}분 AMRAP. ${names}.`,
    rest: `시간 안에 라운드를 반복합니다. 캡 ${minutes}분.`,
  };
}

function warmupText(day: DayKey, barbell: boolean, lift: MainLift | null): string {
  const label = DAY_KO[day];
  if (barbell) {
    const name = lift === "squat" ? "스쿼트" : lift === "deadlift" ? "데드리프트" : lift === "bench" ? "벤치" : lift === "ohp" ? "프레스" : "바벨";
    return `${label} 8–12분. 쉬운 로잉 2분, 인치웜 5, 팔 돌리기 10. ${name} 전에 빈 바로 맞춥니다.`;
  }
  return `${label} 8–12분. 쉬운 팬바이크 또는 로잉 2분, 인치웜 5, 팔 돌리기 10. 맨몸과 머신으로 엽니다.`;
}

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
      warmup_ko: warmup?.bodyKo || "8–12분. 쉬운 로잉과 맨몸으로 엽니다.",
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
const WEEKDAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri"];
const FORMATS: WodFormat[] = ["amrap", "for_time", "emom", "intervals"];
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

function strengthFor(
  lift: MainLift,
  scheme: Scheme,
  weekIndex: WeekIndex,
  highLower: boolean,
): NonNullable<SessionDraft["strength"]> {
  const sets =
    highLower && (lift === "squat" || lift === "deadlift") ? fatigueCutSets(scheme, weekIndex) : schemeSets(scheme, weekIndex);
  return { lift, sets };
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
  options: { format: WodFormat; minutes: number; benchmark: boolean; longPiece: boolean },
): ConditioningDraft {
  const keys = piece.movements.map((movement) => movement.key);
  const names = piece.movements.map((movement) => movement.nameKo).join(", ");
  const stimulus = options.longPiece ? "high_rep" : stimulusFor(keys);
  const text = workText(options.format, options.minutes, names, options.longPiece);
  return {
    benchmark: options.benchmark,
    format: options.format,
    time_domain: domain(options.minutes),
    stimulus,
    movement_patterns: patternsFor(keys),
    movements: piece.movements.map((movement) => ({
      key: movement.key,
      amount: movement.amount,
      name_ko: movement.nameKo,
    })),
    equipment: uniqueEquipment(keys),
    rep_structure: text.rep,
    work_rest_structure: text.rest,
    duration_min: options.minutes,
    volume: volumeFor(options.minutes),
    intensity: stimulus === "heavy" ? "heavy" : stimulus === "technical" ? "light" : "moderate",
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

function bannedKeys(
  day: DayKey,
  lifts: Map<DayKey, MainLift>,
  scheme: Scheme,
  weekIndex: WeekIndex,
  highLower: boolean,
): string[] {
  const previousDay = dayIndex(day) > 0 ? TRAINING[dayIndex(day) - 1] : undefined;
  const previous = previousDay ? lifts.get(previousDay) : undefined;
  if (!previous || !strengthIsHeavy(strengthFor(previous, scheme, weekIndex, highLower).sets)) return [];
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

function retuneStimulus(conditioning: ConditioningDraft, previous: Stimulus | null): ConditioningDraft {
  if (!conditioning.stimulus || conditioning.stimulus !== previous) return conditioning;
  const loaded = conditioning.movements.some((movement) => LOADED_KEYS.has(movement.key));
  const stimulus: Stimulus = loaded
    ? previous === "heavy"
      ? "high_rep"
      : "heavy"
    : previous === "technical"
      ? "high_rep"
      : "technical";
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
  usedCombos: Set<string>;
  seed: number;
}): ConditioningDraft {
  const material = listPieceMaterial("m");
  const benchmarkPiece = material.find((piece) => piece.id === "sl-month-benchmark");
  const longPieceRow = material.find((piece) => piece.id === "wed-long");
  if (input.benchmark && benchmarkPiece) {
    return pieceConditioning(benchmarkPiece, { format: "for_time", minutes: 20, benchmark: true, longPiece: false });
  }
  if (input.longPiece && longPieceRow) {
    return pieceConditioning(longPieceRow, { format: "for_time", minutes: 35, benchmark: false, longPiece: true });
  }
  const pool = material.filter((piece) => {
    if (!pieceAllowed(piece, input.bans, input.avoidLower)) return false;
    return !input.usedCombos.has(comboKey(piece.movements.map((movement) => movement.key)));
  });
  const priors = [...input.chosen, ...input.recent];
  let relaxed: ConditioningDraft | null = null;
  const span = Math.max(pool.length, 1) * FORMATS.length;
  for (let step = 0; step < span; step += 1) {
    const piece = pool[(input.seed + step) % Math.max(pool.length, 1)];
    if (!piece) break;
    const format = FORMATS[(input.seed + step) % FORMATS.length]!;
    if (!formatAllowed(piece, format)) continue;
    const candidate = pieceConditioning(piece, { format, minutes: input.minutes, benchmark: false, longPiece: false });
    if (candidate.stimulus === input.previousStimulus) continue;
    const structure = asStructure(candidate, input.day);
    if (!relaxed) relaxed = candidate;
    if (!priors.some((prior) => structurallySimilar(structure, prior))) return candidate;
  }
  if (relaxed) return retuneStimulus(relaxed, input.previousStimulus);
  const unused = material.find(
    (piece) =>
      piece.id !== "sl-month-benchmark" &&
      piece.id !== "wed-long" &&
      pieceAllowed(piece, input.bans, input.avoidLower) &&
      !input.usedCombos.has(comboKey(piece.movements.map((movement) => movement.key))),
  );
  const fallbackPiece =
    unused ?? pool[0] ?? material.find((piece) => piece.id !== "sl-month-benchmark" && piece.id !== "wed-long") ?? material[0]!;
  const format = FORMATS.find((item) => formatAllowed(fallbackPiece, item)) ?? "amrap";
  return retuneStimulus(
    pieceConditioning(fallbackPiece, { format, minutes: input.minutes, benchmark: false, longPiece: false }),
    input.previousStimulus,
  );
}

type FallbackCore = {
  day: DayKey;
  rest: boolean;
  optional: boolean;
  warmup_min: number;
  warmup_ko: string;
  strength: SessionDraft["strength"];
  conditioning: ConditioningDraft | null;
};

function flexibleCore(core: FallbackCore): boolean {
  return Boolean(core.conditioning && !core.conditioning.long_conditioning && !core.conditioning.benchmark);
}

function applyFormat(conditioning: ConditioningDraft, format: WodFormat): ConditioningDraft {
  const names = conditioning.movements.map((movement) => movement.name_ko).join(", ");
  const text = workText(format, conditioning.duration_min, names, conditioning.long_conditioning);
  return {
    ...conditioning,
    format,
    time_domain: domain(conditioning.duration_min),
    rep_structure: text.rep,
    work_rest_structure: text.rest,
  };
}

function separateStimuli(cores: FallbackCore[]): void {
  const training = cores.filter((core) => !core.rest && core.conditioning);
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (let index = 1; index < training.length; index += 1) {
      const previous = training[index - 1]!;
      const current = training[index]!;
      if (!previous.conditioning || !current.conditioning) continue;
      const left = previous.conditioning.stimulus;
      const right = current.conditioning.stimulus;
      if (!left || !right || left !== right) continue;
      const target = flexibleCore(current)
        ? current
        : flexibleCore(previous)
          ? previous
          : current.conditioning.long_conditioning
            ? previous
            : current;
      const neighbor = target === current ? previous : current;
      if (!target.conditioning || !neighbor.conditioning?.stimulus) continue;
      const tuned = retuneStimulus(target.conditioning, neighbor.conditioning.stimulus);
      if (tuned.stimulus !== target.conditioning.stimulus) {
        target.conditioning = tuned;
        changed = true;
      }
    }
    if (!changed) break;
  }
}

function repairSimilarity(cores: FallbackCore[], recent: readonly StoredStructure[]): void {
  const chosen: StoredStructure[] = [];
  for (const core of cores) {
    if (core.rest || !core.conditioning) continue;
    if (!flexibleCore(core)) {
      chosen.push(asStructure(core.conditioning, core.day));
      continue;
    }
    let current = core.conditioning;
    const priors = [...chosen, ...recent];
    const clashes = (draft: ConditioningDraft) =>
      priors.some((prior) => structurallySimilar(asStructure(draft, core.day), prior));
    if (clashes(current)) {
      for (const format of FORMATS) {
        if (format === current.format) continue;
        if (format === "emom" && !current.movements.every((movement) => stationFitsMinute(movement.key, movement.amount))) {
          continue;
        }
        const trial = applyFormat(current, format);
        if (!clashes(trial)) {
          current = trial;
          break;
        }
      }
    }
    core.conditioning = current;
    chosen.push(asStructure(current, core.day));
  }
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
  const shift = SCHEME_SHIFT[month.scheme];
  const lowerPool = highLower ? WEEKDAYS.filter((day) => day !== "mon" && day !== "tue") : WEEKDAYS;
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
  const open = WEEKDAYS.filter((day) => !lifts.has(day));
  const freeDay = open.find((day) => day !== "wed") ?? open[0]!;
  const upper: MainLift[] = (weekIndex + shift) % 2 === 0 ? ["ohp", "bench"] : ["bench", "ohp"];
  open
    .filter((day) => day !== freeDay)
    .slice(0, 2)
    .forEach((day, index) => lifts.set(day, upper[index]!));
  const longDay = month.long_conditioning_weeks.includes(weekIndex) ? freeDay : null;
  const benchmarkPool = WEEKDAYS.filter((day) => day !== longDay && !dayAfterLower.has(day) && day !== "thu");
  const benchmarkDay =
    month.benchmark_week === weekIndex
      ? (benchmarkPool[(weekIndex + shift) % Math.max(benchmarkPool.length, 1)] ??
        WEEKDAYS.find((day) => day !== longDay && day !== "thu") ??
        "fri")
      : null;

  const chosen: StoredStructure[] = [];
  const usedCombos = new Set<string>();
  let previousStimulus: Stimulus | null = null;
  const cores: FallbackCore[] = DAY_ORDER.map((day) => {
    if (day === "sun") {
      return { day, rest: true, optional: false, warmup_min: 0, warmup_ko: "", strength: null, conditioning: null };
    }
    const longPiece = day === longDay;
    const benchmark = day === benchmarkDay;
    const lift = day === "sat" || longPiece ? null : (lifts.get(day) ?? null);
    const minutes = longPiece
      ? 35
      : benchmark
        ? 20
        : dayAfterLower.has(day)
          ? 10
          : day === "sat"
            ? 12
            : 14 + ((dayIndex(day) + shift) % 3) * 2;
    const conditioning = pickConditioning({
      day,
      minutes,
      benchmark,
      longPiece,
      previousStimulus,
      bans: bannedKeys(day, lifts, month.scheme, weekIndex, highLower),
      avoidLower: highLower && (day === "mon" || day === "tue"),
      chosen,
      recent,
      usedCombos,
      seed: dayIndex(day) + weekIndex * 3 + shift,
    });
    usedCombos.add(comboKey(conditioning.movements.map((movement) => movement.key)));
    const structure = asStructure(conditioning, day);
    if (!structure.benchmark) chosen.push(structure);
    previousStimulus = conditioning.stimulus;
    const barbell =
      Boolean(lift) ||
      conditioning.equipment.includes("barbell") ||
      conditioning.movements.some((movement) => LOADED_KEYS.has(movement.key));
    return {
      day,
      rest: false,
      optional: day === "sat",
      warmup_min: 10,
      warmup_ko: warmupText(day, barbell, lift),
      strength: lift ? strengthFor(lift, month.scheme, weekIndex, highLower) : null,
      conditioning,
    };
  });
  separateStimuli(cores);
  repairSimilarity(cores, recent);
  const sessions = cores.map((core) =>
    fillSessionFields(core, core.strength ? lowerVolume(highLower, core.strength.lift, month.scheme) : null),
  );
  const schemeNote = highLower
    ? `${month.primary_block} 블록입니다. 지난주 하체 피로가 높아 스쿼트와 데드리프트 세트를 줄입니다.`
    : `${month.primary_block} 블록을 한 달 동안 유지합니다.`;
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
