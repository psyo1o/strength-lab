import type { MonthDirection } from "./types";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** Fills spec fields the model or an older row left blank. Does not invent a new scheme. */
export function completeMonthDirection(direction: Omit<MonthDirection, keyof MonthFieldDefaults> & Partial<MonthFieldDefaults>): MonthDirection {
  const weekly =
    direction.week_themes?.map((theme) => `${theme.week_index}주 ${theme.theme_ko}`).join(", ") || "네 주를 같은 블록으로 잇습니다.";
  return {
    ...direction,
    monthly_goal: text(direction.monthly_goal, direction.focus_ko),
    primary_block: text(direction.primary_block, direction.scheme),
    secondary_goal: text(direction.secondary_goal, direction.why_ko),
    strength_direction: text(direction.strength_direction, `${direction.scheme} 근력 방향을 한 달 유지합니다.`),
    conditioning_direction: text(direction.conditioning_direction, "컨디셔닝은 월 방향 안에서만 바꿉니다."),
    skill_direction: text(direction.skill_direction, "기술은 무거운 날과 겹치지 않게 둡니다."),
    volume_direction: text(direction.volume_direction, "볼륨은 블록을 따라 올리고 내립니다."),
    intensity_direction: text(direction.intensity_direction, "강도는 저장 1RM 비율로만 말합니다."),
    benchmark_direction: text(direction.benchmark_direction, `벤치마크는 ${direction.benchmark_week}주차에 한 번 측정합니다.`),
    variation_direction: text(direction.variation_direction, "같은 구조가 반복되면 형식을 바꿉니다."),
    fatigue_direction: text(direction.fatigue_direction, "피로가 높으면 다음 주는 하체 볼륨을 줄입니다."),
    weekly_direction: text(direction.weekly_direction, weekly),
    evaluation_targets:
      Array.isArray(direction.evaluation_targets) && direction.evaluation_targets.length
        ? direction.evaluation_targets.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim())
        : ["출석", "벤치마크", "볼륨", "강도"],
  };
}

type MonthFieldDefaults = Pick<
  MonthDirection,
  | "monthly_goal"
  | "primary_block"
  | "secondary_goal"
  | "strength_direction"
  | "conditioning_direction"
  | "skill_direction"
  | "volume_direction"
  | "intensity_direction"
  | "benchmark_direction"
  | "variation_direction"
  | "fatigue_direction"
  | "weekly_direction"
  | "evaluation_targets"
>;
