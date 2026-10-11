import type { DayKey } from "../../month-plan/types";
import type { SpecialistArea } from "./specialist-generate";

/** One specialist recovery after the in-call retry. Not a raise of max_head_revisions. */
export const MAX_DAY_SCHEMA_RECOVERIES = 1;

const TRANSIENT = new Set(["http_error", "timeout"]);

const ILLEGAL_ALLOWED = new Set([
  "monthly_training_method",
  "locked_weekly_structure",
  "week",
  "skeleton",
  "all_days",
  "other_days",
]);

export function isTransientCoachFailure(reason: string | null | undefined): boolean {
  return reason != null && TRANSIENT.has(reason);
}

export function sameErrorSet(left: readonly string[], right: readonly string[]): boolean {
  const norm = (rows: readonly string[]) =>
    [...rows]
      .map((row) => row.trim())
      .filter(Boolean)
      .sort()
      .join("\n");
  return norm(left) === norm(right);
}

export function failedFieldValues(json: unknown): { field: string; value: string }[] {
  if (!json || typeof json !== "object") return [];
  const conditioning = (json as { conditioning?: { movements?: { key?: string; amount?: unknown }[] } }).conditioning;
  const fields: { field: string; value: string }[] = [];
  (conditioning?.movements ?? []).forEach((movement, index) => {
    if (typeof movement?.amount === "string" && !/\d/.test(movement.amount)) {
      const key = typeof movement.key === "string" ? movement.key : String(index);
      fields.push({ field: `conditioning.movements[${index}].amount`, value: movement.amount });
      fields.push({ field: `conditioning.movements.${key}.amount`, value: movement.amount });
    }
  });
  return fields;
}

/**
 * A revision the head cannot legally send. The row stays out of the specialist call.
 * Invalid day, coach, or range is recorded by the caller.
 */
export function rejectedRevisionSpecs(value: unknown, trainingDays: readonly DayKey[]): { index: number; reason: string }[] {
  if (!value || typeof value !== "object") return [];
  const revisions = (value as { revisions?: unknown }).revisions;
  if (!Array.isArray(revisions)) return [];
  const rejected: { index: number; reason: string }[] = [];
  revisions.forEach((row, index) => {
    if (!row || typeof row !== "object") {
      rejected.push({ index, reason: "revision is not an object" });
      return;
    }
    const item = row as Record<string, unknown>;
    const day = item.day;
    if (typeof day !== "string" || !trainingDays.includes(day as DayKey)) {
      rejected.push({ index, reason: `day ${String(day)} is not a training day in this week` });
    }
    const target = item.target_coach;
    if (
      typeof target === "string" &&
      target.length > 0 &&
      target !== "strength_coach" &&
      target !== "conditioning_coach" &&
      target !== "warmup_coach"
    ) {
      rejected.push({ index, reason: `target_coach ${target} is not a specialist` });
    }
    const allowed = Array.isArray(item.allowed_changes) ? item.allowed_changes : [];
    for (const change of allowed) {
      if (typeof change === "string" && ILLEGAL_ALLOWED.has(change)) {
        rejected.push({ index, reason: `allowed_changes includes ${change}` });
      }
    }
  });
  return rejected;
}

export function dayRecoveryPayload(input: {
  area: SpecialistArea;
  monthly: unknown;
  weeklyGoal: unknown;
  dayIntent: unknown;
  existing: unknown;
  errors: readonly string[];
  invalid: unknown;
  priorAttempts: number;
  neighbors: unknown;
}): Record<string, unknown> {
  const fields = failedFieldValues(input.invalid);
  const preserve =
    input.area === "conditioning"
      ? ["day_role", "strength_note_ko", "warmup_ko", "training_goal"]
      : input.area === "strength"
        ? ["conditioning", "warmup_ko", "day_role"]
        : ["conditioning", "strength_note_ko", "day_role"];
  const allowed = input.area === "conditioning" ? ["conditioning"] : input.area === "strength" ? ["strength_note_ko"] : ["warmup_ko"];
  return {
    area: input.area,
    monthly_direction: input.monthly,
    weekly_goal: input.weeklyGoal,
    day_role: input.dayIntent,
    existing_session: input.existing,
    validation_errors: [...input.errors],
    failed_fields: fields.length ? fields : input.errors.map((error) => ({ field: "validation", value: error })),
    expected_format:
      "Use the specialist schema. An amount needs a count and a unit, for example 10reps. The word reps alone is not a count. Do not record an invented count as if it were already an agreed rule.",
    prior_attempts: input.priorAttempts,
    prior_failure: [...input.errors],
    preserve,
    allowed_changes: allowed,
    forbidden_changes: ["other_days", "monthly_training_method", "locked_weekly_structure", ...preserve],
    neighbor_constraints: input.neighbors,
    instruction:
      "Fix only the listed errors on this day. Keep the purpose and every area you do not own. Do not repeat the same invalid output.",
  };
}
