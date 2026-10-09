import type { MonthDirection } from "./types";
import type { MonthEvaluation, WeekActual } from "./summary";
import { schemeAfter } from "./schemes";

export function evaluationFromActuals(input: {
  month: MonthDirection;
  weekCount: number;
  actuals: WeekActual[];
}): MonthEvaluation {
  const days = input.actuals.flatMap((actual) => actual.days);
  const training = days.filter((day) => !day.rest);
  const completed = training.filter((day) => day.completed).length;
  const missed = training.filter((day) => day.plan_vs_actual === "missed").length;
  const admin = training.filter((day) => day.admin_modified).length;
  const benchmarks = training
    .map((day) => day.benchmark_result)
    .filter((value): value is string => Boolean(value));
  const volumes = input.actuals
    .map((actual) => actual.class_summary?.actual_volume)
    .filter((value): value is NonNullable<typeof value> => value != null);
  const intensities = input.actuals
    .map((actual) => actual.class_summary?.actual_intensity)
    .filter((value): value is NonNullable<typeof value> => value != null);
  const fatigues = input.actuals
    .map((actual) => actual.class_summary?.fatigue_signal)
    .filter((value): value is NonNullable<typeof value> => value != null);
  const next = schemeAfter(input.month.scheme);
  const volumeText = volumes.length ? volumes.join(", ") : "기록 없음";
  const intensityText = intensities.length ? intensities.join(", ") : "기록 없음";
  const fatigueText = fatigues.length ? fatigues.join(", ") : "기록 없음";
  return {
    summary_ko: `${input.month.scheme} 블록을 ${input.weekCount}주 진행했고, 마친 수업은 ${completed}일입니다.`,
    what_worked: completed > 0 ? "클래스 한 판으로 기록을 모았습니다." : "클래스 한 판을 유지했습니다.",
    what_to_change: fatigueText.includes("high") ? "다음 달은 하체 볼륨을 낮춥니다." : "다음 달은 이 평가를 읽고 블록을 정합니다.",
    next_scheme: next,
    monthly_goal: input.month.monthly_goal,
    planned_vs_actual: input.actuals.map((actual) => actual.class_summary?.plan_vs_actual).filter(Boolean).join(" ") || "실제 수행 요약이 없습니다.",
    strength_progress: training.some((day) => day.strength_result && day.strength_result !== "not_recorded")
      ? training
          .map((day) => day.strength_result)
          .filter((value) => value && value !== "not_recorded")
          .slice(0, 6)
          .join(", ") || "근력 기록 없음"
      : "근력 수행은 기록되지 않았습니다.",
    benchmark_progress: benchmarks.length ? benchmarks.join(", ") : "벤치마크 기록이 없습니다.",
    volume: volumeText,
    intensity: intensityText,
    attendance: `마친 훈련일 ${completed}, 빠뜨린 훈련일 ${missed}.`,
    modifications: admin ? `관리자 수정 ${admin}일.` : "관리자 수정 없음.",
    fatigue: fatigueText,
    variation_summary: training
      .map((day) => day.actual_volume)
      .filter((value): value is NonNullable<typeof value> => value != null)
      .join(", ") || "변동 요약 없음",
    block_result: `${input.month.primary_block} 블록, 목표 ${input.month.monthly_goal}`,
    next_month_recommendation: `${next} 블록을 제안합니다. ${fatigueText.includes("high") ? "피로는 높게 집계됐습니다." : "피로 신호는 높지 않습니다."}`,
  };
}

export function completeEvaluation(evaluation: Partial<MonthEvaluation> & Pick<MonthEvaluation, "summary_ko" | "what_worked" | "what_to_change" | "next_scheme">): MonthEvaluation {
  return {
    summary_ko: evaluation.summary_ko,
    what_worked: evaluation.what_worked,
    what_to_change: evaluation.what_to_change,
    next_scheme: evaluation.next_scheme,
    monthly_goal: evaluation.monthly_goal || "",
    planned_vs_actual: evaluation.planned_vs_actual || "실제 수행 요약이 없습니다.",
    strength_progress: evaluation.strength_progress || "근력 수행은 기록되지 않았습니다.",
    benchmark_progress: evaluation.benchmark_progress || "벤치마크 기록이 없습니다.",
    volume: evaluation.volume || "기록 없음",
    intensity: evaluation.intensity || "기록 없음",
    attendance: evaluation.attendance || "출석 집계 없음",
    modifications: evaluation.modifications || "관리자 수정 없음.",
    fatigue: evaluation.fatigue || "기록 없음",
    variation_summary: evaluation.variation_summary || "변동 요약 없음",
    block_result: evaluation.block_result || "",
    next_month_recommendation: evaluation.next_month_recommendation || `${evaluation.next_scheme} 블록을 제안합니다.`,
  };
}
