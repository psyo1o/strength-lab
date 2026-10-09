import type { DayKey } from "../../../month-plan/types";
import type { SessionDraft } from "../../types";

export type AdjustmentPriority = "P0" | "P1" | "P2" | "P3";
export type AdjustmentScope = "field" | "block" | "session" | "day" | "week" | "month";
export type SpecialistStance = "NO_CHANGE" | "ADJUST" | "FLAG";
export type HeadStance = "ACCEPT" | "ADJUST" | "ACCEPT_WITH_NOTE";

export type AdjustmentWho =
  | "strength"
  | "conditioning"
  | "recovery"
  | "variation"
  | "practical"
  | "fun"
  | "manager"
  | "head"
  | "hard_validator";

/** A coach names one target. Prose does not regenerate a session. */
export type AdjustmentRequest = {
  who: AdjustmentWho;
  target: string;
  reason: string;
  priority: AdjustmentPriority;
  current_value: string;
  proposed_value: string;
  preserve: string[];
  rationale: string;
  confidence: number;
  scope: AdjustmentScope;
  stance: SpecialistStance | HeadStance;
};

export type AdjustmentTrace = {
  who: AdjustmentWho;
  when: "manager" | "head" | "hard";
  target: string;
  reason: string;
  before: string;
  after: string;
  preserved_intent: string[];
  priority: AdjustmentPriority;
  decision: string;
};

export type ConflictDecision = {
  target: string;
  decision: string;
  kept: string;
  dropped: string;
};

export type PrescriptionLayers = {
  model_original: SessionDraft[];
  manager_adjusted: SessionDraft[];
  head_adjusted: SessionDraft[];
  final_prescription: SessionDraft[];
};

export type FieldPatch = {
  day: DayKey;
  field: "conditioning.intensity" | "conditioning.volume" | "conditioning.duration_min" | "conditioning.format" | "conditioning.drop_last_movement";
  value: string;
};

export const STRENGTH_PRESERVE = ["weekly_strength_progression", "strength_progression", "strength"];
