export type VariationJudgeResult = {
  concern: boolean;
  note: string;
  intentional: boolean;
};

export type RecoveryJudgeResult = {
  concern: boolean;
  note: string;
  risk: "low" | "high" | "ambiguous";
};

export const VARIATION_JUDGE_PROMPT_VERSION = "variation-judge-v2";
export const RECOVERY_JUDGE_PROMPT_VERSION = "recovery-judge-v2";

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Independent of the head review. A head payload is invalid here. */
export function variationJudgeErrors(value: unknown): string[] {
  const body = record(value);
  if (!body) return ["variation judge expected an object"];
  const errors: string[] = [];
  if ("status" in body || "revisions" in body || "note_ko" in body) {
    errors.push("variation judge must not use the head schema");
  }
  if (typeof body.concern !== "boolean") errors.push("concern: expected a boolean");
  if (typeof body.note !== "string" || !body.note.trim()) errors.push("note: expected a non-empty string");
  if (typeof body.intentional !== "boolean") errors.push("intentional: expected a boolean");
  return errors;
}

export function parseVariationJudge(value: unknown): VariationJudgeResult | null {
  if (variationJudgeErrors(value).length) return null;
  const body = record(value)!;
  return { concern: body.concern as boolean, note: String(body.note).trim(), intentional: body.intentional as boolean };
}

export function recoveryJudgeErrors(value: unknown): string[] {
  const body = record(value);
  if (!body) return ["recovery judge expected an object"];
  const errors: string[] = [];
  if ("status" in body || "revisions" in body || "note_ko" in body) {
    errors.push("recovery judge must not use the head schema");
  }
  if (typeof body.concern !== "boolean") errors.push("concern: expected a boolean");
  if (typeof body.note !== "string" || !body.note.trim()) errors.push("note: expected a non-empty string");
  if (body.risk !== "low" && body.risk !== "high" && body.risk !== "ambiguous") {
    errors.push("risk: expected low, high, or ambiguous");
  }
  return errors;
}

export function parseRecoveryJudge(value: unknown): RecoveryJudgeResult | null {
  if (recoveryJudgeErrors(value).length) return null;
  const body = record(value)!;
  return {
    concern: body.concern as boolean,
    note: String(body.note).trim(),
    risk: body.risk as RecoveryJudgeResult["risk"],
  };
}

/** A variation concern is a signal. It is never a hard reject. */
export function variationConcernRejectsDay(): boolean {
  return false;
}
