import type { DayKey } from "../../../month-plan/types";
import type { HeadCoachReview, SessionRevision } from "../review";
import type { SpecialistReview } from "./specialists";

export type RevisionKind =
  | "WEEK_RULE_ERROR"
  | "SESSION_ERROR"
  | "LOAD_ERROR"
  | "VARIATION_ERROR"
  | "RECOVERY_ERROR"
  | "MONTHLY_ALIGNMENT_ERROR"
  | "STRUCTURE_ERROR";

export type RevisionRoute = {
  kind: RevisionKind;
  agents: Array<"monthly" | "weekly" | "session" | "load">;
  days: DayKey[];
};

/**
 * Send the problem back to the agent that owns it.
 * A variation problem does not rebuild the month. A weekly rule problem does not rewrite one session in place.
 */
export function routeRevision(input: {
  revision: SessionRevision;
  specialists: readonly SpecialistReview[];
}): RevisionRoute {
  const text = `${input.revision.reason} ${input.revision.correction_instruction}`.toLowerCase();
  const involved = input.specialists.filter(
    (review) => review.status !== "PASS" && (review.affected_days.length === 0 || review.affected_days.includes(input.revision.day)),
  );
  const names = new Set(involved.map((review) => review.name));
  if (text.includes("monthly") || text.includes("월간")) {
    return { kind: "MONTHLY_ALIGNMENT_ERROR", agents: ["monthly", "weekly"], days: [] };
  }
  if (names.has("strength") && text.includes("method")) {
    return { kind: "MONTHLY_ALIGNMENT_ERROR", agents: ["monthly", "weekly"], days: [] };
  }
  if (text.includes("week rule") || text.includes("주간 구조") || text.includes("benchmark week") || text.includes("long conditioning week")) {
    return { kind: "WEEK_RULE_ERROR", agents: ["weekly"], days: [] };
  }
  if (text.includes("부하") || text.includes("load")) {
    return { kind: "LOAD_ERROR", agents: ["load"], days: [input.revision.day] };
  }
  if (names.has("recovery") || text.includes("회복") || text.includes("fatigue")) {
    return { kind: "RECOVERY_ERROR", agents: ["session", "load"], days: [input.revision.day] };
  }
  if (names.has("variation") || text.includes("유사") || text.includes("repetition") || text.includes("자극")) {
    return { kind: "VARIATION_ERROR", agents: ["session"], days: [input.revision.day] };
  }
  return { kind: "SESSION_ERROR", agents: ["session"], days: [input.revision.day] };
}

export function routesFor(revisions: readonly SessionRevision[], specialists: readonly SpecialistReview[]): RevisionRoute[] {
  return revisions.map((revision) => routeRevision({ revision, specialists }));
}

/**
 * Critical specialist failures must be revised.
 * Minor-only notes do not overturn an otherwise acceptable week unless the head marks them high.
 */
export function applyHeadPolicy(model: HeadCoachReview, integrator: { must_revise: boolean; only_minor: boolean; note_ko: string; priorities: Array<{ severity: string; issue: string; days: DayKey[] }> }): HeadCoachReview {
  if (integrator.must_revise && model.status === "APPROVE") {
    const days = [...new Set(integrator.priorities.filter((row) => row.severity === "CRITICAL").flatMap((row) => row.days))].slice(0, 3);
    if (days.length === 0) return model;
    return {
      status: "REVISE",
      note_ko: integrator.note_ko,
      revisions: days.map((day) => ({
        day,
        reason: integrator.priorities.find((row) => row.days.includes(day))?.issue ?? "치명 제약을 고쳐야 합니다.",
        correction_instruction: "지적된 제약만 해당 날에서 고치세요.",
        priority: "high" as const,
        constraints: "다른 날은 유지합니다.",
      })),
    };
  }
  if (integrator.only_minor && model.status === "REVISE" && model.revisions.every((row) => row.priority !== "high")) {
    return { status: "APPROVE", revisions: [], note_ko: "사소한 지적만 있어 이번 주를 승인합니다." };
  }
  return model;
}
