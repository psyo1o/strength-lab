import type { WodCategory, WodFamily, WodFormat, WodTier } from "./wod/types";

export const TODAY_MAIN_LABEL_KO = "오늘의 본 운동";
export const EMPTY_RECENT_KO = "아직 기록된 운동이 없어요";
export const PROGRAM_ENTRY_KO = "프로그램 보기";
export const PIN_PROGRAM_KO = "이 프로그램으로 시작";
export const FULL_BADGE_KO = "바로 할 수 있음";
export const LAST_MAIN_SET_LINE_KO = "정한 횟수를 넘어, 자세가 무너지기 전까지 더 해도 돼요.";
export const HISTORY_EMPTY_KO = "이 날에는 저장된 운동이 없어요.";
export const MAXES_STORAGE_KO = "무게는 킬로그램으로 저장해요. 화면은 고른 단위로 보여요.";
export const EXTRA_MAXES_TITLE_KO = "이 프로그램에 추가로 필요한 최대 중량";
export const SAVE_MAXES_KO = "최대 중량과 시작 중량 저장";
export const GEAR_PENDING_KO = "아직 링크가 없어요";
export const WOD_DONE_KO = "본 운동 완료";
export const AMRAP_LABEL_KO = "정해진 시간 동안 최대한 많이";
export const BENCHMARK_KIND_KO = "기준 운동";

/** What the program page says. Wendler in the app is a light warmup and three main sets. */
export const WENDLER_PAGE_COPY_KO =
  "최대 중량의 90%가 트레이닝 맥스입니다. 오늘 무게는 그 트레이닝 맥스를 씁니다. 가벼운 웜업을 하고, 이어서 본세트 세 개를 합니다. 그 날 짧은 컨디셔닝이 있으면 그다음에 합니다.";

export const WENDLER_WEEK_LABELS: Record<number, string> = {
  1: "1주차 · 5회씩",
  2: "2주차 · 3회씩",
  3: "3주차 · 5회, 3회, 그다음 1회 이상",
  4: "4주차 · 무게를 낮춰 쉬는 주",
};

export function visibleProgramCopy(slug: string, description: string): string {
  if (slug === "jim-wendler-531") return WENDLER_PAGE_COPY_KO;
  return description;
}

export function visibleWeekTitle(slug: string, weekNumber: number, nameKo: string): string {
  if (slug === "jim-wendler-531") return WENDLER_WEEK_LABELS[weekNumber] ?? nameKo;
  return nameKo;
}

export function visibleWeekNote(slug: string, weekNumber: number, notesKo: string): string {
  if (slug !== "jim-wendler-531") return notesKo;
  if (weekNumber >= 1 && weekNumber <= 3) return LAST_MAIN_SET_LINE_KO;
  return "";
}

export function amrapDurationLabel(capSec: number): string {
  const total = Math.max(0, Math.floor(capSec));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (seconds === 0) return `${minutes}분 동안 최대한 많이`;
  return `${minutes}분 ${seconds}초 동안 최대한 많이`;
}

export function workoutFormatLine(format: WodFormat, capSec: number | null): string {
  if (format === "amrap" && capSec != null && capSec > 0) return amrapDurationLabel(capSec);
  if (format === "amrap") return AMRAP_LABEL_KO;
  if (format === "emom") return "EMOM";
  if (format === "chipper") return "Chipper";
  return "For Time";
}

export function workoutKindLabel(family: WodFamily | null, category: WodCategory): string {
  if (family === "benchmark" || (family == null && category === "benchmark")) return BENCHMARK_KIND_KO;
  if (family === "girls") return "걸스";
  if (family === "hero") return "히어로";
  return category === "benchmark" ? BENCHMARK_KIND_KO : "컨디셔닝";
}

export function tierLabelKo(tier: WodTier): string {
  if (tier === "scaled") return "가벼운 무게";
  if (tier === "beginner") return "처음 하는 무게";
  return "기본 무게";
}
