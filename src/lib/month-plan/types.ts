import type { AthleteSex } from "../auth";

export type { AthleteSex };

export type WeekIndex = 1 | 2 | 3 | 4;
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type BlockRole = "warmup" | "main" | "metcon" | "skill" | "assistance" | "extra_conditioning";
export type MainLift = "squat" | "ohp" | "bench" | "deadlift";
export type MetconPattern = "squat" | "press" | "hinge" | "olympic" | "engine" | "gymnastic";
export type MetconStimulus = "고중량" | "고반복" | "기술";

export const METCON_STIMULI: readonly MetconStimulus[] = ["고중량", "고반복", "기술"];

export function isMetconStimulus(value: unknown): value is MetconStimulus {
  return value === "고중량" || value === "고반복" || value === "기술";
}
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

/** Admin picker row. Aliases stay searchable and are not stored on the class week. */
export type MovementChoice = PieceMovement & {
  aliases?: string[];
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
  /** Null when the piece is mostly engine work and gets no chip. */
  stimulus: MetconStimulus | null;
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
  stimulus?: MetconStimulus;
};

export type WeekBuildInput = {
  weekIndex: WeekIndex;
  maxes: Record<string, number>;
  sex: AthleteSex;
  recentMetcons: RecentMetcon[];
  trainingDays?: DayKey[];
  /** Metcon signatures scored in the last 30 days. */
  blockedSignatures?: readonly string[];
  /** Metcon names scored in the last 30 days. */
  blockedNames?: readonly string[];
};

export type MetconRequest = {
  weekIndex: WeekIndex;
  day: DayKey;
  sex: AthleteSex;
  avoidPatterns: MetconPattern[];
  /** The previous training day's chip, when it had one. */
  avoidStimuli?: MetconStimulus[];
  /** False the day after squat or deadlift, so the metcon is not 고중량. */
  allowHeavy?: boolean;
  longPiece: boolean;
  forbid: Array<"squat" | "swing" | "clean" | "snatch" | "deadlift">;
};

export function isWeekIndex(value: number): value is WeekIndex {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function isDayKey(value: string): value is DayKey {
  return (DAY_ORDER as string[]).includes(value);
}
