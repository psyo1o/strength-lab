import type { DayKey } from "../../../month-plan/types";
import type { CanonicalDaySource, DayLifecycle, DayPrescriptionRecord, WeekLifecycle } from "../../types";
import { splitHardErrors } from "./hard-rules";

export type { CanonicalDaySource, DayLifecycle, DayPrescriptionRecord, WeekLifecycle };
export type CanonicalSource = Exclude<CanonicalDaySource, "FAILED">;
export type DayStatus = DayLifecycle;
export type WeekStatus = WeekLifecycle;

export type IsolationPlan = {
  replaceDays: DayKey[];
  keepDays: DayKey[];
  weekErrors: string[];
};

/** Only days named by a hard error are candidates. Neighbors stay. */
export function isolationPlan(input: { errors: readonly string[]; trainingDays: readonly DayKey[] }): IsolationPlan {
  const split = splitHardErrors(input.errors);
  const replaceDays = split.days.filter((day) => input.trainingDays.includes(day));
  const replace = new Set(replaceDays);
  return {
    replaceDays,
    keepDays: input.trainingDays.filter((day) => !replace.has(day)),
    weekErrors: split.week,
  };
}

export function dayStillHard(errors: readonly string[], day: DayKey): boolean {
  return splitHardErrors(errors).byDay[day]?.length ? true : false;
}

export function weekStatusFor(input: { hardErrors: readonly string[]; anyDayFailed: boolean }): WeekStatus {
  if (input.anyDayFailed || input.hardErrors.length > 0) return "FAILED";
  return "VALIDATED";
}

export function legacySource(source: CanonicalSource | "FAILED"): "model" | "fallback" {
  return source === "MODEL" || source === "MODEL_REVISED" || source === "MODEL_ADJUSTED" || source === "HEAD_ADJUSTED" ? "model" : "fallback";
}
