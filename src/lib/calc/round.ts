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

export function inputToKg(value: number, unit: WeightUnit): number {
  if (unit === "lb") return value * KG_PER_LB;
  return value;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  const n = displayWeight(kg, unit);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${text}${unit}`;
}
