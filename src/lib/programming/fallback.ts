import { buildWeek } from "../month-plan/build-week";
import { listPieceMaterial } from "../month-plan/pieces";
import type { DayKey, MainLift, MetconPiece, MetconStimulus, PlannedWeek, WeekIndex } from "../month-plan/types";
import { DAY_ORDER } from "../month-plan/types";
import { completeMonthDirection } from "./month-direction";
import {
  judgeWeek,
  monthAllowsSameLiftDays,
  previousLowerFatigue,
  structurallySimilar,
  weekdayPatternViolations,
  type WeekCheckContext,
} from "./rules";
import { schemeSets, strengthIsHeavy } from "./schemes";
import { exampleSets } from "./strength-methods";
import { fillSessionFields } from "./session-fields";
import { classMetconPurpose } from "../wod/purpose";
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
  const calories = compact.match(/^(\d+)(?:\/\d+)?cal/);
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
      rep: `${minutes}분 EMOM. 1분마다 동작을 바꿉니다: ${names}. 캡 ${minutes}분.`,
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

const CALORIE_KEYS = new Set(["row", "fan_bike", "bike", "assault_bike", "echo_bike", "ski", "ski_erg"]);

/** Male calories stay. Female calories are two lower. A bare "15cal" is not a class prescription. */
function pairedAmount(key: string, amount: string): string {
  if (!CALORIE_KEYS.has(key)) return amount;
  const compact = amount.replace(/\s+/g, "");
  if (/^\d+\/\d+cal$/i.test(compact)) return compact.toLowerCase();
  const one = compact.match(/^(\d+)cal$/i);
  if (!one) return amount;
  const male = Number(one[1]);
  return `${male}/${Math.max(1, male - 2)}cal`;
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
  let previousStimulus: Stimulus | null = null;
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
    const keys = day.piece.movements.map((movement) => movement.key);
    let stimulus: Stimulus = day.piece.stimulus ? STIMULUS_FROM_KO[day.piece.stimulus] : stimulusFor(keys);
    if (stimulus === previousStimulus) stimulus = stimulus === "high_rep" ? "technical" : "high_rep";
    previousStimulus = stimulus;
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
      purpose: classMetconPurpose({
        names: day.piece.movements.map((movement) => movement.nameKo),
        benchmark: day.piece.id === "sl-month-benchmark",
        longPiece: day.longPiece,
        format: day.piece.format,
        stimulus,
      }),
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
  return previousLowerFatigue(actual) === "high";
}

