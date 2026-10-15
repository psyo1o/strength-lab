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

/**
 * Monday of the class week this member should train.
 * Sunday in Asia/Seoul already belongs to the week that starts the next Monday,
 * so that week can be written before Monday morning.
 */
export function classWeekToTrain(ms: number): string {
  const { date, day } = kstParts(ms);
  if (day !== "sun") return kstWeekStart(ms);
  const monday = Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1000;
  return new Date(monday).toISOString().slice(0, 10);
}

/** Day inside that class week that Today opens. Sunday opens Monday, not a blank rest card. */
export function classDayToOpen(ms: number): DayKey {
  const day = kstParts(ms).day;
  return day === "sun" ? "mon" : day;
}
