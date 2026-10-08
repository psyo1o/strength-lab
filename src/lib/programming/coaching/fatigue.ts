import { previousLowerFatigue } from "../rules";
import type { WeekActual } from "../summary";
import type { SessionDraft, VolumeBand } from "../types";
import { FATIGUE_ENGINE_VERSION } from "./prompts";

export type FatigueLevel = "low" | "moderate" | "high";

export type RegionKey =
  | "lower_body"
  | "upper_body"
  | "posterior_chain"
  | "axial"
  | "pressing"
  | "pulling"
  | "high_impact"
  | "high_intensity_conditioning"
  | "systemic";

export type FatigueReport = {
  version: typeof FATIGUE_ENGINE_VERSION;
  reported_fatigue: FatigueLevel | "unknown";
  planned_volume: FatigueLevel | "unknown";
  reported_lower_body: ReturnType<typeof previousLowerFatigue>;
  regions: Record<RegionKey, FatigueLevel>;
  recovery_need: FatigueLevel;
  completion: { completed_days: number; missed_days: number } | null;
  note_ko: string;
};

function bandRank(band: VolumeBand | null | undefined): number {
  if (band === "high") return 2;
  if (band === "moderate") return 1;
  return 0;
}

function level(score: number): FatigueLevel {
  if (score >= 2) return "high";
  if (score === 1) return "moderate";
  return "low";
}

function majorityVolume(sessions: readonly SessionDraft[]): FatigueLevel | "unknown" {
  const bands = sessions
    .filter((session) => !session.rest)
    .map((session) => session.conditioning?.volume ?? session.volume)
    .filter((band): band is VolumeBand => band != null);
  if (bands.length === 0) return "unknown";
  const score = bands.reduce((sum, band) => sum + bandRank(band), 0) / bands.length;
  if (score >= 1.5) return "high";
  if (score >= 0.75) return "moderate";
  return "low";
}

/**
 * Planned work and reported fatigue stay in different fields.
 * A completed high-volume plan does not become high fatigue unless the athlete reported it.
 */
export function fatigueReport(input: { sessions: readonly SessionDraft[]; actual?: WeekActual | null }): FatigueReport {
  const reported = previousLowerFatigue(input.actual);
  let lower = 0;
  let upper = 0;
  let posterior = 0;
  let pressing = 0;
  let pulling = 0;
  let impact = 0;
  let intense = 0;
  for (const session of input.sessions) {
    if (session.rest) continue;
    const lift = session.strength?.lift;
    const patterns = session.conditioning?.movement_patterns ?? [];
    if (lift === "squat" || patterns.includes("squat")) lower += 1;
    if (lift === "bench" || lift === "ohp" || patterns.includes("press")) {
      upper += 1;
      pressing += 1;
    }
    if (lift === "deadlift" || patterns.includes("hinge")) posterior += 1;
    if (patterns.includes("pull")) pulling += 1;
    if (patterns.includes("squat") && (session.conditioning?.intensity === "heavy" || session.conditioning?.stimulus === "heavy")) {
      impact += 1;
    }
    if (session.conditioning?.intensity === "heavy" || session.conditioning?.stimulus === "heavy" || session.conditioning?.long_conditioning) {
      intense += 1;
    }
  }
  const regions: FatigueReport["regions"] = {
    lower_body: level(lower),
    upper_body: level(upper),
    posterior_chain: level(posterior),
    axial: level(lower + posterior > 2 ? 2 : lower + posterior === 2 ? 1 : 0),
    pressing: level(pressing),
    pulling: level(pulling),
    high_impact: level(impact),
    high_intensity_conditioning: level(intense),
    systemic: level(lower + posterior + intense >= 4 ? 2 : lower + intense >= 2 ? 1 : 0),
  };
  const reportedLevel: FatigueReport["reported_fatigue"] =
    reported === "unknown" ? "unknown" : reported;
  const recovery: FatigueLevel =
    reported === "high" || regions.systemic === "high" ? "high" : reported === "moderate" || regions.lower_body === "high" ? "moderate" : "low";
  const note =
    reported === "high"
      ? "지난주 보고된 피로가 높습니다. 계획 볼륨과 따로 읽습니다."
      : reported === "low"
        ? "지난주 보고된 피로는 낮습니다. 계획 볼륨이 높아도 피로로 바꾸지 않습니다."
        : "보고된 피로 신호가 없어 계획 볼륨만으로 피로를 정하지 않습니다.";
  return {
    version: FATIGUE_ENGINE_VERSION,
    reported_fatigue: reportedLevel,
    planned_volume: majorityVolume(input.sessions),
    reported_lower_body: reported,
    regions,
    recovery_need: recovery,
    completion: input.actual?.class_summary
      ? {
          completed_days: input.actual.class_summary.completed_days,
          missed_days: input.actual.class_summary.missed_days,
        }
      : null,
    note_ko: note,
  };
}
