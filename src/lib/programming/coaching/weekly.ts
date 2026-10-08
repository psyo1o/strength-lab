import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
import { monthEmphasis, performanceRead } from "../weekly-intent";
import type { WeekActual } from "../summary";
import type {
  BlockPhase,
  DayIntent,
  DurationProfile,
  MonthDirection,
  MovementPattern,
  PrimaryTraining,
  SecondaryTraining,
  StrengthLiftChoice,
  VolumeBand,
  WeekIndex,
  WeeklyIntentPlan,
  CoachingStimulus,
} from "../types";
import { deterministicMonthlyPlan } from "./monthly";

const DAY_KO: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

type Slot = {
  primary: PrimaryTraining;
  secondary: SecondaryTraining;
  stimulus: CoachingStimulus;
  pattern: DayIntent["movement_pattern"];
  lift: StrengthLiftChoice;
  volume: VolumeBand;
  intensity: DayIntent["intensity_profile"];
  fatigue: DayIntent["fatigue_target"];
  recovery: DayIntent["recovery_role"];
  progression: boolean;
  duration: DurationProfile;
  benchmark: boolean;
};

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

function slot(input: Slot): Slot {
  return input;
}

/**
 * Seven day purposes. Lifts move with the week index.
 * duration_profile is the class window. The session coach chooses the piece clock later.
 */
export function planCoachedWeek(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentSignatures?: readonly string[];
}): WeeklyIntentPlan {
  const month = input.month.coaching_plan ? input.month : { ...input.month, coaching_plan: deterministicMonthlyPlan(input.month, input.previousActual) };
  const read = performanceRead(input.previousActual);
  const fatigued = read.lower_fatigue === "high";
  const missed = read.many_missed;
  const succeeded = read.strength_succeeded && !fatigued && !missed;
  const phase = phaseFor(month, input.weekIndex, fatigued);
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
  const wantsLong = month.long_conditioning_weeks.includes(input.weekIndex);
  const longDay = wantsLong ? longDayFor(training, [...lowers.keys()], heavy) : null;
  const upperLifts: MainLift[] = shift % 2 === 0 ? ["bench", "ohp"] : ["ohp", "bench"];
  const uppers = new Map<DayKey, MainLift>();
  const upperHosts = liftHosts.filter((day) => !lowers.has(day) && day !== longDay);
  upperHosts.slice(0, phase === "deload" ? 1 : 2).forEach((day, index) => uppers.set(day, upperLifts[index]!));
  const emphasis = monthEmphasis(month);
  const benchmarkDay =
    month.benchmark_week === input.weekIndex
      ? training.find((day) => day !== longDay && !lowers.has(day) && !uppers.has(day)) ?? training.find((day) => day !== longDay) ?? null
      : null;

  const days: DayIntent[] = DAY_ORDER.map((day) => {
    if (day === rest) {
      return {
        day,
        primary_training: "rest",
        secondary_training: "none",
        training_goal: `${DAY_KO[day]}은 쉽니다.`,
        stimulus: "deload_easy",
        intensity_profile: "light",
        volume_profile: "low",
        duration_profile: "rest",
        fatigue_target: "low",
        movement_pattern: "none",
        progression_required: false,
        recovery_role: "rest",
        strength_lift: "none",
        benchmark: false,
        notes_ko: "휴식일입니다. 훈련을 적지 않습니다.",
      };
    }
    const built = daySlot({
      day,
      month,
      phase,
      fatigued,
      missed,
      succeeded,
      longDay,
      benchmarkDay,
      lower: lowers.get(day) ?? null,
      upper: uppers.get(day) ?? null,
      emphasis,
    });
    return intentFrom(day, built);
  });

  const adjustment = fatigued
    ? "지난주 보고된 피로가 높아 하체 노출과 볼륨을 줄입니다."
    : missed
      ? "미완료가 많아 같은 목적을 낮은 볼륨으로 유지하고 진행하지 않습니다."
      : succeeded
        ? "지난주 수행이 안정적이라 진행을 유지합니다. 요일 고정은 하지 않습니다."
        : "이번 주는 월간 방향을 새 순서로 배치합니다.";
  const repeated = (input.recentSignatures ?? []).length >= 2;
  return {
    version: "intent-v1",
    week_index: input.weekIndex,
    block_phase: phase,
    strength_method: month.strength_method || month.scheme,
    emphasis: wantsLong && emphasis === "mixed" ? "long_conditioning" : emphasis,
    why_ko: `${month.monthly_goal} ${input.weekIndex}주입니다. ${adjustment}`,
    focus: month.focus_ko,
    scheme_note: fatigued
      ? `${month.primary_block} 블록입니다. 지난주 하체 피로가 높아 스쿼트와 데드리프트 세트를 줄입니다.`
      : `${month.primary_block} 블록의 방법을 이번 주에도 유지합니다.`,
    adjustment_ko: adjustment,
    intent_source: "fallback",
    original_intent_source: "fallback",
    fallback_used: true,
    realization: "intent",
    days,
    quality: {
      repetition_risk: repeated ? "moderate" : "low",
      similarity_note_ko: repeated ? "최근 주와 목적이 겹치면 형식과 배치를 바꿉니다." : "이번 주 배치는 지난 주 서명과 비교합니다.",
      repeated_signature: null,
    },
  };
}

