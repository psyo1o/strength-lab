export type WeightUnit = "kg" | "lb";

export const KG_PER_LB = 0.45359237;
export const LB_PER_KG = 2.20462262185;

export function incrementFor(unit: WeightUnit): number {
  return unit === "lb" ? 5 : 2.5;
}

export function roundTo(value: number, increment: number): number {
  if (!Number.isFinite(value) || increment <= 0) return 0;
  const rounded = Math.round(value / increment) * increment;
  return Number(rounded.toFixed(4));
}

export function roundLoad(kg: number, unit: WeightUnit): number {
  if (unit === "lb") {
    return roundTo(kg * LB_PER_KG, 5);
  }
  return roundTo(kg, 2.5);
}

export function displayWeight(kg: number, unit: WeightUnit): number {
  return roundLoad(kg, unit);
}

/** Nearest whole kilogram or whole pound. Stored kilograms stay unchanged. */
export function memberLoad(kg: number, unit: WeightUnit): number {
  if (!Number.isFinite(kg)) return 0;
  if (unit === "lb") return Math.round(kg * LB_PER_KG);
  return Math.round(kg);
}

/** Convert a number the member is looking at from one unit to the other. */
export function convertDisplayedLoad(value: number, from: WeightUnit, to: WeightUnit): number {
  if (!Number.isFinite(value)) return 0;
  const kg = from === "lb" ? value * KG_PER_LB : value;
  return memberLoad(kg, to);
}

export function inputToKg(value: number, unit: WeightUnit): number {
  if (unit === "lb") return value * KG_PER_LB;
  return value;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${memberLoad(kg, unit)}${unit}`;
}
