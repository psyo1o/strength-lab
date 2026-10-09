/** Public data/seed.json shape from the data catalog. */

export type SeedOf = "TM" | "1RM" | "10RM";

export type PublicSeedSet = {
  reps: number;
  percent?: number | null;
  of?: SeedOf | null;
  amrap?: boolean;
  restSec?: number | null;
  noteKo?: string;
};

export type PublicSeedExercise = {
  exerciseId: string;
  role?: string;
  notesKo?: string;
  sets: PublicSeedSet[];
};

export type PublicSeedDay = {
  day: number;
  nameKo?: string;
  notesKo?: string;
  exercises: PublicSeedExercise[];
};

export type PublicSeedWeek = {
  week: number;
  nameKo?: string;
  notesKo?: string;
  days: PublicSeedDay[];
};

export type PublicSeedProgram = {
  id: string;
  nameKo?: string;
  nameEn?: string;
  category?: string;
  completeness?: "full" | "working" | "template";
  descriptionKo?: string;
  descriptionEn?: string;
  usesTM?: boolean;
  tmFactor?: number;
  sortOrder?: number;
  startWeight?: { enabled: boolean };
  progression?: {
    afterEachCycle?: { upperKg: number; lowerKg: number };
  } & Record<string, { addKg?: number; upperKg?: number; lowerKg?: number } | undefined>;
  fridayTriple?: boolean;
  prWeekDefault?: number | null;
  usesEstimated5RM?: boolean;
  estimated5RM?: { formula: string; note?: string };
  setIntervalDefault?: number;
  weeklyProgression?: { factor: number; note?: string; fridayTripleEveryWeek?: boolean };
  extraOneRmFields?: Record<string, { label: string }>;
  weekRules?: string[];
  coverage?: string;
  copy?: { help?: string };
  weeks: PublicSeedWeek[];
};

export type PublicSeedFile = {
  meta: { units: "kg" | "lb"; rounding_kg: number };
  oneRmFields: Record<string, { label: string }>;
  loadRules: { roundKg: number; tmFactor: number; barKg?: number };
  programs: PublicSeedProgram[];
};
