import { roundTo } from "./round";

export type JuggernautWave = "10s" | "8s" | "5s" | "3s";

/** Realization weeks in the 16-week wave block: 10s / 8s / 5s / 3s. */
export const JUGGERNAUT_REALIZATION_WEEKS: Record<number, JuggernautWave> = {
  3: "10s",
  7: "8s",
  11: "5s",
  15: "3s",
};

export function juggernautWaveFromWeek(weekNumber: number): JuggernautWave | null {
  return JUGGERNAUT_REALIZATION_WEEKS[weekNumber] ?? null;
}

export function juggernautWaveFromName(nameKo: string | null | undefined): JuggernautWave | null {
  const text = String(nameKo ?? "");
  if (/\b10s\b/i.test(text)) return "10s";
  if (/\b8s\b/i.test(text)) return "8s";
  if (/\b5s\b/i.test(text)) return "5s";
  if (/\b3s\b/i.test(text)) return "3s";
  return null;
}

/**
 * Sheet realizationMaxHook:
 * newMax = MROUND(((lastWorkKg * amrapReps * 0.033) + lastWorkKg) / 1.05, 2.5)
 * for 10s/8s/5s. 3s omits the /1.05.
 */
export function realizationMaxKg(lastWorkKg: number, amrapReps: number, wave: JuggernautWave): number {
  if (!(lastWorkKg > 0) || !(amrapReps > 0)) return 0;
  const raw = lastWorkKg * amrapReps * 0.033 + lastWorkKg;
  const adjusted = wave === "3s" ? raw : raw / 1.05;
  return roundTo(adjusted, 2.5);
}