function strengthFor(
  lift: MainLift,
  month: MonthDirection,
  weekIndex: WeekIndex,
  highLower: boolean,
): NonNullable<SessionDraft["strength"]> {
  const method = month.strength_method || month.scheme;
  const fatigue = highLower && (lift === "squat" || lift === "deadlift") ? "high" : "unknown";
  const sets = exampleSets(method, weekIndex, fatigue, lift) ?? schemeSets(month.scheme, weekIndex);
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
      amount: pairedAmount(movement.key, movement.amount),
      name_ko: movement.nameKo,
    })),
    equipment: uniqueEquipment(keys),
    rep_structure: text.rep,
    work_rest_structure: text.rest,
    duration_min: options.minutes,
    volume: volumeFor(options.minutes),
    intensity: stimulus === "heavy" ? "heavy" : stimulus === "technical" ? "light" : "moderate",
    long_conditioning: options.longPiece,
    purpose: classMetconPurpose({
      names: piece.movements.map((movement) => movement.nameKo),
      benchmark: options.benchmark,
      longPiece: options.longPiece,
      format: options.format,
      stimulus,
    }),
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
  month: MonthDirection,
  weekIndex: WeekIndex,
  highLower: boolean,
): string[] {
  const previousDay = dayIndex(day) > 0 ? TRAINING[dayIndex(day) - 1] : undefined;
  const previous = previousDay ? lifts.get(previousDay) : undefined;
  if (!previous || !strengthIsHeavy(strengthFor(previous, month, weekIndex, highLower).sets)) return [];
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

function stubPiece(
  id: string,
  pattern: MetconPiece["pattern"],
  movements: Array<{ key: string; amount: string; nameKo: string }>,
): MetconPiece {
  return {
    id,
    named: false,
    nameKo: "폴백 재료",
    format: "amrap",
    minutes: 12,
    pattern,
    movements,
    signature: id,
    bodyKo: "폴백 재료",
    stimulus: null,
  };
}

const STIMULI: Stimulus[] = ["heavy", "high_rep", "technical"];

/**
 * Four structures per stimulus. Pattern sets and equipment sets differ so two of them
 * can share a time bucket when the format or the stimulus differs.
 */
const EXTRA_PIECES: MetconPiece[] = [
  stubPiece("fb-heavy-clean", "olympic", [
    { key: "power_clean", amount: "5", nameKo: "파워 클린" },
    { key: "push_up", amount: "8", nameKo: "푸시업" },
  ]),
  stubPiece("fb-heavy-hang", "olympic", [{ key: "hang_power_clean", amount: "5", nameKo: "행 파워 클린" }]),
  stubPiece("fb-heavy-thruster", "squat", [
    { key: "thruster", amount: "6", nameKo: "스러스터" },
    { key: "box_jump", amount: "8", nameKo: "박스 점프" },
  ]),
  stubPiece("fb-heavy-snatch", "olympic", [
    { key: "power_snatch", amount: "3", nameKo: "파워 스내치" },
    { key: "ring_row", amount: "6", nameKo: "링 로우" },
  ]),
  stubPiece("fb-heavy-clean-box", "olympic", [
    { key: "power_clean", amount: "3", nameKo: "파워 클린" },
    { key: "box_jump", amount: "6", nameKo: "박스 점프" },
  ]),
  stubPiece("fb-reps-row", "engine", [
    { key: "row", amount: "12/10cal", nameKo: "로잉" },
    { key: "burpee", amount: "8", nameKo: "버피" },
    { key: "push_up", amount: "8", nameKo: "푸시업" },
  ]),
  stubPiece("fb-reps-bike", "engine", [
    { key: "fan_bike", amount: "10cal", nameKo: "팬바이크" },
    { key: "ski", amount: "200m", nameKo: "스키" },
  ]),
  stubPiece("fb-reps-burpee", "gymnastic", [
    { key: "burpee", amount: "8", nameKo: "버피" },
    { key: "push_up", amount: "8", nameKo: "푸시업" },
    { key: "sit_up", amount: "12", nameKo: "싯업" },
  ]),
  stubPiece("fb-reps-ski", "engine", [
    { key: "ski", amount: "200m", nameKo: "스키" },
    { key: "push_up", amount: "8", nameKo: "푸시업" },
  ]),
  stubPiece("fb-skill-muscle", "gymnastic", [
    { key: "muscle_up", amount: "3", nameKo: "머슬업" },
    { key: "ring_row", amount: "6", nameKo: "링 로우" },
  ]),
  stubPiece("fb-skill-du", "engine", [
    { key: "double_under", amount: "30", nameKo: "더블언더" },
    { key: "handstand", amount: "20초", nameKo: "핸드스탠드 홀드" },
  ]),
  stubPiece("fb-skill-pistol", "squat", [
    { key: "pistol", amount: "5", nameKo: "피스톨" },
    { key: "kb_swing", amount: "8", nameKo: "케틀벨 스윙" },
  ]),
  stubPiece("fb-skill-box", "gymnastic", [
    { key: "muscle_up", amount: "2", nameKo: "머슬업" },
    { key: "box_jump", amount: "6", nameKo: "박스 점프" },
  ]),
  stubPiece("fb-skill-toes", "gymnastic", [
    { key: "ski", amount: "200m", nameKo: "스키" },
    { key: "toes_to_bar", amount: "6", nameKo: "토즈 투 바" },
    { key: "handstand", amount: "15초", nameKo: "핸드스탠드 홀드" },
  ]),
];

const LONG_EXTRA: MetconPiece = stubPiece("fb-long-row", "engine", [
  { key: "row", amount: "500m", nameKo: "로잉" },
  { key: "burpee", amount: "10", nameKo: "버피" },
  { key: "sit_up", amount: "12", nameKo: "싯업" },
]);

export function fallbackConditioningShapes(): Array<{ stimulus: Stimulus; keys: string }> {
  const catalog = listPieceMaterial("m").filter((piece) => piece.id !== "sl-month-benchmark" && piece.id !== "wed-long");
  return [...catalog, ...EXTRA_PIECES].map((piece) => ({
    stimulus: stimulusFor(piece.movements.map((movement) => movement.key)),
    keys: comboKey(piece.movements.map((movement) => movement.key)),
  }));
}

type DaySlot = {
  day: DayKey;
  lift: MainLift | null;
  role: "long" | "benchmark" | "short" | "open";
  bans: string[];
  avoidLower: boolean;
};

function pieceStimulus(piece: MetconPiece): Stimulus {
  return stimulusFor(piece.movements.map((movement) => movement.key));
}

function piecesForStimulus(stimulus: Stimulus): MetconPiece[] {
  return EXTRA_PIECES.filter((piece) => pieceStimulus(piece) === stimulus);
}

function longPieces(): MetconPiece[] {
  const catalog = listPieceMaterial("m").find((piece) => piece.id === "wed-long");
  return catalog ? [catalog, LONG_EXTRA] : [LONG_EXTRA];
}

function preferredFormat(weekIndex: WeekIndex, short: boolean): WodFormat {
  return FORMATS[(weekIndex - 1 + (short ? 0 : 1)) % FORMATS.length]!;
}

function preferredPiece(stimulus: Stimulus, weekIndex: WeekIndex, short: boolean): MetconPiece {
  const pieces = piecesForStimulus(stimulus);
  return pieces[(weekIndex - 1 + (short ? 0 : 2)) % pieces.length]!;
}

function draftOptions(slot: DaySlot, weekIndex: WeekIndex, shift: number): ConditioningDraft[] {
  const material = listPieceMaterial("m");
  if (slot.role === "benchmark") {
    const benchmark = material.find((piece) => piece.id === "sl-month-benchmark");
    if (!benchmark) return [];
    return [pieceConditioning(benchmark, { format: "for_time", minutes: 20, benchmark: true, longPiece: false })];
  }
  const ordinal = dayIndex(slot.day);
  const short = slot.role === "short";
  const preferredStimulus = STIMULI[(ordinal + shift + weekIndex) % STIMULI.length]!;
  const stimuli = [preferredStimulus, ...STIMULI.filter((stimulus) => stimulus !== preferredStimulus)];
  const minutes = slot.role === "long" ? [35] : slot.role === "short" ? [10, 12] : [16, 14, 18, 12];
  const formatStart = slot.role === "long" ? (weekIndex % 4 === 2 ? "for_time" : "intervals") : preferredFormat(weekIndex, short);
  const formats = [formatStart, ...FORMATS.filter((format) => format !== formatStart)];
  const pool = slot.role === "long" ? longPieces() : EXTRA_PIECES;
  const preferred =
    slot.role === "long"
      ? pool[Math.floor(weekIndex / 2) % pool.length]!
      : preferredPiece(preferredStimulus, weekIndex, short);
  const ordered = [preferred, ...pool.filter((piece) => piece.id !== preferred.id)];
  const drafts: ConditioningDraft[] = [];
  const seen = new Set<string>();
  const push = (piece: MetconPiece, format: WodFormat, minute: number) => {
    if (slot.role !== "long" && slot.role !== "benchmark" && !pieceAllowed(piece, slot.bans, slot.avoidLower)) return;
    if (!formatAllowed(piece, format)) return;
    const id = `${piece.id}|${format}|${minute}`;
    if (seen.has(id)) return;
    seen.add(id);
    drafts.push(
      pieceConditioning(piece, {
        format,
        minutes: minute,
        benchmark: false,
        longPiece: slot.role === "long",
      }),
    );
  };
  for (const stimulus of stimuli) {
    for (const piece of ordered) {
      if (slot.role !== "long" && pieceStimulus(piece) !== stimulus) continue;
      for (const format of formats) {
        for (const minute of minutes) push(piece, format, minute);
      }
    }
  }
  return drafts;
}

function exposureOf(
  lift: MainLift | null,
  draft: ConditioningDraft | null,
  month: MonthDirection,
  weekIndex: WeekIndex,
  highLower: boolean,
): { heavySquat: boolean; heavyDeadlift: boolean; heavyPress: boolean; heavySnatch: boolean; heavyClean: boolean } {
  const strengthHeavy = lift != null && strengthIsHeavy(strengthFor(lift, month, weekIndex, highLower).sets);
  const keys = draft?.movements.map((movement) => movement.key) ?? [];
  const metconHeavy = Boolean(draft && (draft.stimulus === "heavy" || draft.intensity === "heavy"));
  const has = (group: string[]) => keys.some((key) => group.includes(key));
  return {
    heavySquat: strengthHeavy && lift === "squat",
    heavyDeadlift: (strengthHeavy && lift === "deadlift") || (metconHeavy && has(["deadlift"])),
    heavyPress: strengthHeavy && (lift === "ohp" || lift === "bench"),
    heavySnatch: metconHeavy && has(["snatch", "power_snatch"]),
    heavyClean: metconHeavy && has(["clean", "power_clean", "hang_power_clean"]),
  };
}

function breaksChain(
  today: ReturnType<typeof exposureOf>,
  next: ReturnType<typeof exposureOf>,
): boolean {
  if (today.heavySquat && (next.heavySnatch || next.heavyClean || next.heavyDeadlift)) return true;
  if (today.heavyDeadlift && next.heavySquat) return true;
  if (today.heavyPress && next.heavySnatch) return true;
  return false;
}

type SyntheticRecipe = {
  stimulus: Stimulus;
  movements: Array<{ key: string; amount: string; nameKo: string }>;
};

/** Distinct pattern and equipment sets. Used only when the catalog search cannot fill the week. */
const SYNTHETIC_RECIPES: SyntheticRecipe[] = [
  { stimulus: "high_rep", movements: [{ key: "row", amount: "12/10cal", nameKo: "로잉" }, { key: "burpee", amount: "8", nameKo: "버피" }] },
  { stimulus: "high_rep", movements: [{ key: "fan_bike", amount: "10/8cal", nameKo: "팬바이크" }, { key: "push_up", amount: "10", nameKo: "푸시업" }] },
  { stimulus: "high_rep", movements: [{ key: "ski", amount: "200m", nameKo: "스키" }, { key: "sit_up", amount: "12", nameKo: "싯업" }] },
  { stimulus: "high_rep", movements: [{ key: "double_under", amount: "30", nameKo: "더블언더" }, { key: "push_up", amount: "8", nameKo: "푸시업" }] },
  { stimulus: "high_rep", movements: [{ key: "run", amount: "200m", nameKo: "런" }, { key: "burpee", amount: "6", nameKo: "버피" }] },
  { stimulus: "high_rep", movements: [{ key: "row", amount: "10/8cal", nameKo: "로잉" }, { key: "push_up", amount: "6", nameKo: "푸시업" }, { key: "sit_up", amount: "10", nameKo: "싯업" }] },
  { stimulus: "technical", movements: [{ key: "handstand", amount: "20초", nameKo: "핸드스탠드 홀드" }, { key: "ring_row", amount: "8", nameKo: "링 로우" }] },
  { stimulus: "technical", movements: [{ key: "muscle_up", amount: "2", nameKo: "머슬업" }, { key: "push_up", amount: "6", nameKo: "푸시업" }] },
  { stimulus: "technical", movements: [{ key: "double_under", amount: "20", nameKo: "더블언더" }, { key: "handstand", amount: "15초", nameKo: "핸드스탠드 홀드" }] },
  { stimulus: "technical", movements: [{ key: "ski", amount: "150m", nameKo: "스키" }, { key: "toes_to_bar", amount: "6", nameKo: "토즈 투 바" }, { key: "handstand", amount: "10초", nameKo: "핸드스탠드 홀드" }] },
  { stimulus: "technical", movements: [{ key: "hspu", amount: "3", nameKo: "핸드스탠드 푸시업" }, { key: "row", amount: "8/6cal", nameKo: "로잉" }] },
  { stimulus: "technical", movements: [{ key: "muscle_up", amount: "2", nameKo: "머슬업" }, { key: "fan_bike", amount: "8/6cal", nameKo: "팬바이크" }] },
  { stimulus: "heavy", movements: [{ key: "power_clean", amount: "3", nameKo: "파워 클린" }, { key: "push_up", amount: "6", nameKo: "푸시업" }] },
  { stimulus: "heavy", movements: [{ key: "hang_power_clean", amount: "3", nameKo: "행 파워 클린" }, { key: "ring_row", amount: "6", nameKo: "링 로우" }] },
  { stimulus: "heavy", movements: [{ key: "power_snatch", amount: "3", nameKo: "파워 스내치" }, { key: "push_up", amount: "6", nameKo: "푸시업" }] },
  { stimulus: "heavy", movements: [{ key: "power_clean", amount: "3", nameKo: "파워 클린" }, { key: "box_jump", amount: "6", nameKo: "박스 점프" }] },
];

function recipeFormatAllowed(recipe: SyntheticRecipe, format: WodFormat): boolean {
  if (format !== "emom") return true;
  return recipe.movements.every((movement) => stationFitsMinute(movement.key, movement.amount));
}

function recipeBlocked(recipe: SyntheticRecipe, slot: DaySlot): boolean {
  const patterns = patternsFor(recipe.movements.map((movement) => movement.key));
  if (slot.avoidLower && patterns.some((pattern) => pattern === "squat" || pattern === "hinge")) return true;
  return recipe.movements.some((movement) => slot.bans.includes(movement.key));
}

function syntheticDraft(
  recipe: SyntheticRecipe,
  options: { format: WodFormat; minutes: number; volume: VolumeBand; longPiece: boolean },
): ConditioningDraft {
  const keys = recipe.movements.map((movement) => movement.key);
  const names = recipe.movements.map((movement) => movement.nameKo).join(", ");
  const text = workText(options.format, options.minutes, names, options.longPiece);
  return {
    benchmark: false,
    format: options.format,
    time_domain: domain(options.minutes),
    stimulus: recipe.stimulus,
    movement_patterns: patternsFor(keys),
    movements: recipe.movements.map((movement) => ({
      key: movement.key,
      amount: pairedAmount(movement.key, movement.amount),
      name_ko: movement.nameKo,
    })),
    equipment: uniqueEquipment(keys),
    rep_structure: text.rep,
    work_rest_structure: text.rest,
    duration_min: options.minutes,
    volume: options.volume,
    intensity: recipe.stimulus === "heavy" ? "heavy" : recipe.stimulus === "technical" ? "light" : "moderate",
    long_conditioning: options.longPiece,
  };
}

function minutesForRole(slot: DaySlot): number[] {
  if (slot.role === "long") return [35, 32, 38];
  if (slot.role === "short") return [10, 12, 8, 14, 16];
  return [16, 14, 18, 12, 10];
}

function stimulusOrder(recovery: boolean): Stimulus[] {
  return recovery ? ["high_rep", "technical", "heavy"] : ["technical", "high_rep", "heavy"];
}

/**
 * Last path when the catalog cannot fill every training day.
 * Still has to pass judgeWeek: legal stimulus, duration, no same-week conflict, not too similar.
 */
function assignGuaranteedConditioning(
  slots: DaySlot[],
  weekIndex: WeekIndex,
  month: MonthDirection,
  highLower: boolean,
  lifts: Map<DayKey, MainLift>,
  recent: readonly StoredStructure[],
): Map<DayKey, ConditioningDraft> {
  const recovery = month.strength_method === "DELOAD_RECOVERY" || month.scheme === "deload";
  const assigned = new Map<DayKey, ConditioningDraft>();
  const chosen: StoredStructure[] = [];
  const usedCombos = new Set<string>();
  const optionCache = new Map<string, ConditioningDraft[]>();
  let nodes = 0;

  const optionsFor = (slot: DaySlot, previousStimulus: Stimulus | null): ConditioningDraft[] => {
    const cacheKey = `${slot.day}|${previousStimulus ?? "-"}`;
    const cached = optionCache.get(cacheKey);
    if (cached) return cached;
    if (slot.role === "benchmark") {
      const benchmark = draftOptions(slot, weekIndex, 0).slice(0, 1);
      optionCache.set(cacheKey, benchmark);
      return benchmark;
    }
    const nextDay = slots[slots.findIndex((row) => row.day === slot.day) + 1];
    const nextLocked = nextDay && (nextDay.role === "long" || nextDay.role === "benchmark") ? "high_rep" : null;
    const formats: WodFormat[] = ["amrap", "for_time", "intervals", "emom"];
    const out: ConditioningDraft[] = [];
    for (const stimulus of stimulusOrder(recovery)) {
      if (stimulus === previousStimulus || stimulus === nextLocked) continue;
      let added = 0;
      for (const volume of ["low", "moderate", "high"] as VolumeBand[]) {
        for (const format of formats) {
          for (const minutes of minutesForRole(slot)) {
            const longPiece = slot.role === "long" && minutes >= 30;
            if (slot.role === "long" && !longPiece) continue;
            if (slot.role === "short" && minutes > 12 && added > 0) continue;
            for (const recipe of SYNTHETIC_RECIPES) {
              if (recipe.stimulus !== stimulus || recipeBlocked(recipe, slot) || !recipeFormatAllowed(recipe, format)) continue;
              const draft = syntheticDraft(recipe, { format, minutes, volume, longPiece });
              if (recent.some((prior) => structurallySimilar(asStructure(draft, slot.day), prior))) continue;
              out.push(draft);
              added += 1;
              if (added >= 8) break;
            }
            if (added >= 8) break;
          }
          if (added >= 8) break;
        }
        if (added >= 8) break;
      }
    }
    optionCache.set(cacheKey, out);
    return out;
  };

  const visit = (index: number, previousStimulus: Stimulus | null): boolean => {
    if (index >= slots.length) return true;
    if (nodes++ > 4000) return false;
    const slot = slots[index]!;
    const priors = [...chosen, ...recent];
    const nextDay = slots[index + 1];
    for (const draft of optionsFor(slot, previousStimulus)) {
      if (draft.stimulus && draft.stimulus === previousStimulus) continue;
      const combo = comboKey(draft.movements.map((movement) => movement.key));
      if (usedCombos.has(combo)) continue;
      if (!draft.benchmark && priors.some((prior) => structurallySimilar(asStructure(draft, slot.day), prior))) continue;
      const today = exposureOf(slot.lift, draft, month, weekIndex, highLower);
      const previousDay = index > 0 ? slots[index - 1] : undefined;
      if (previousDay) {
        const previous = exposureOf(previousDay.lift, assigned.get(previousDay.day) ?? null, month, weekIndex, highLower);
        if (breaksChain(previous, today)) continue;
      }
      if (nextDay) {
        const nextLift = lifts.get(nextDay.day) ?? null;
        if (breaksChain(today, exposureOf(nextLift, null, month, weekIndex, highLower))) continue;
        if ((today.heavySquat || today.heavyDeadlift) && nextDay.role === "long") continue;
        if (draft.stimulus === "high_rep" && (nextDay.role === "long" || nextDay.role === "benchmark")) continue;
      }
      assigned.set(slot.day, draft);
      usedCombos.add(combo);
      if (!draft.benchmark) chosen.push(asStructure(draft, slot.day));
      if (visit(index + 1, draft.stimulus)) return true;
      assigned.delete(slot.day);
      usedCombos.delete(combo);
      if (!draft.benchmark) chosen.pop();
    }
    return false;
  };

  if (!visit(0, null)) throw new Error("no legal fallback conditioning");
  return assigned;
}

function assignConditioning(
  slots: DaySlot[],
  weekIndex: WeekIndex,
  shift: number,
  month: MonthDirection,
  highLower: boolean,
  lifts: Map<DayKey, MainLift>,
  recent: readonly StoredStructure[],
): Map<DayKey, ConditioningDraft> {
  const chosen: StoredStructure[] = [];
  const usedCombos = new Set<string>();
  const assigned = new Map<DayKey, ConditioningDraft>();

  const visit = (index: number, previousStimulus: Stimulus | null): boolean => {
    if (index >= slots.length) return true;
    const slot = slots[index]!;
    const priors = [...chosen, ...recent];
    const nextDay = slots[index + 1];
    const nextLocked = nextDay && (nextDay.role === "long" || nextDay.role === "benchmark") ? "high_rep" : null;
    const kept: ConditioningDraft[] = [];
    const seenCombos = new Set<string>();
    for (const draft of draftOptions(slot, weekIndex, shift)) {
      if (draft.stimulus && (draft.stimulus === previousStimulus || draft.stimulus === nextLocked)) continue;
      const combo = comboKey(draft.movements.map((movement) => movement.key));
      if (usedCombos.has(combo) || seenCombos.has(combo)) continue;
      if (!draft.benchmark && priors.some((prior) => structurallySimilar(asStructure(draft, slot.day), prior))) continue;
      const today = exposureOf(slot.lift, draft, month, weekIndex, highLower);
      const previousDay = index > 0 ? slots[index - 1] : undefined;
      if (previousDay) {
        const previous = exposureOf(previousDay.lift, assigned.get(previousDay.day) ?? null, month, weekIndex, highLower);
        if (breaksChain(previous, today)) continue;
      }
      if (nextDay) {
        const nextLift = lifts.get(nextDay.day) ?? null;
        if (breaksChain(today, exposureOf(nextLift, null, month, weekIndex, highLower))) continue;
        if ((today.heavySquat || today.heavyDeadlift) && nextDay.role === "long") continue;
      }
      seenCombos.add(combo);
      kept.push(draft);
      if (kept.length === 8) break;
    }
    for (const draft of kept) {
      const combo = comboKey(draft.movements.map((movement) => movement.key));
      assigned.set(slot.day, draft);
      usedCombos.add(combo);
      if (!draft.benchmark) chosen.push(asStructure(draft, slot.day));
      if (visit(index + 1, draft.stimulus)) return true;
      assigned.delete(slot.day);
      usedCombos.delete(combo);
      if (!draft.benchmark) chosen.pop();
    }
    return false;
  };

  if (visit(0, null)) return assigned;
  return assignGuaranteedConditioning(slots, weekIndex, month, highLower, lifts, recent);
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


export function buildFallbackWeek(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  intent: ProgrammingIntent;
  recent?: readonly StoredStructure[];
  previousActual?: WeekActual | null;
  recentLiftMaps?: readonly string[];
}): WeekDraft {
  const allow = monthAllowsSameLiftDays(input.month);
  const maps = input.recentLiftMaps ?? [];
  let lastError: Error | null = null;
  let last: WeekDraft | null = null;
  for (let placement = 0; placement < 6; placement += 1) {
    try {
      const draft = assembleFallbackWeek(input, placement);
      if (!weekdayPatternViolations(draft, maps, allow).length) return draft;
      last = draft;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  if (last) return last;
  throw lastError ?? new Error("no legal fallback week");
}

function assembleFallbackWeek(
  input: {
    month: MonthDirection;
    weekIndex: WeekIndex;
    intent: ProgrammingIntent;
    recent?: readonly StoredStructure[];
    previousActual?: WeekActual | null;
  },
  placement: number,
): WeekDraft {
  const month = input.month;
  const weekIndex = input.weekIndex;
  const recent = input.recent ?? [];
  const highLower = highLowerFatigue(input.previousActual);
  const shift = SCHEME_SHIFT[month.scheme];
  const lowerPool = highLower ? WEEKDAYS.filter((day) => day !== "mon" && day !== "tue") : WEEKDAYS;
  const pairs = lowerPairs(lowerPool);
  const pair = pairs[(weekIndex - 1 + shift + 5 + placement) % pairs.length]!;
  const lowerLifts: MainLift[] = (weekIndex + shift + placement) % 2 === 0 ? ["squat", "deadlift"] : ["deadlift", "squat"];
  const method = month.strength_method || month.scheme;
  const cut = exampleSets(method, weekIndex, "high", "squat");
  const oneLower = highLower && cut != null && strengthIsHeavy(cut);
  const lifts = new Map<DayKey, MainLift>();
  if (oneLower) lifts.set(pair[1]!, lowerLifts[0]!);
  else {
    lifts.set(pair[0]!, lowerLifts[0]!);
    lifts.set(pair[1]!, lowerLifts[1]!);
  }
  const lowerDays = new Set(lifts.keys());
  const afterHeavy = new Set<DayKey>();
  for (const [day, lift] of lifts) {
    if (lift !== "squat" && lift !== "deadlift") continue;
    if (!strengthIsHeavy(strengthFor(lift, month, weekIndex, highLower).sets)) continue;
    const next = TRAINING[dayIndex(day) + 1];
    if (next) afterHeavy.add(next);
  }
  const dayAfterLower = new Set(
    [...lowerDays].map((day) => TRAINING[dayIndex(day) + 1]).filter((day): day is DayKey => day != null),
  );
  const open = WEEKDAYS.filter((day) => !lifts.has(day));
  const longBlocked = new Set<DayKey>(["wed"]);
  if (month.benchmark_week === weekIndex) longBlocked.add("sat");
  const longCandidates = TRAINING.filter((day) => !lifts.has(day) && !longBlocked.has(day));
  const freeDay =
    longCandidates.find((day) => !afterHeavy.has(day)) ??
    longCandidates[0] ??
    open.find((day) => day !== "wed") ??
    "fri";
  const upper: MainLift[] = (weekIndex + shift) % 2 === 0 ? ["ohp", "bench"] : ["bench", "ohp"];
  open
    .filter((day) => day !== freeDay)
    .slice(0, 2)
    .forEach((day, index) => lifts.set(day, upper[index]!));
  const longDay = month.long_conditioning_weeks.includes(weekIndex) ? freeDay : null;
  const benchmarkDay = month.benchmark_week === weekIndex && longDay !== "sat" ? "sat" : null;

  const slots: DaySlot[] = TRAINING.map((day) => {
    const longPiece = day === longDay;
    const benchmark = day === benchmarkDay;
    const lift = day === "sat" || longPiece ? null : (lifts.get(day) ?? null);
    const role = longPiece ? "long" : benchmark ? "benchmark" : dayAfterLower.has(day) ? "short" : "open";
    return {
      day,
      lift,
      role,
      bans: bannedKeys(day, lifts, month, weekIndex, highLower),
      avoidLower: highLower,
    };
  });
  const conditioningByDay = assignConditioning(slots, weekIndex, shift, month, highLower, lifts, recent);
  const cores: FallbackCore[] = DAY_ORDER.map((day) => {
    if (day === "sun") {
      return { day, rest: true, optional: false, warmup_min: 0, warmup_ko: "", strength: null, conditioning: null };
    }
    const slot = slots.find((row) => row.day === day);
    const conditioning = conditioningByDay.get(day) ?? null;
    const lift = slot?.lift ?? null;
    const barbell =
      Boolean(lift) ||
      Boolean(conditioning?.equipment.includes("barbell")) ||
      Boolean(conditioning?.movements.some((movement) => LOADED_KEYS.has(movement.key)));
    return {
      day,
      rest: false,
      optional: day === "sat",
      warmup_min: 10,
      warmup_ko: warmupText(day, barbell, lift),
      strength: lift ? strengthFor(lift, month, weekIndex, highLower) : null,
      conditioning,
    };
  });
  for (const core of cores) {
    if (core.rest || !core.conditioning) continue;
    const barbell =
      Boolean(core.strength) ||
      core.conditioning.equipment.includes("barbell") ||
      core.conditioning.movements.some((movement) => LOADED_KEYS.has(movement.key));
    core.warmup_ko = warmupText(core.day, barbell, core.strength?.lift ?? null);
  }
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

function methodLabel(month: MonthDirection): string {
  const method = month.strength_method || month.scheme;
  if (method === "531") return "5/3/1";
  if (method === "ACCUMULATION" || method === "volume") return "축적";
  if (method === "INTENSITY_BLOCK" || method === "intensity") return "강도";
  if (method === "DELOAD_RECOVERY" || method === "deload") return "회복";
  if (method === "TECHNIQUE_SKILL" || method === "skill") return "기술";
  return "이번 방법";
}

export function fallbackIntent(month: MonthDirection, weekIndex: WeekIndex, _reason: string): ProgrammingIntent {
  const label = methodLabel(month);
  return {
    why_ko: `${label} 블록 ${weekIndex}주입니다. 모델 응답을 쓰지 않고 이 달의 방식으로 채웁니다.`,
    focus: month.focus_ko,
    scheme_note: `${label}는 이번 달 전체의 선택입니다. 주마다 방식을 바꾸지 않습니다.`,
  };
}

export function fallbackMonth(
  prior: { summary_ko: string; next_scheme: MonthDirection["scheme"]; strength_method?: string } | null,
): MonthDirection {
  const scheme = prior?.next_scheme ?? "deload";
  const strengthMethod = prior?.strength_method ?? (prior ? prior.next_scheme : "DELOAD_RECOVERY");
  return completeMonthDirection({
    scheme,
    strength_method: strengthMethod,
    focus_ko: prior ? "지난 달 평가가 고른 한 달" : "월 계획이 없어 회복 범위로 엽니다",
    why_ko: prior?.summary_ko || "이전 월 평가가 없습니다. 5/3/1로 바꾸지 않고 회복 범위만 사용합니다.",
    primary_block: scheme === "531" ? "531" : methodLabel({ scheme, strength_method: strengthMethod } as MonthDirection),
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

export function assertFallbackLegal(
  draft: WeekDraft,
  month: MonthDirection,
  weekIndex: WeekIndex,
  context: WeekCheckContext & { recent?: readonly StoredStructure[] } = {},
): void {
  const judged = judgeWeek(draft, month, weekIndex, context.recent ?? [], context);
  if (!judged.ok) throw new Error(`fallback broke a rule: ${judged.detail}`);
}
