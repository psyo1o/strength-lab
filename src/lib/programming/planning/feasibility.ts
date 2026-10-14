import type { DayKey } from "../../month-plan/types";
import { CONTRACT_FORMATS, stimuliForCeiling, type ContractFormat } from "../coaching/session-contract";
import { COACHING_STIMULI, STIMULI, type CoachingStimulus, type Stimulus } from "../types";

/** Coaching stimuli whose minimum intensity is above light. */
const HEAVY_COACHING = new Set<CoachingStimulus>([
  "heavy_strength_sprint",
  "posterior_sprint",
  "volume_strength",
  "strength_mixed",
  "olympic_short",
  "threshold",
  "upper_short",
]);

export type CellCause = {
  code: "stimulus_ceiling_clash" | "format_ceiling_clash" | "empty_enum";
  path: string;
  detail: string;
};

/** Intensity ceiling to the session stimuli and formats that can be satisfied together. */
export function ceilingAllowance(ceiling: string | null | undefined): { stimuli: Stimulus[]; formats: readonly ContractFormat[] } {
  return {
    stimuli: ceiling === "light" ? ["high_rep", "technical"] : [...STIMULI],
    formats: CONTRACT_FORMATS,
  };
}

export function coachingStimuliForCeiling(ceiling: string | null | undefined): CoachingStimulus[] {
  if (ceiling === "light") return COACHING_STIMULI.filter((stimulus) => !HEAVY_COACHING.has(stimulus));
  return [...COACHING_STIMULI];
}

export type FeasibilityDay = {
  day: DayKey;
  rest: boolean;
  intensity_ceiling: string | null | undefined;
  stimulus: string | null | undefined;
  format: string | null | undefined;
  /** Required slot enums. An empty list is a cause. */
  enums?: readonly { path: string; values: readonly string[] }[];
};

/**
 * A locked skeleton fits the goal table when every training day's ceiling can host that day's session stimulus.
 * A missing skeleton does not fit. This does not choose a replacement band or stimulus.
 */
export function skeletonFitsGoal(
  days: readonly { day: string; status: string; conditioning: { intensity_ceiling: string | null } }[] | null | undefined,
  stimuli: Partial<Record<string, string | null | undefined>>,
): boolean {
  if (!days) return false;
  for (const day of days) {
    if (day.status === "rest") continue;
    const stimulus = stimuli[day.day];
    if (!stimulus) continue;
    if (!stimuliForCeiling(day.conditioning.intensity_ceiling, stimulus).length) return false;
  }
  return true;
}

/**
 * Deterministic check after the skeleton is locked.
 * An empty candidate set is a cause. This function does not pick a replacement value.
 */
export function skeletonFeasibility(days: readonly FeasibilityDay[]): CellCause[] {
  const causes: CellCause[] = [];
  for (const day of days) {
    if (day.rest) continue;
    const allowed = ceilingAllowance(day.intensity_ceiling);
    const stimuli = stimuliForCeiling(day.intensity_ceiling, day.stimulus);
    if (day.stimulus && !stimuli.length) {
      causes.push({
        code: "stimulus_ceiling_clash",
        path: `${day.day}.conditioning.stimulus`,
        detail: `${day.stimulus} is outside ${day.intensity_ceiling ?? "heavy"}`,
      });
    } else if (day.stimulus && !(allowed.stimuli as readonly string[]).includes(day.stimulus)) {
      causes.push({
        code: "stimulus_ceiling_clash",
        path: `${day.day}.conditioning.stimulus`,
        detail: `${day.stimulus} is outside ${day.intensity_ceiling ?? "heavy"}`,
      });
    }
    if (day.format && !(allowed.formats as readonly string[]).includes(day.format)) {
      causes.push({
        code: "format_ceiling_clash",
        path: `${day.day}.conditioning.format`,
        detail: `${day.format} is outside ${day.intensity_ceiling ?? "heavy"}`,
      });
    }
    for (const entry of day.enums ?? []) {
      if (entry.values.length === 0) {
        causes.push({
          code: "empty_enum",
          path: entry.path,
          detail: `${entry.path} has no candidate`,
        });
      }
    }
  }
  return causes;
}
