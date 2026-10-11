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

/** Pull a field path and the received value out of a validator sentence. */
export function fieldEditFromError(error: string): { field: string; value: string } {
  const received = error.match(/received\s+([^;]+)/);
  const value = received?.[1]?.trim() || error;
  const named = error.match(/prescription:\s*([A-Za-z0-9_]+)\s+field\s+(\S+)/);
  if (named) {
    const key = named[1];
    const path = named[2].replace(/[.:]+$/, "");
    const field = path.endsWith("amount") ? path.replace(/amount$/, `${key}.amount`) : `${path}.${key}`;
    return { field, value };
  }
  const prefix = error.match(/^([^:]+):\s*received/);
  return { field: prefix?.[1]?.trim() || "validation", value };
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * A schema-valid recovery may change only the named fields.
 * This does not call the model again.
 */
export function recoveryDrift(input: {
  before: unknown;
  after: unknown;
  fields: readonly { field: string }[];
}): { ok: true } | { ok: false; changed: string[] } {
  const movementAmounts = new Set<string>();
  const indexAmounts = new Set<number>();
  const scalars = new Set<string>();
  for (const row of input.fields) {
    const keyed = row.field.match(/movements\.([A-Za-z0-9_]+)\.amount$/);
    if (keyed && !/^\d+$/.test(keyed[1])) movementAmounts.add(keyed[1]);
    const indexed = row.field.match(/movements\[(\d+)\]\.amount$/);
    if (indexed) indexAmounts.add(Number(indexed[1]));
    if (/(?:^|\.)interval_work_sec$/.test(row.field)) scalars.add("interval_work_sec");
    if (/(?:^|\.)interval_rest_sec$/.test(row.field)) scalars.add("interval_rest_sec");
    if (/(?:^|\.)notes_ko$/.test(row.field)) scalars.add("notes_ko");
  }
  const changed: string[] = [];
  const left = asRecord(input.before);
  const right = asRecord(input.after);
  if (!left || !right) return { ok: false, changed: ["recovery output is missing"] };
  if (left.day !== right.day) changed.push("day");
  if (!scalars.has("notes_ko") && left.notes_ko !== right.notes_ko) changed.push("notes_ko");
  const beforePiece = asRecord(left.conditioning);
  const afterPiece = asRecord(right.conditioning);
  if (!beforePiece || !afterPiece) return { ok: false, changed: [...changed, "conditioning"] };
  for (const key of ["format", "duration_min", "stimulus", "volume", "intensity", "interval_work_sec", "interval_rest_sec"] as const) {
    if (scalars.has(key)) continue;
    if (beforePiece[key] !== afterPiece[key]) changed.push(`conditioning.${key}`);
  }
  if (JSON.stringify(beforePiece.equipment ?? null) !== JSON.stringify(afterPiece.equipment ?? null)) changed.push("conditioning.equipment");
  const beforeMoves = Array.isArray(beforePiece.movements) ? beforePiece.movements : [];
  const afterMoves = Array.isArray(afterPiece.movements) ? afterPiece.movements : [];
  if (beforeMoves.length !== afterMoves.length) changed.push("conditioning.movements");
  else {
    beforeMoves.forEach((row, index) => {
      const beforeMove = asRecord(row);
      const afterMove = asRecord(afterMoves[index]);
      if (!beforeMove || !afterMove) {
        changed.push(`conditioning.movements[${index}]`);
        return;
      }
      if (beforeMove.key !== afterMove.key) changed.push(`conditioning.movements[${index}].key`);
      if (beforeMove.name_ko !== afterMove.name_ko) changed.push(`conditioning.movements[${index}].name_ko`);
      const key = typeof beforeMove.key === "string" ? beforeMove.key : String(index);
      if (!movementAmounts.has(key) && !indexAmounts.has(index) && beforeMove.amount !== afterMove.amount) {
        changed.push(`conditioning.movements.${key}.amount`);
      }
    });
  }
  return changed.length ? { ok: false, changed } : { ok: true };
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
  const fromErrors = input.errors.map((error) => ({ ...fieldEditFromError(error), error }));
  const rows = fields.length ? fields.map((row) => ({ ...row, error: "" })) : fromErrors;
  const fieldEdits = rows.map((row) => {
    const allowed = row.error.match(/(?:allowed|expected):\s*([^.]*)/)?.[1]?.trim();
    const amount = row.field.includes("amount")
      ? `A count and a unit.${allowed ? ` Expected: ${allowed}.` : ""} Reps are 10 or 10reps. Calories are 12cal or 12/10cal. Distance is 500m. Seconds are 30sec. The word reps alone is not a count.`
      : allowed || "Use the specialist schema for this field. Do not invent a value.";
    return { field: row.field, current_value: row.value, required_format: amount };
  });
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
    failed_fields: fieldEdits,
    field_edits: fieldEdits,
    expected_format: fieldEdits[0]?.required_format ?? "Use the specialist schema for the named field.",
    prior_attempts: input.priorAttempts,
    prior_failure: [...input.errors],
    preserve,
    allowed_changes: allowed,
    forbidden_changes: ["other_days", "monthly_training_method", "locked_weekly_structure", ...preserve],
    neighbor_constraints: input.neighbors,
    instruction:
      "Apply each field_edit. Change only that field path from current_value to required_format. Prefer a cells array of catalog_key, field, and value. The server writes only those cells. Do not change any other field, movement, day, or the weekly skeleton.",
  };
}
