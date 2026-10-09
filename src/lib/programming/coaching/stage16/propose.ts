import type { SpecialistReview } from "../stage13/specialists";
import type { AdjustmentRequest, AdjustmentScope, SpecialistStance } from "./types";

function stanceOf(review: SpecialistReview): SpecialistStance {
  if (review.status === "PASS") return "NO_CHANGE";
  if (review.status === "CONCERN") return "FLAG";
  return "ADJUST";
}

function scopeOf(review: SpecialistReview): AdjustmentScope {
  if (review.affected_days.length === 1) return "day";
  if (review.affected_days.length > 1) return "day";
  return "week";
}

/**
 * Specialists propose. They do not call the generator.
 * A concern is FLAG. A critical finding is an ADJUST proposal without a field patch,
 * so the manager records it and does not rebuild the day.
 */
export function proposalsFromSpecialists(reviews: readonly SpecialistReview[]): AdjustmentRequest[] {
  return reviews.map((review) => {
    const stance = stanceOf(review);
    const day = review.affected_days[0];
    const priority = review.severity === "CRITICAL" ? "P1" : review.severity === "MAJOR" ? "P2" : "P3";
    return {
      who: review.name,
      target: day ? `${day}.session` : "week",
      reason: review.reason,
      priority,
      current_value: review.findings[0] ?? review.reason,
      proposed_value: stance === "NO_CHANGE" ? "" : review.recommendation,
      preserve: ["weekly_strength_progression"],
      rationale: review.recommendation || review.reason,
      confidence: review.confidence,
      scope: stance === "NO_CHANGE" ? "field" : scopeOf(review),
      stance,
    };
  });
}
