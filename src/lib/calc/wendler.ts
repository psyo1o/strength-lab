import { roundLoad, type WeightUnit } from "./round";

export type WendlerWeek = 1 | 2 | 3 | 4;

export type WendlerSet = {
  week: WendlerWeek;
  setIndex: number;
  percentOfTm: number;
  reps: number;
  amrap: boolean;
  weightKg: number;
  displayWeight: number;
};

const WEEK_SCHEME: Record<
  WendlerWeek,
  { percentOfTm: number; reps: number; amrap: boolean }[]
> = {
  1: [
    { percentOfTm: 65, reps: 5, amrap: false },
    { percentOfTm: 75, reps: 5, amrap: false },
    { percentOfTm: 85, reps: 5, amrap: true },
  ],
  2: [
    { percentOfTm: 70, reps: 3, amrap: false },
    { percentOfTm: 80, reps: 3, amrap: false },
    { percentOfTm: 90, reps: 3, amrap: true },
  ],
  3: [
    { percentOfTm: 75, reps: 5, amrap: false },
    { percentOfTm: 85, reps: 3, amrap: false },
    { percentOfTm: 95, reps: 1, amrap: true },
  ],
  4: [
    { percentOfTm: 40, reps: 5, amrap: false },
    { percentOfTm: 50, reps: 5, amrap: false },
    { percentOfTm: 60, reps: 5, amrap: false },
  ],
};

export const WENDLER_WARMUPS: { percentOfTm: number; reps: number }[] = [
  { percentOfTm: 40, reps: 5 },
  { percentOfTm: 50, reps: 5 },
  { percentOfTm: 60, reps: 3 },
];

export function trainingMaxKg(oneRmKg: number): number {
  return oneRmKg * 0.9;
}

export function wendlerMainSets(
  oneRmKg: number,
  week: WendlerWeek,
  unit: WeightUnit = "kg",
): WendlerSet[] {
  const tm = trainingMaxKg(oneRmKg);
  return WEEK_SCHEME[week].map((row, i) => {
    const raw = tm * (row.percentOfTm / 100);
    const weightKg = roundLoad(raw, "kg");
    return {
      week,
      setIndex: i + 1,
      percentOfTm: row.percentOfTm,
      reps: row.reps,
      amrap: row.amrap,
      weightKg,
      displayWeight: roundLoad(raw, unit),
    };
  });
}

export function wendlerWarmupSets(oneRmKg: number, unit: WeightUnit = "kg") {
  const tm = trainingMaxKg(oneRmKg);
  return WENDLER_WARMUPS.map((row, i) => {
    const raw = tm * (row.percentOfTm / 100);
    return {
      setIndex: i + 1,
      percentOfTm: row.percentOfTm,
      reps: row.reps,
      weightKg: roundLoad(raw, "kg"),
      displayWeight: roundLoad(raw, unit),
    };
  });
}
