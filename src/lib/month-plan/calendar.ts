import { DAY_ORDER, type DayKey } from "./types";

const KST_MS = 9 * 60 * 60 * 1000;
const WEEKDAY: DayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function kstParts(ms: number): { date: string; day: DayKey } {
  const shifted = new Date(ms + KST_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    day: WEEKDAY[shifted.getUTCDay()]!,
  };
}

/** Monday date (YYYY-MM-DD) of the KST week containing ms. */
export function kstWeekStart(ms: number): string {
  const { date, day } = kstParts(ms);
  const index = DAY_ORDER.indexOf(day);
  const monday = Date.parse(`${date}T00:00:00.000Z`) - index * 24 * 60 * 60 * 1000;
  return new Date(monday).toISOString().slice(0, 10);
}
