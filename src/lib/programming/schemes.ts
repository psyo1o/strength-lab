import type { WeekIndex } from "../month-plan/types";
import type { Scheme, StrengthSetDraft } from "./types";

const SETS: Record<Scheme, Record<WeekIndex, StrengthSetDraft[]>> = {
  "531": {
    1: [
      { percent_of_tm: 65, reps: 5, amrap: false },
      { percent_of_tm: 75, reps: 5, amrap: false },
      { percent_of_tm: 85, reps: 5, amrap: true },
    ],
    2: [
      { percent_of_tm: 70, reps: 3, amrap: false },
      { percent_of_tm: 80, reps: 3, amrap: false },
      { percent_of_tm: 90, reps: 3, amrap: true },
    ],
    3: [
      { percent_of_tm: 75, reps: 5, amrap: false },
      { percent_of_tm: 85, reps: 3, amrap: false },
      { percent_of_tm: 95, reps: 1, amrap: true },
    ],
    4: [
      { percent_of_tm: 40, reps: 5, amrap: false },
      { percent_of_tm: 50, reps: 5, amrap: false },
      { percent_of_tm: 60, reps: 5, amrap: false },
    ],
  },
  volume: {
    1: fiveByFive(),
    2: fiveByFive(),
    3: fiveByFive(),
    4: fiveByFive(),
  },
  intensity: {
    1: intensity(),
    2: intensity(),
    3: intensity(),
    4: intensity(),
  },
  skill: {
    1: skill(),
    2: skill(),
    3: skill(),
    4: skill(),
  },
  deload: {
    1: deload(),
    2: deload(),
    3: deload(),
    4: deload(),
  },
};

function fiveByFive(): StrengthSetDraft[] {
  return Array.from({ length: 5 }, () => ({ percent_of_tm: 70, reps: 5, amrap: false }));
}

function intensity(): StrengthSetDraft[] {
  return [
    { percent_of_tm: 80, reps: 3, amrap: false },
    { percent_of_tm: 85, reps: 2, amrap: false },
    { percent_of_tm: 90, reps: 1, amrap: true },
  ];
}

function skill(): StrengthSetDraft[] {
  return [
    { percent_of_tm: 60, reps: 3, amrap: false },
    { percent_of_tm: 60, reps: 3, amrap: false },
    { percent_of_tm: 65, reps: 2, amrap: false },
  ];
}

function deload(): StrengthSetDraft[] {
  return [
    { percent_of_tm: 40, reps: 5, amrap: false },
    { percent_of_tm: 50, reps: 5, amrap: false },
    { percent_of_tm: 60, reps: 5, amrap: false },
  ];
}

export function schemeSets(scheme: Scheme, weekIndex: WeekIndex): StrengthSetDraft[] {
  return SETS[scheme][weekIndex].map((set) => ({ ...set }));
}

export function setsMatchScheme(scheme: Scheme, weekIndex: WeekIndex, sets: StrengthSetDraft[]): boolean {
  const expected = schemeSets(scheme, weekIndex);
  if (sets.length !== expected.length) return false;
  return sets.every((set, index) => {
    const row = expected[index]!;
    return set.percent_of_tm === row.percent_of_tm && set.reps === row.reps && set.amrap === row.amrap;
  });
}

/** A top set at 85% or more is heavy. Volume, skill, and deload stay under that. */
export function strengthIsHeavy(sets: StrengthSetDraft[]): boolean {
  return sets.some((set) => set.percent_of_tm >= 85);
}

const NEXT: Record<Scheme, Scheme> = {
  "531": "volume",
  volume: "intensity",
  intensity: "skill",
  skill: "deload",
  deload: "531",
};

export function schemeAfter(scheme: Scheme): Scheme {
  return NEXT[scheme];
}
