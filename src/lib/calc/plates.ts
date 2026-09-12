import { roundTo, type WeightUnit } from "./round";

export const KG_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25] as const;
export const LB_PLATES = [45, 35, 25, 10, 5, 2.5] as const;
export const DEFAULT_BAR_KG = 20;
export const DEFAULT_BAR_LB = 45;

export type PlatePair = { weight: number; count: number };

export type PlateResult = {
  unit: WeightUnit;
  requested: number;
  loadable: number;
  bar: number;
  perSide: PlatePair[];
  leftoverPerSide: number;
  possible: boolean;
};

export function defaultBar(unit: WeightUnit): number {
  return unit === "lb" ? DEFAULT_BAR_LB : DEFAULT_BAR_KG;
}

export function platesForUnit(unit: WeightUnit): readonly number[] {
  return unit === "lb" ? LB_PLATES : KG_PLATES;
}

/** Smallest loadable step above the bar (both sides). */
export function loadableIncrement(unit: WeightUnit): number {
  const smallest = platesForUnit(unit)[platesForUnit(unit).length - 1];
  return smallest * 2;
}

export function roundToLoadable(target: number, bar: number, unit: WeightUnit): number {
  if (target <= bar) return bar;
  const step = loadableIncrement(unit);
  const platesTotal = target - bar;
  const roundedPlates = roundTo(platesTotal, step);
  return Number((bar + roundedPlates).toFixed(4));
}

export function calculatePlates(
  target: number,
  unit: WeightUnit,
  bar = defaultBar(unit),
): PlateResult {
  const loadable = roundToLoadable(target, bar, unit);
  let remaining = (loadable - bar) / 2;
  const perSide: PlatePair[] = [];
  for (const plate of platesForUnit(unit)) {
    const count = Math.floor((remaining + 1e-9) / plate);
    if (count > 0) {
      perSide.push({ weight: plate, count });
      remaining = Number((remaining - count * plate).toFixed(6));
    }
  }
  return {
    unit,
    requested: target,
    loadable,
    bar,
    perSide,
    leftoverPerSide: Math.max(0, remaining),
    possible: remaining < 0.05,
  };
}

export function formatPerSide(perSide: PlatePair[], unit: WeightUnit): string {
  if (perSide.length === 0) return unit === "kg" ? "원판 없음 (바만)" : "bar only";
  return perSide.map((p) => `${p.count}×${p.weight}`).join(" + ");
}
