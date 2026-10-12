import type { DayKey } from "../../month-plan/types";
import type { SpecialistArea } from "./specialist-generate";

/** One specialist recovery after the in-call retry. Not a raise of max_head_revisions. */
export const MAX_DAY_SCHEMA_RECOVERIES = 1;

/** Pause before the one transport retry of a failed specialist area. */
export const TRANSIENT_AREA_RETRY_MS = 400;

let transientRetryMs = TRANSIENT_AREA_RETRY_MS;

/** Tests set 0 so a simulated outage does not wait out the suite. The probe keeps 400. */
export function setTransientAreaRetryMs(ms: number): void {
  transientRetryMs = ms;
}

export function waitForTransientRetry(): Promise<void> {
  const ms = transientRetryMs;
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

const KOREAN_TEXT_FIELDS = ["notes_ko", "warmup_ko", "strength_note_ko"] as const;
export type KoreanTextField = (typeof KOREAN_TEXT_FIELDS)[number];

export function isKoreanTextField(value: string): value is KoreanTextField {
  return (KOREAN_TEXT_FIELDS as readonly string[]).includes(value);
}

/** Every error names the same Korean field. Mixed failures stay on the movement-cell path. */
export function soleKoreanTextField(errors: readonly string[]): KoreanTextField | null {
  const fields = new Set<KoreanTextField>();
  for (const error of errors) {
    const match = error.match(/\b(notes_ko|warmup_ko|strength_note_ko)\b/);
    if (!match || !/korean ratio|is English|minimum ratio|expected Korean text/.test(error)) return null;
    const field = match[1];
    if (!field || !isKoreanTextField(field)) return null;
    fields.add(field);
  }
  if (fields.size !== 1) return null;
  return [...fields][0] ?? null;
}

/** Copy one Korean string onto the failed specialist JSON. Other keys stay. */
export function applyKoreanTextField(
  before: unknown,
  field: KoreanTextField,
  reply: unknown,
): { ok: true; json: unknown } | { ok: false; reason: string } {
  if (!before || typeof before !== "object" || Array.isArray(before)) return { ok: false, reason: "recovery target is missing" };
  const body = reply && typeof reply === "object" && !Array.isArray(reply) ? (reply as Record<string, unknown>) : null;
  const value = body?.[field];
  if (typeof value !== "string" || !value.trim()) return { ok: false, reason: `${field} recovery is missing` };
  const clone = JSON.parse(JSON.stringify(before)) as Record<string, unknown>;
  clone[field] = value;
  return { ok: true, json: clone };
}

/** Pull a field path and the received value out of a validator sentence. */
export function fieldEditFromError(error: string): { field: string; value: string } {
  const korean = error.match(/\b(notes_ko|warmup_ko|strength_note_ko)\b/);
  if (korean?.[1] && /korean ratio|is English|minimum ratio|expected Korean text/.test(error)) {
    return { field: korean[1], value: error };
  }
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
    if (/(?:^|\.)warmup_ko$/.test(row.field)) scalars.add("warmup_ko");
    if (/(?:^|\.)strength_note_ko$/.test(row.field)) scalars.add("strength_note_ko");
  }
  const changed: string[] = [];
  const left = asRecord(input.before);
  const right = asRecord(input.after);
  if (!left || !right) return { ok: false, changed: ["recovery output is missing"] };
  if (left.day !== right.day) changed.push("day");
  for (const key of ["notes_ko", "warmup_ko", "strength_note_ko"] as const) {
    if (!scalars.has(key) && left[key] !== right[key] && (left[key] != null || right[key] != null)) changed.push(key);
  }
  const beforePiece = asRecord(left.conditioning);
  const afterPiece = asRecord(right.conditioning);
  if (!beforePiece && !afterPiece) return changed.length ? { ok: false, changed } : { ok: true };
  if (!beforePiece || !afterPiece) return { ok: false, changed: [...changed, "conditioning"] };
  for (const key of ["format", "duration_min", "stimulus", "volume", "intensity", "interval_work_sec", "interval_rest_sec"] as const) {
    if (scalars.has(key)) continue;
    if (beforePiece[key] !== afterPiece[key]) changed.push(`conditioning.${key}`);
  }
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
  catalogKeysOnPiece?: readonly string[];
  durationLimit?: { min: number; max: number; because: string } | null;
}): Record<string, unknown> {
  const fields = failedFieldValues(input.invalid);
  const fromErrors = input.errors.map((error) => ({ ...fieldEditFromError(error), error }));
  const rows = fields.length ? fields.map((row) => ({ ...row, error: "" })) : fromErrors;
  const fieldEdits = rows.map((row) => {
    const allowed = row.error.match(/(?:allowed|expected):\s*([^.]*)/)?.[1]?.trim();
    const amount = isKoreanTextField(row.field)
      ? `Korean text. The minimum ratio stays 0.7. Change only ${row.field}.`
      : row.field.includes("amount")
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
  const durationLimit = input.durationLimit ?? null;
  const catalogKeysOnPiece = [...new Set(input.catalogKeysOnPiece ?? [])];
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
    duration_limit: durationLimit,
    allowed_catalog_keys: catalogKeysOnPiece,
    instruction: durationLimit
      ? `Apply each field_edit. Change only that field. conditioning.duration_min must be an integer from ${durationLimit.min} to ${durationLimit.max} because this day is ${durationLimit.because}. allowed_catalog_keys are the only catalog movements already on this piece. Do not name a movement that is not in that list. Do not add a movement. The server writes only the named field or those cells.`
      : "Apply each field_edit. Change only that field path from current_value to required_format. allowed_catalog_keys are the only catalog movements already on this piece. Do not name a movement that is not in that list. The server writes only those cells.",
  };
}
