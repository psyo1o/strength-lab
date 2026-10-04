import { buildWeek } from "../month-plan/build-week";
import type { DayKey, MainLift, MetconStimulus, PlannedWeek, WeekIndex } from "../month-plan/types";
import { DAY_ORDER } from "../month-plan/types";
import { constitutionViolations } from "./rules";
import { schemeSets } from "./schemes";
import {
  type ConditioningDraft,
  type Equipment,
  type MonthDirection,
  type MovementPattern,
  type ProgrammingIntent,
  type Scheme,
  type SessionDraft,
  type Stimulus,
  type TimeDomain,
  type VolumeBand,
  type WeekDraft,
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
      return {
        day: day.day,
        rest: true,
        optional: false,
        warmup_min: 0,
        warmup_ko: "",
        strength: null,
        conditioning: null,
      };
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
    return {
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
    };
  });
  return { intent, sessions };
}

type Recipe = {
  format: ConditioningDraft["format"];
  minutes: number;
  stimulus: Stimulus;
  patterns: MovementPattern[];
  equipment: Equipment[];
  movements: ConditioningDraft["movements"];
  volume: VolumeBand;
};

const RECIPES: Record<DayKey, Recipe> = {
  mon: {
    format: "emom",
    minutes: 10,
    stimulus: "high_rep",
    patterns: ["press"],
    equipment: ["jump_rope"],
    movements: [{ key: "double_under", amount: "40", name_ko: "더블언더" }],
    volume: "low",
  },
  tue: {
    format: "amrap",
    minutes: 12,
    stimulus: "technical",
    patterns: ["squat"],
    equipment: ["bodyweight"],
    movements: [{ key: "air_squat", amount: "15", name_ko: "에어 스쿼트" }],
    volume: "low",
  },
  wed: {
    format: "intervals",
    minutes: 20,
    stimulus: "heavy",
    patterns: ["engine"],
    equipment: ["bike", "ski"],
    movements: [
      { key: "fan_bike", amount: "12cal", name_ko: "팬바이크" },
      { key: "ski", amount: "250m", name_ko: "스키" },
    ],
    volume: "moderate",
  },
  thu: {
    format: "amrap",
    minutes: 8,
    stimulus: "high_rep",
    patterns: ["gymnastic"],
    equipment: ["rings"],
    movements: [{ key: "ring_row", amount: "8", name_ko: "링 로우" }],
    volume: "low",
  },
  fri: {
    format: "emom",
    minutes: 16,
    stimulus: "technical",
    patterns: ["hinge"],
    equipment: ["rower"],
    movements: [{ key: "row", amount: "250m", name_ko: "로잉" }],
    volume: "moderate",
  },
  sat: {
    format: "intervals",
    minutes: 12,
    stimulus: "heavy",
    patterns: ["gymnastic"],
    equipment: ["box"],
    movements: [{ key: "box_jump", amount: "12", name_ko: "박스 점프" }],
    volume: "low",
  },
  sun: {
    format: "amrap",
    minutes: 8,
    stimulus: "technical",
    patterns: ["engine"],
    equipment: ["bodyweight"],
    movements: [{ key: "run", amount: "400m", name_ko: "런" }],
    volume: "low",
  },
};

const LONG_WEEK: Recipe = {
  format: "for_time",
  minutes: 35,
  stimulus: "heavy",
  patterns: ["engine"],
  equipment: ["bike", "ski", "rower"],
  movements: [
    { key: "run", amount: "1600m", name_ko: "런" },
    { key: "fan_bike", amount: "15cal", name_ko: "팬바이크" },
    { key: "ski", amount: "400m", name_ko: "스키" },
  ],
  volume: "high",
};

const BENCHMARK: Recipe = {
  format: "for_time",
  minutes: 20,
  stimulus: "high_rep",
  patterns: ["engine"],
  equipment: ["wall_ball", "bodyweight"],
  movements: [
    { key: "run", amount: "400m", name_ko: "런" },
    { key: "wall_ball", amount: "15", name_ko: "월볼" },
    { key: "burpee", amount: "10", name_ko: "버피" },
  ],
  volume: "moderate",
};

function recipeToConditioning(recipe: Recipe, benchmark: boolean, longPiece: boolean): ConditioningDraft {
  return {
    benchmark,
    format: recipe.format,
    time_domain: domain(recipe.minutes),
    stimulus: recipe.stimulus,
    movement_patterns: recipe.patterns,
    movements: recipe.movements.map((movement) => ({ ...movement })),
    equipment: [...recipe.equipment],
    rep_structure: `${recipe.minutes}분 ${recipe.format}`,
    work_rest_structure: recipe.format === "intervals" || recipe.format === "emom" ? "일과 쉼이 나뉩니다" : "쉬지 않고 반복",
    duration_min: recipe.minutes,
    volume: recipe.volume,
    intensity: recipe.stimulus === "heavy" ? "heavy" : recipe.stimulus === "technical" ? "light" : "moderate",
    long_conditioning: longPiece,
  };
}

function strengthFor(lift: MainLift, scheme: Scheme, weekIndex: WeekIndex): SessionDraft["strength"] {
  return { lift, sets: schemeSets(scheme, weekIndex) };
}

/** Stable inside one scheme. 5/3/1 is not the calendar for the other four. */
function liftsFor(scheme: Scheme): Partial<Record<DayKey, MainLift>> {
  if (scheme === "531" || scheme === "intensity") {
    return { mon: "squat", tue: "ohp", thu: "bench", fri: "deadlift" };
  }
  return { mon: "ohp", tue: "squat", thu: "deadlift", fri: "bench" };
}

export function draftForScheme(month: MonthDirection, weekIndex: WeekIndex, intent: ProgrammingIntent): WeekDraft {
  const lifts = liftsFor(month.scheme);
  const longDay: DayKey = "wed";
  const benchmarkDay: DayKey = "thu";
  const sessions: SessionDraft[] = DAY_ORDER.map((day) => {
    if (day === "sun") {
      return {
        day,
        rest: true,
        optional: false,
        warmup_min: 0,
        warmup_ko: "",
        strength: null,
        conditioning: null,
      };
    }
    const longPiece = month.long_conditioning_weeks.includes(weekIndex) && day === longDay;
    const benchmark = month.benchmark_week === weekIndex && day === benchmarkDay;
    const recipe = benchmark ? BENCHMARK : longPiece ? LONG_WEEK : RECIPES[day];
    const lift = lifts[day];
    return {
      day,
      rest: false,
      optional: day === "sat",
      warmup_min: 10,
      warmup_ko: WARMUP_KO,
      strength: lift ? strengthFor(lift, month.scheme, weekIndex) : null,
      conditioning: recipeToConditioning(recipe, benchmark, longPiece),
    };
  });
  return { intent, sessions };
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
  return {
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
  };
}

export function assertFallbackLegal(draft: WeekDraft, month: MonthDirection, weekIndex: WeekIndex): void {
  const errors = constitutionViolations(draft, month, weekIndex);
  if (errors.length) throw new Error(`fallback broke a rule: ${errors[0]}`);
}
