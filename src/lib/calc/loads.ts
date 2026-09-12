import { roundLoad, type WeightUnit } from "./round";
import { trainingMaxKg } from "./wendler";

export type PercentBase = "1rm" | "tm" | "ten_rm" | "none";

export function tenRmFrom1rm(oneRmKg: number): number {
  return oneRmKg * 0.75;
}

export function resolveSetKg(opts: {
  oneRmKg: number | null | undefined;
  percentBase: PercentBase | string;
  percent: number | null | undefined;
}): number | null {
  const { oneRmKg, percentBase, percent } = opts;
  if (percentBase === "none" || percent == null) return null;
  if (oneRmKg == null || oneRmKg <= 0) return null;
  let base = oneRmKg;
  if (percentBase === "tm") base = trainingMaxKg(oneRmKg);
  if (percentBase === "ten_rm") base = tenRmFrom1rm(oneRmKg);
  return roundLoad(base * (percent / 100), "kg");
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
