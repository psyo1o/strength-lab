import type { DimensionScore, FallbackQuality } from "../../types";

/**
 * Recorded for a later stage. Nothing in this module chooses REVISE.
 */
export function recordDimensionScore(input: DimensionScore): DimensionScore {
  return {
    dimension: input.dimension,
    score: input.score,
    confidence: input.confidence,
    evidence: [...input.evidence],
    source: input.source,
  };
}

export function fallbackQuality(input: {
  monthlyAligned: boolean;
  weeklyAligned: boolean;
  fatigueOk: boolean;
  strengthOk: boolean;
  conditioningOk: boolean;
  practicalOk: boolean;
}): FallbackQuality {
  const point = (ok: boolean) => (ok ? 8 : 4);
  return {
    monthly_alignment: point(input.monthlyAligned),
    weekly_alignment: point(input.weeklyAligned),
    fatigue: point(input.fatigueOk),
    strength: point(input.strengthOk),
    conditioning: point(input.conditioningOk),
    practical: point(input.practicalOk),
  };
}
