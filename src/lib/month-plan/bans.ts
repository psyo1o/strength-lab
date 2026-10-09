import type { MetconPattern, MetconPiece, MetconStimulus, WeekBuildInput } from "./types";

/** Week-4 Thursday benchmark. Exempt from the 30-day name/signature ban by id. */
export const WEEK4_BENCHMARK_ID = "sl-month-benchmark";

export type BanCursor = {
  /** Every pattern in the recent 7-day list, not only the latest one. */
  recentPatterns: MetconPattern[];
  /** Every chip in the recent 7-day list, not only the latest one. */
  recentStimuli: MetconStimulus[];
  /** Pattern chosen on the previous day of the week being built. */
  previousPattern: MetconPattern | null;
  /** Chip chosen on the previous day of the week being built. */
  previousStimulus: MetconStimulus | null;
  signatures: Set<string>;
  names: Set<string>;
};

export function openingBan(input: WeekBuildInput): BanCursor {
  return {
    recentPatterns: input.recentMetcons.map((row) => row.pattern),
    recentStimuli: input.recentMetcons.flatMap((row) => (row.stimulus ? [row.stimulus] : [])),
    previousPattern: null,
    previousStimulus: null,
    signatures: new Set((input.blockedSignatures ?? []).map((value) => value.trim()).filter(Boolean)),
    names: new Set((input.blockedNames ?? []).map((value) => value.trim()).filter(Boolean)),
  };
}

function bannedPatterns(cursor: BanCursor): Set<MetconPattern> {
  const patterns = new Set(cursor.recentPatterns);
  if (cursor.previousPattern) patterns.add(cursor.previousPattern);
  return patterns;
}

function bannedStimuli(cursor: BanCursor): Set<MetconStimulus> {
  const stimuli = new Set(cursor.recentStimuli);
  if (cursor.previousStimulus) stimuli.add(cursor.previousStimulus);
  return stimuli;
}

function duplicateBanned(piece: MetconPiece, cursor: BanCursor): boolean {
  if (piece.id === WEEK4_BENCHMARK_ID) return false;
  if (piece.signature && cursor.signatures.has(piece.signature)) return true;
  const name = piece.nameKo.trim();
  if (name && cursor.names.has(name)) return true;
  return false;
}

/**
 * One ban used by the rules week and by candidate-id checks.
 * A pattern or chip ban is skipped only when every remaining candidate would break it.
 * The 30-day name/signature ban does not use that skip to keep the week-4 benchmark;
 * that id is exempt above, even when other candidates remain.
 */
export function applyMetconBans(
  pool: readonly MetconPiece[],
  cursor: BanCursor,
  slot: { clearPatternAvoid: boolean },
): MetconPiece[] {
  let rows = [...pool];
  const stimuli = bannedStimuli(cursor);
  if (stimuli.size > 0) {
    const free = rows.filter((piece) => !piece.stimulus || !stimuli.has(piece.stimulus));
    if (free.length > 0) rows = free;
  }
  if (!slot.clearPatternAvoid) {
    const patterns = bannedPatterns(cursor);
    if (patterns.size > 0) {
      const free = rows.filter((piece) => !patterns.has(piece.pattern));
      if (free.length > 0) rows = free;
    }
  }
  const free = rows.filter((piece) => !duplicateBanned(piece, cursor));
  if (free.length > 0) rows = free;
  return rows;
}

export function noteChosenPiece(cursor: BanCursor, piece: MetconPiece): void {
  cursor.previousPattern = piece.pattern;
  cursor.previousStimulus = piece.stimulus;
  if (piece.signature.trim()) cursor.signatures.add(piece.signature);
  const name = piece.nameKo.trim();
  if (name) cursor.names.add(name);
}
