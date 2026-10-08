import type { DayKey } from "../../../month-plan/types";
import { isCoachingSignal } from "../stage13/policy";

export const HARD_CATEGORIES = [
  "SCHEMA",
  "CATALOG",
  "UNIT",
  "TIME",
  "EQUIPMENT",
  "SAFETY",
  "METHOD",
  "WEEK_REQUIREMENT",
  "CLASS_EXECUTION",
] as const;

export type HardCategory = (typeof HARD_CATEGORIES)[number];

export type HardFinding = {
  code: string;
  category: HardCategory;
  message: string;
  days: DayKey[];
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export function daysInText(error: string): DayKey[] {
  const found = new Set<DayKey>();
  for (const match of error.matchAll(/\b(mon|tue|wed|thu|fri|sat|sun)\b/g)) {
    const day = match[1];
    if (day && (DAYS as readonly string[]).includes(day)) found.add(day as DayKey);
  }
  return [...found];
}

/** Hard errors reject. Coaching concerns never do. */
export function classifyProgramError(error: string): HardFinding | { hard: false; message: string } {
  if (
    isCoachingSignal(error) ||
    /stimulus .+ repeats|intentional repetition|variety|monotony|fun|benchmark label is on accessory|benchmark day has no test/i.test(error)
  ) {
    return { hard: false, message: error };
  }
  const days = daysInText(error);
  if (/unit|sec\b|reps|cal\b/i.test(error) && /invalid|received|amount/i.test(error)) {
    return { code: "UNIT_INVALID", category: "UNIT", message: error, days };
  }
  if (/requires equipment|equipment/i.test(error)) return { code: "EQUIPMENT_INVALID", category: "EQUIPMENT", message: error, days };
  if (/not implemented|sets do not match|fatigue cut|method/i.test(error)) {
    return { code: "METHOD_VIOLATION", category: "METHOD", message: error, days };
  }
  if (/heavy squat the day after deadlift/i.test(error)) {
    return { code: "HEAVY_SQUAT_AFTER_HEAVY_DEADLIFT", category: "SAFETY", message: error, days };
  }
  if (/heavy pull the day after|heavy snatch the day after|long piece sits on|long conditioning follows/i.test(error)) {
    return { code: "RECOVERY_CONFLICT", category: "SAFETY", message: error, days };
  }
  if (/benchmark/i.test(error)) return { code: "BENCHMARK_INVALID", category: "WEEK_REQUIREMENT", message: error, days };
  if (/long conditioning|long piece|long-conditioning|long week/i.test(error)) {
    return { code: "LONG_DAY_CONFLICT", category: "WEEK_REQUIREMENT", message: error, days };
  }
  if (/class clock|duration_min|time_domain/i.test(error)) return { code: "TIME_INVALID", category: "TIME", message: error, days };
  if (/class clock|cannot run|class impossible/i.test(error)) {
    return { code: "CLASS_IMPOSSIBLE", category: "CLASS_EXECUTION", message: error, days };
  }
  if (/\.key|catalog|name_ko|unknown movement/i.test(error)) return { code: "CATALOG_INVALID", category: "CATALOG", message: error, days };
  if (/schema|expected|received|missing/i.test(error)) return { code: "SCHEMA_INVALID", category: "SCHEMA", message: error, days };
  return { code: "SCHEMA_INVALID", category: "SCHEMA", message: error, days };
}

export function hardFindings(errors: readonly string[]): HardFinding[] {
  const findings: HardFinding[] = [];
  for (const error of errors) {
    const row = classifyProgramError(error);
    if ("hard" in row) continue;
    findings.push(row);
  }
  return findings;
}

export function splitHardErrors(errors: readonly string[]): { days: DayKey[]; week: string[]; byDay: Partial<Record<DayKey, string[]>> } {
  const byDay: Partial<Record<DayKey, string[]>> = {};
  const week: string[] = [];
  const days = new Set<DayKey>();
  for (const error of errors) {
    const classified = classifyProgramError(error);
    if ("hard" in classified) continue;
    if (classified.category === "WEEK_REQUIREMENT" || classified.days.length === 0) {
      week.push(error);
      continue;
    }
    for (const day of classified.days) {
      days.add(day);
      const list = byDay[day] ?? [];
      list.push(error);
      byDay[day] = list;
    }
  }
  return { days: [...days], week, byDay };
}

/** A final-only code is a pipeline gap, not a reason to rebuild the week. */
export function lateDiscovered(knownCodes: readonly string[], finalCodes: readonly string[]): boolean {
  const known = new Set(knownCodes);
  return finalCodes.some((code) => !known.has(code));
}