function daySlot(input: {
  day: DayKey;
  month: MonthDirection;
  phase: BlockPhase;
  fatigued: boolean;
  missed: boolean;
  succeeded: boolean;
  longDay: DayKey | null;
  benchmarkDay: DayKey | null;
  lower: MainLift | null;
  upper: MainLift | null;
  emphasis: WeeklyIntentPlan["emphasis"];
}): Slot {
  const easy = input.phase === "deload" || input.fatigued || input.missed;
  const volume: VolumeBand = easy ? "low" : "moderate";
  const intensity = input.phase === "deload" ? "light" : input.lower && !input.fatigued ? "heavy" : "moderate";
  if (input.day === input.longDay) {
    return slot({
      primary: "aerobic",
      secondary: "long_conditioning",
      stimulus: "long_mixed",
      pattern: "engine",
      lift: "none",
      volume: "moderate",
      intensity: "moderate",
      fatigue: "moderate",
      recovery: "train",
      progression: false,
      duration: "60-75",
      benchmark: false,
    });
  }
  if (input.lower) {
    const hinge = input.lower === "deadlift";
    return slot({
      primary: hinge ? "posterior_chain" : "lower_strength",
      secondary: "short_anaerobic",
      stimulus: hinge ? "posterior_sprint" : "heavy_strength_sprint",
      pattern: hinge ? "hinge" : "squat",
      lift: input.lower,
      volume,
      intensity: input.phase === "deload" ? "light" : "heavy",
      fatigue: input.fatigued ? "low" : "high",
      recovery: "train",
      progression: input.succeeded && !input.fatigued && input.phase !== "deload",
      duration: "45-60",
      benchmark: false,
    });
  }
  if (input.upper && input.phase !== "deload") {
    return slot({
      primary: "upper_strength",
      secondary: "moderate_conditioning",
      stimulus: "strength_mixed",
      pattern: "press",
      lift: input.upper,
      volume,
      intensity: "moderate",
      fatigue: "moderate",
      recovery: "train",
      progression: input.succeeded,
      duration: "45-60",
      benchmark: input.day === input.benchmarkDay,
    });
  }
  if (input.emphasis === "olympic" && input.day !== input.benchmarkDay) {
    return slot({
      primary: "olympic_technique",
      secondary: "technique",
      stimulus: "olympic_short",
      pattern: "olympic",
      lift: "none",
      volume: "low",
      intensity: "light",
      fatigue: "low",
      recovery: "train",
      progression: false,
      duration: "45-60",
      benchmark: false,
    });
  }
  if (input.emphasis === "gymnastics" || input.day === input.benchmarkDay) {
    return slot({
      primary: "gymnastics_skill",
      secondary: "technique",
      stimulus: "skill_aerobic",
      pattern: "gymnastic",
      lift: "none",
      volume: "low",
      intensity: "light",
      fatigue: "low",
      recovery: input.phase === "deload" ? "easy" : "train",
      progression: false,
      duration: "45-60",
      benchmark: input.day === input.benchmarkDay,
    });
  }
  if (input.emphasis === "aerobic") {
    return slot({
      primary: "aerobic",
      secondary: "aerobic",
      stimulus: "aerobic_capacity",
      pattern: "engine",
      lift: "none",
      volume,
      intensity: "moderate",
      fatigue: "moderate",
      recovery: "train",
      progression: false,
      duration: "45-60",
      benchmark: false,
    });
  }
  const pull = DAY_ORDER.indexOf(input.day) % 2 === 0;
  return slot({
    primary: pull ? "upper_pull" : "mixed_modal",
    secondary: pull ? "technique" : "moderate_conditioning",
    stimulus: pull ? "upper_short" : "threshold",
    pattern: pull ? "pull" : "mixed",
    lift: "none",
    volume,
    intensity: easy ? "light" : "moderate",
    fatigue: easy ? "low" : "moderate",
    recovery: easy ? "easy" : "train",
    progression: false,
    duration: "45-60",
    benchmark: false,
  });
}

function intentFrom(day: DayKey, built: Slot): DayIntent {
  const goal = built.secondary === "long_conditioning"
    ? `${DAY_KO[day]}은 긴 혼합 컨디셔닝으로 페이스를 봅니다.`
    : built.lift !== "none"
      ? `${DAY_KO[day]}은 ${built.primary} 목적입니다. 리프트는 진행이 필요할 때만 유지합니다.`
      : `${DAY_KO[day]}은 ${built.primary} 목적입니다. 동작 이름은 세션에서 정합니다.`;
  return {
    day,
    primary_training: built.primary,
    secondary_training: built.secondary,
    training_goal: goal,
    stimulus: built.stimulus,
    intensity_profile: built.intensity,
    volume_profile: built.volume,
    duration_profile: built.duration,
    fatigue_target: built.fatigue,
    movement_pattern: built.pattern === "mixed" ? "mixed" : (built.pattern as MovementPattern | "mixed" | "none"),
    progression_required: built.progression,
    recovery_role: built.recovery,
    strength_lift: built.lift,
    benchmark: built.benchmark,
    notes_ko: "수업 시간과 컨디셔닝 시간은 서버가 계산합니다.",
  };
}
