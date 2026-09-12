import { roundLoad, type WeightUnit } from "./round";

export type PercentBase = "1rm" | "tm" | "ten_rm" | "none";

export function tenRmFrom1rm(oneRmKg: number): number {
  return oneRmKg * 0.75;
}

const BAR_KG = 20;

export function resolveSetKg(opts: {
  oneRmKg: number | null | undefined;
  percentBase: PercentBase | string;
  percent: number | null | undefined;
}): number | null {
  const { oneRmKg, percentBase, percent } = opts;
  const baseKey = String(percentBase || "").toLowerCase();
  if (baseKey === "none" || percent == null) return null;
  if (oneRmKg == null || oneRmKg <= 0) return null;
  // 5/3/1: MROUND(1RM * 0.9 * pct, 2.5)
  let raw: number;
  if (baseKey === "tm") raw = oneRmKg * 0.9 * (percent / 100);
  else if (baseKey === "ten_rm" || baseKey === "10rm") raw = tenRmFrom1rm(oneRmKg) * (percent / 100);
  else raw = oneRmKg * (percent / 100);
  const rounded = roundLoad(raw, "kg");
  if (rounded > 0 && rounded < BAR_KG) return BAR_KG;
  return rounded;
}

export function resolveSetDisplay(
  opts: {
    oneRmKg: number | null | undefined;
    percentBase: PercentBase | string;
    percent: number | null | undefined;
  },
  unit: WeightUnit,
): number | null {
  const kg = resolveSetKg(opts);
  if (kg == null) return null;
  return roundLoad(kg, unit);
}
