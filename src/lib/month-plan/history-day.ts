import { formatWeight, type WeightUnit } from "../calc/round";
import { DAY_ORDER, type DayKey } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export type SetGroupInput = {
  reps: number;
  amrap: boolean;
  weightKg: number | null;
};

/** Today if it has a log. Otherwise the nearest past logged day. Future days are not the default. */
export function defaultHistoryDate(loggedDates: readonly string[], today: string): string {
  if (loggedDates.includes(today)) return today;
  let nearest = "";
  for (const date of loggedDates) {
    if (date < today && date > nearest) nearest = date;
  }
  return nearest || today;
}

export function formatHistoryDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  return `${parts[1] ?? 1}월 ${parts[2] ?? 1}일`;
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday-first week that contains iso. */
export function weekOf(iso: string): string[] {
  const weekday = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const monday = addDays(iso, mondayOffset);
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

export function planCalendarDate(weekStart: string, day: DayKey): string {
  return addDays(weekStart, DAY_ORDER.indexOf(day));
}

export function monthMatrix(year: number, month: number): string[][] {
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const weeks: string[][] = [];
  let cursor = weekOf(first)[0]!;
  const end = weekOf(last)[6]!;
  while (cursor <= end) {
    const week = weekOf(cursor);
    weeks.push(week);
    cursor = addDays(week[6]!, 1);
  }
  return weeks;
}

export const VISIBLE_COMPARE_ROWS = 3;

export type PersonalRankKind = "time" | "rounds" | "load";

/**
 * Place of this stored score among the same personal group.
 * Time: faster is higher. Rounds, reps, and load: higher is better.
 * A single score has no rank.
 */
export function personalRankLabel(current: number, peers: readonly number[], kind: PersonalRankKind): string | null {
  if (peers.length < 2 || !Number.isFinite(current)) return null;
  const higherIsBetter = kind !== "time";
  const ahead = peers.filter((value) => (higherIsBetter ? value > current : value < current)).length;
  return `내 기록 ${ahead + 1} / ${peers.length}`;
}

/** Named pieces share a name. Everything else shares movements and format. */
export function samePersonalGroup(
  current: { named: boolean; pieceKey: string; signature: string },
  other: { pieceKey: string; signature: string },
): boolean {
  if (current.named) return current.pieceKey !== "" && other.pieceKey === current.pieceKey;
  return current.signature !== "" && other.signature === current.signature;
}

/** Collapsed cards show at most three earlier scores. Expanding returns the same rows, still on that card. */
export function visibleCompareRows<T>(rows: readonly T[], expanded: boolean): T[] {
  if (expanded) return rows.slice();
  return rows.slice(0, VISIBLE_COMPARE_ROWS);
}

export function cardsOnDate<T extends { date: string }>(cards: readonly T[], date: string): T[] {
  return cards.filter((card) => card.date === date);
}

/** Identical consecutive sets collapse to `5×5 · 100kg`. A missing weight stays a scheme with no unit. */
export function formatSetGroups(sets: readonly SetGroupInput[], unit: WeightUnit): string[] {
  const lines: string[] = [];
  let index = 0;
  while (index < sets.length) {
    const current = sets[index]!;
    let count = 1;
    while (index + count < sets.length) {
      const next = sets[index + count]!;
      if (next.reps !== current.reps || next.amrap !== current.amrap || next.weightKg !== current.weightKg) break;
      count += 1;
    }
    const reps = current.amrap ? `${current.reps}+` : String(current.reps);
    const weight = current.weightKg == null ? "" : ` · ${formatWeight(current.weightKg, unit)}`;
    lines.push(`${count}×${reps}${weight}`);
    index += count;
  }
  return lines;
}
