import type { AthleteSex } from "../auth";

export type { AthleteSex };

export type WeekIndex = 1 | 2 | 3 | 4;
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type BlockRole = "warmup" | "main" | "metcon" | "skill" | "assistance" | "extra_conditioning";
export type MainLift = "squat" | "ohp" | "bench" | "deadlift";
export type MetconPattern = "squat" | "press" | "hinge" | "olympic" | "engine" | "gymnastic";
export type PieceFormat = "amrap" | "for_time" | "emom" | "intervals";

export const DAY_ORDER: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DAY_LABEL: Record<DayKey, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

export const DEFAULT_TRAINING_DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat"];

export const BODY_BUDGET_MIN = 90;

export type StrengthSet = {
  setIndex: number;
  percentOfTm: number;
  reps: number;
  amrap: boolean;
  weightKg: number | null;
};

export type StrengthPrescription = {
  exerciseKey: MainLift;
  nameKo: string;
  oneRmKg: number | null;
  trainingMaxKg: number | null;
  sets: StrengthSet[];
  missingOneRm: boolean;
  noteKo: string;
};

export type PieceMovement = {
  key: string;
  amount: string;
  nameKo: string;
};

/** Identity is format + the set of movements. Order does not matter. */
export type MetconPiece = {
  id: string;
  named: boolean;
  nameKo: string;
  format: PieceFormat;
  minutes: number;
  pattern: MetconPattern;
  movements: PieceMovement[];
  signature: string;
  bodyKo: string;
};

export type SessionBlock = {
  role: BlockRole;
  titleKo: string;
  bodyKo: string;
  minutes: number;
  cuttable: boolean;
  kept: boolean;
  strength?: StrengthPrescription;
};

export type PlannedDay = {
  day: DayKey;
  labelKo: string;
  optional: boolean;
  rest: boolean;
  longPiece: boolean;
  scheduled: boolean;
  blocks: SessionBlock[];
  piece: MetconPiece | null;
  lift: StrengthPrescription | null;
};

export type PlannedWeek = {
  weekIndex: WeekIndex;
  source: "rules";
  adapterId: "rules" | "model";
  bodyBudgetMin: number;
  days: PlannedDay[];
};

export type RecentMetcon = {
  pattern: MetconPattern;
};

export type WeekBuildInput = {
  weekIndex: WeekIndex;
  maxes: Record<string, number>;
  sex: AthleteSex;
  recentMetcons: RecentMetcon[];
  trainingDays?: DayKey[];
};

export type MetconRequest = {
  weekIndex: WeekIndex;
  day: DayKey;
  sex: AthleteSex;
  avoidPatterns: MetconPattern[];
  longPiece: boolean;
  forbid: Array<"squat" | "swing" | "clean" | "snatch" | "deadlift">;
};

export function isWeekIndex(value: number): value is WeekIndex {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function isDayKey(value: string): value is DayKey {
  return (DAY_ORDER as string[]).includes(value);
}
