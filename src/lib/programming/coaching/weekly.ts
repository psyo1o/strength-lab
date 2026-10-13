import { DAY_ORDER, type DayKey, type MainLift } from "../../month-plan/types";
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
import { goalWeek, layoutFromGoal, restDayFor, weekTrainingLayout } from "./goal-table";
import { deterministicMonthlyPlan } from "./monthly";
import { extractWeekRules } from "./stage13/rules";
import type { DayBound } from "./week-bounds";

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

export { restDayFor };

function slot(input: Slot): Slot {
  return input;
}

/** What the weekly model actually sees. Monthly strategy and recent actuals are in this object. */
export function weeklyCoachPayload(input: {
  month: MonthDirection;
  weekIndex: WeekIndex;
  previousActual?: WeekActual | null;
  recentPlans?: readonly WeeklyIntentPlan[];
  recentStructures?: readonly { format: string; stimulus: string | null; movement_patterns: readonly string[]; duration_min: number }[];
  inputSummary?: unknown;
  dayBounds?: readonly DayBound[] | null;
}): unknown {
  const month = input.month.coaching_plan ?? deterministicMonthlyPlan(input.month, input.previousActual);
  const summary = input.previousActual?.class_summary;
  return {
    agent_name: "weekly_coach",
    monthly_plan: month,
    week_index: input.weekIndex,
    long_required_this_week: input.month.long_conditioning_weeks.includes(input.weekIndex),
    benchmark_week: input.month.benchmark_week === input.weekIndex,
    week_rules: extractWeekRules({ month: input.month, weekIndex: input.weekIndex, actual: input.previousActual }),
    class_minutes: 60,
    reported_fatigue: summary?.fatigue_signal ?? null,
    planned_volume: summary?.actual_volume ?? null,
    completion: summary ? { completed_days: summary.completed_days, missed_days: summary.missed_days } : null,
    recent_intents: (input.recentPlans ?? []).slice(-4).map((plan) => ({
      week_index: plan.week_index,
      block_phase: plan.block_phase,
      days: plan.days.map((day) => ({
        day: day.day,
        primary_training: day.primary_training,
        secondary_training: day.secondary_training,
        stimulus: day.stimulus,
        volume_profile: day.volume_profile,
        strength_lift: day.strength_lift,
        progression_required: day.progression_required,
      })),
    })),
    week_goal: goalWeek(month.goal_table, input.weekIndex),
    day_bounds: input.dayBounds ?? null,
    recent_structures: (input.recentStructures ?? []).slice(-24),
    summary: input.inputSummary ?? null,
    previous_generation_source:
      input.inputSummary && typeof input.inputSummary === "object" && "previous_week" in input.inputSummary
        ? ((input.inputSummary as { previous_week?: { generation_source?: string } | null }).previous_week?.generation_source ?? null)
        : null,
    note: "Return seven day purposes under the key days, in mon-to-sun order. week_goal chose the rest day, and for each training day the focus, target, stimulus, time_domain, and purpose. Copy the rest day. A day with time_domain long is the only long-conditioning day. Copy movement_pattern from target.movement_pattern. Choose the strength lift and the other day fields from that day's day_bounds. heavy true allows only intensity_profile heavy (band 4-5). heavy false allows only light or moderate (band 1-3). When a day lists zone2, the designated day is day and every other day is none. The week has one zone2 day. zone2_modality is the one catalog key on that day. Duration is 40 or 45, or 30 on a deload week. zone2_effort conversational means RPE 2-3, a conversational pace. zone2_hr 60-70 is auxiliary and may be unspecified. A zone2 day uses intensity_profile light only and does not count as high intensity. Do not name extra movements, conditioning movement keys, formats, or amounts. week_rules are immutable. The server does not fill intensity_profile, strength_lift, or zone2.",
  };
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
  const lockedGoal = goalWeek(month.coaching_plan?.goal_table, input.weekIndex);
  const baseLayout = weekTrainingLayout({
    month,
    weekIndex: input.weekIndex,
    previousActual: input.previousActual,
    recentSignatures: input.recentSignatures,
  });
  const layout = lockedGoal ? layoutFromGoal(baseLayout, lockedGoal) : baseLayout;
  const fatigued = layout.fatigued;
  const missed = layout.missed;
  const succeeded = layout.succeeded;
  const phase = layout.phase;
  const rest = layout.rest;
  const training = DAY_ORDER.filter((day) => day !== rest);
  const lowers = layout.lowers;
  const longDay = layout.longDay;
  const uppers = layout.uppers;
  const emphasis = layout.emphasis;
  const wantsLong = longDay != null;
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
    const intent = intentFrom(day, built);
    const goalDay = lockedGoal?.days.find((row) => row.day === day);
    if (goalDay && !goalDay.rest && goalDay.target) {
      intent.movement_pattern = goalDay.target.movement_pattern;
      intent.training_goal = goalDay.purpose;
    }
    return intent;
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
