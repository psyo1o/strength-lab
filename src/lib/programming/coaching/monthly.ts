import type { WeekActual } from "../summary";
import { previousLowerFatigue } from "../rules";
import type { MonthDirection, MonthlyCoachPlan, WeekIndex } from "../types";

function emphasisText(month: MonthDirection): { gymnastics: string; olympic: string; conditioning: string } {
  const text = `${month.focus_ko}\n${month.skill_direction}\n${month.conditioning_direction}\n${month.monthly_goal}`;
  const olympic = /올림픽|스내치|클린|역도|olympic/i.test(text);
  const gymnastics = /기계체조|핸드스탠드|링|gymnastic/i.test(text);
  const aerobic = /유산소|엔진|aerobic/i.test(text);
  return {
    gymnastics: gymnastics ? "기술 노출을 매주 한 번은 둡니다." : "기술은 무거운 날과 겹치지 않게 짧게 둡니다.",
    olympic: olympic ? "역도 기술과 짧은 근력을 블록 안에 둡니다." : "역도는 선택이 될 때만 넣습니다. 기본값은 아닙니다.",
    conditioning: aerobic ? "유산소 페이스를 블록의 중심으로 둡니다." : month.conditioning_direction,
  };
}

/**
 * Monthly direction from the stored month plus reported fatigue.
 * Week roles can change when the athlete is tired. They are not a fixed four-week template.
 * This function does not write workouts.
 */
export function deterministicMonthlyPlan(month: MonthDirection, actual?: WeekActual | null): MonthlyCoachPlan {
  const reported = previousLowerFatigue(actual);
  const emphasis = emphasisText(month);
  const roles = ([1, 2, 3, 4] as const).map((weekIndex) => weekRole(month, weekIndex, reported));
  return {
    version: "monthly-coach-v1",
    block_goal: month.monthly_goal,
    primary_adaptations: [month.strength_direction, month.primary_block].filter(Boolean),
    secondary_adaptations: [month.secondary_goal, month.skill_direction].filter(Boolean),
    strength_method: month.strength_method || month.scheme,
    conditioning_emphasis: emphasis.conditioning,
    gymnastics_emphasis: emphasis.gymnastics,
    olympic_emphasis: emphasis.olympic,
    progression_strategy: month.progression_notes,
    volume_trend: month.volume_direction,
    intensity_trend: month.intensity_direction,
    recovery_strategy: month.fatigue_direction,
    deload_strategy: month.deload_strategy,
    benchmark_strategy: month.benchmark_direction,
    week_roles: roles,
    source: "deterministic",
  };
}

function weekRole(
  month: MonthDirection,
  weekIndex: WeekIndex,
  reported: ReturnType<typeof previousLowerFatigue>,
): MonthlyCoachPlan["week_roles"][number] {
  const theme = month.week_themes.find((row) => row.week_index === weekIndex)?.theme_ko ?? "";
  const method = month.strength_method || month.scheme;
  if (method === "DELOAD_RECOVERY" || method === "deload" || month.scheme === "deload" || weekIndex === 4) {
    return { week_index: weekIndex, role: "deload", note_ko: theme || "방법은 유지하고 볼륨만 낮춥니다." };
  }
  if (reported === "high" && weekIndex === 1) {
    return { week_index: weekIndex, role: "absorb", note_ko: "최근 보고된 피로가 높아 첫 주는 노출을 낮춥니다." };
  }
  if (month.long_conditioning_weeks.includes(weekIndex)) {
    return { week_index: weekIndex, role: weekIndex === 3 ? "intensification" : "long_support", note_ko: theme || "긴 컨디셔닝을 하루만 둡니다." };
  }
  if (weekIndex === 2) return { week_index: weekIndex, role: "progression", note_ko: theme || "같은 리프트를 이어 가되 요일은 고정하지 않습니다." };
  if (weekIndex === 3) return { week_index: weekIndex, role: "intensification", note_ko: theme || "강도는 방법 안에서만 올립니다." };
  return { week_index: weekIndex, role: "accumulation", note_ko: theme || "볼륨으로 블록을 엽니다." };
}

export function withCoachingPlan(month: MonthDirection, actual?: WeekActual | null): MonthDirection {
  if (month.coaching_plan) return month;
  return { ...month, coaching_plan: deterministicMonthlyPlan(month, actual) };
}
