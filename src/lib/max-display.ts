import { inputToKg, memberLoad, type WeightUnit } from "./calc/round";

/** Screen text for a stored kilogram. Missing stays blank. Sex is not an input. */
export function presentStoredMax(storedKg: number | null | undefined, unit: WeightUnit): string {
  if (typeof storedKg !== "number" || !(storedKg > 0)) return "";
  return String(memberLoad(storedKg, unit));
}

/**
 * Kilograms to write. An unedited display of the stored 1RM keeps that kilogram.
 * A new number converts from the unit the member is looking at. Empty stays empty.
 */
export function commitMaxKg(shown: string, storedKg: number | null | undefined, unit: WeightUnit): number {
  const text = shown.trim();
  if (text === "") return 0;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (typeof storedKg === "number" && storedKg > 0 && presentStoredMax(storedKg, unit) === text) return storedKg;
  return inputToKg(n, unit);
}
