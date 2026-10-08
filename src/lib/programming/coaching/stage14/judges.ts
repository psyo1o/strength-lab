import type { ProgressionLabel } from "../stage13/analyzers";
import type { RepetitionIntent } from "../stage13/policy";

type ProgressionRow = { repetition_intent: RepetitionIntent | string; label: ProgressionLabel | string };

/**
 * Variation Judge runs only when a signal exists and the deterministic read cannot tell
 * intentional progression from monotony.
 */
export function variationNeedsJudge(input: {
  findings: readonly string[];
  progression: readonly ProgressionRow[];
}): boolean {
  if (input.findings.length === 0) return false;
  const labels = new Set(input.progression.map((row) => row.label));
  const clearProgression = labels.has("INTENTIONAL_PROGRESSION") && !labels.has("ACCIDENTAL_REPETITION");
  const clearAccident = labels.has("ACCIDENTAL_REPETITION") && !labels.has("INTENTIONAL_PROGRESSION");
  if (clearProgression || clearAccident) return false;
  const intents = new Set(input.progression.map((row) => row.repetition_intent));
  return intents.has("none") && intents.size > 1;
}

/**
 * Recovery Judge runs only when the analyzer is ambiguous or already high-risk.
 * A clear pass is not sent to the model.
 */
export function recoveryNeedsJudge(input: {
  reportedFatigue: string | null;
  heavyLower: boolean;
  recoveryStatus: string;
}): boolean {
  if (input.recoveryStatus === "PASS" || input.recoveryStatus === "SAFE") return false;
  if (input.recoveryStatus === "HIGH_RISK" || input.recoveryStatus === "CRITICAL") return true;
  if (input.reportedFatigue === "high" && input.heavyLower) return true;
  return input.reportedFatigue === "moderate" && input.heavyLower;
}

export function parseJudgeNote(value: unknown): { concern: boolean; note: string } | null {
  if (!value || typeof value !== "object") return null;
  const body = value as { concern?: unknown; note?: unknown };
  if (typeof body.concern !== "boolean") return null;
  if (typeof body.note !== "string" || !body.note.trim()) return null;
  return { concern: body.concern, note: body.note.trim() };
}
