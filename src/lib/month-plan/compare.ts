import { memberLoad, type WeightUnit } from "../calc/round";
import { formatClock } from "../wod/types";
import type { PieceFormat } from "./types";

export type ScoreSnap = {
  timeSec: number | null;
  rounds: number | null;
  extraReps: number | null;
};

export type HistoryCompare = {
  reason: "named" | "same_metcon" | "same_lift";
  reasonKo: string;
  summaryKo: string;
  earlierLabel: string;
  currentLabel: string | null;
  deltaKo: string | null;
};

export function scoreLabel(score: ScoreSnap): string {
  if (score.timeSec != null && score.timeSec >= 0) return formatClock(score.timeSec);
  const rounds = score.rounds ?? 0;
  const reps = score.extraReps ?? 0;
  if (rounds <= 0 && reps <= 0) return "";
  return reps > 0 ? `${rounds}R + ${reps}` : `${rounds}R`;
}

function clockWords(sec: number): string {
  const n = Math.max(0, Math.floor(sec));
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m <= 0) return `${s}초`;
  if (s === 0) return `${m}분`;
  return `${m}분 ${s}초`;
}

export function describeTimeDelta(currentSec: number, earlierSec: number): string {
  const delta = earlierSec - currentSec;
  if (delta === 0) return "이전과 같습니다";
  return delta > 0 ? `${clockWords(delta)} 빠름` : `${clockWords(-delta)} 느림`;
}

export function describeRoundsDelta(current: number, earlier: number): string {
  if (current === earlier) return "이전과 같습니다";
  return current > earlier ? "라운드가 늘었습니다" : "라운드가 줄었습니다";
}

export function describeLoadDelta(currentKg: number, earlierKg: number): string {
  const delta = Math.round((currentKg - earlierKg) * 10) / 10;
  if (delta === 0) return "이전과 같습니다";
  const text = Number.isInteger(delta) ? String(Math.abs(delta)) : String(Math.abs(delta));
  return delta > 0 ? `${text}kg 무거움` : `${text}kg 가벼움`;
}

export function formatLabelKo(format: PieceFormat | string): string {
  if (format === "amrap") return "AMRAP";
  if (format === "emom") return "EMOM";
  if (format === "intervals") return "인터벌";
  return "포 타임";
}

export function compareScores(current: ScoreSnap, earlier: ScoreSnap): { summaryTail: string; deltaKo: string | null } {
  const earlierLabel = scoreLabel(earlier);
  const currentLabel = scoreLabel(current);
  if (current.timeSec != null && earlier.timeSec != null) {
    const deltaKo = describeTimeDelta(current.timeSec, earlier.timeSec);
    return { summaryTail: `${earlierLabel} · 이번 ${currentLabel} · ${deltaKo}`, deltaKo };
  }
  const currentRank = (current.rounds ?? 0) * 1000 + (current.extraReps ?? 0);
  const earlierRank = (earlier.rounds ?? 0) * 1000 + (earlier.extraReps ?? 0);
  if ((current.timeSec == null && earlier.timeSec == null) && (currentRank > 0 || earlierRank > 0)) {
    const deltaKo = describeRoundsDelta(currentRank, earlierRank);
    return { summaryTail: `${earlierLabel} · 이번 ${currentLabel} · ${deltaKo}`, deltaKo };
  }
  return { summaryTail: `${earlierLabel} · 이번 ${currentLabel}`, deltaKo: null };
}

export function namedComparison(nameKo: string, current: ScoreSnap | null, earlier: ScoreSnap): HistoryCompare {
  const earlierLabel = scoreLabel(earlier);
  if (!current || !scoreLabel(current)) {
    return {
      reason: "named",
      reasonKo: `같은 벤치마크 · ${nameKo}`,
      summaryKo: `이전 기록 ${earlierLabel}`,
      earlierLabel,
      currentLabel: null,
      deltaKo: null,
    };
  }
  const compared = compareScores(current, earlier);
  return {
    reason: "named",
    reasonKo: `같은 벤치마크 · ${nameKo}`,
    summaryKo: `이전 ${compared.summaryTail}`,
    earlierLabel,
    currentLabel: scoreLabel(current),
    deltaKo: compared.deltaKo,
  };
}

export function metconComparison(
  format: PieceFormat | string,
  current: ScoreSnap | null,
  earlier: ScoreSnap,
): HistoryCompare {
  const earlierLabel = scoreLabel(earlier);
  const reasonKo = `같은 동작 · 같은 형식 · ${formatLabelKo(format)}`;
  if (!current || !scoreLabel(current)) {
    return {
      reason: "same_metcon",
      reasonKo,
      summaryKo: `이전 기록 ${earlierLabel}`,
      earlierLabel,
      currentLabel: null,
      deltaKo: null,
    };
  }
  const compared = compareScores(current, earlier);
  return {
    reason: "same_metcon",
    reasonKo,
    summaryKo: `이전 ${compared.summaryTail}`,
    earlierLabel,
    currentLabel: scoreLabel(current),
    deltaKo: compared.deltaKo,
  };
}

export function liftComparison(
  nameKo: string,
  currentKg: number,
  earlierKg: number,
  unit: WeightUnit = "kg",
): HistoryCompare {
  const current = memberLoad(currentKg, unit);
  const earlier = memberLoad(earlierKg, unit);
  const delta = current - earlier;
  const earlierLabel = `${earlier}${unit}`;
  const currentLabel = `${current}${unit}`;
  const deltaKo = delta === 0 ? "이전과 같습니다" : delta > 0 ? `${delta}${unit} 무거움` : `${-delta}${unit} 가벼움`;
  return {
    reason: "same_lift",
    reasonKo: `같은 메인 리프트 · ${nameKo}`,
    summaryKo: `이전 ${nameKo} ${earlierLabel} · 이번 ${currentLabel} · ${deltaKo}`,
    earlierLabel,
    currentLabel,
    deltaKo,
  };
}
