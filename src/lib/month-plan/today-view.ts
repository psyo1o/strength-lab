import { LAST_MAIN_SET_LINE_KO, TODAY_MAIN_LABEL_KO } from "../screen-copy";
import { daySummary } from "./build-week";
import type { PlannedDay, SessionBlock, WeekIndex } from "./types";

export const WEEK_PLAN_MISSING_KO = "이번 주 계획이 아직 만들어지지 않았습니다.";
export const ROTATING_BENCHMARK_LABEL_KO = "순환 벤치마크 · 추가";
export const ROTATING_BENCHMARK_NOTE_KO = "오늘의 세션이 아닙니다.";
export { TODAY_MAIN_LABEL_KO };

/** Bottom button opens this day's session. A missing week goes to the plan screen, not a program essay. */
export function todayWorkoutHref(today: { href: string } | null): string {
  return today?.href ?? "/plan";
}

function displayBody(block: SessionBlock): string {
  const body = block.bodyKo.replace(/(\d+)분 AMRAP/g, "$1분 동안 최대한 많이");
  if (block.role === "main" && block.strength?.sets.some((set) => set.amrap)) {
    return `${body}\n${LAST_MAIN_SET_LINE_KO}`;
  }
  return body;
}

export function blockDurationKo(block: SessionBlock): string {
  if (block.role === "warmup") return "8–12분";
  if (block.minutes > 0) return `${block.minutes}분`;
  return "";
}

export type TodayBlockView = {
  role: SessionBlock["role"];
  titleKo: string;
  durationKo: string;
  headingKo: string;
  bodyKo: string;
};

export function todayBlockViews(day: PlannedDay): TodayBlockView[] {
  return day.blocks
    .filter((block) => block.kept)
    .map((block) => {
      const durationKo = blockDurationKo(block);
      const liftName = block.strength?.nameKo;
      const title = liftName ? `${block.titleKo} · ${liftName}` : block.titleKo;
      return {
        role: block.role,
        titleKo: block.titleKo,
        durationKo,
        headingKo: durationKo ? `${title} · ${durationKo}` : title,
        bodyKo: displayBody(block),
      };
    });
}

export type TodaySessionModel =
  | { kind: "missing" }
  | { kind: "note"; href: string; weekIndex: WeekIndex; labelKo: string; noteKo: string }
  | { kind: "blocks"; href: string; weekIndex: WeekIndex; labelKo: string; blocks: TodayBlockView[] };

/** What the logged-in today screen shows. A missing week is not filled with another workout. */
export function todaySessionModel(
  today: { href: string; weekIndex: WeekIndex; day: PlannedDay } | null,
): TodaySessionModel {
  if (!today) return { kind: "missing" };
  if (today.day.rest || !today.day.scheduled) {
    return {
      kind: "note",
      href: today.href,
      weekIndex: today.weekIndex,
      labelKo: today.day.labelKo,
      noteKo: daySummary(today.day),
    };
  }
  return {
    kind: "blocks",
    href: today.href,
    weekIndex: today.weekIndex,
    labelKo: today.day.labelKo,
    blocks: todayBlockViews(today.day),
  };
}
