import type { PieceFormat, PieceMovement } from "./types";

/**
 * Exact identity: same format and the same movement keys with the same amounts.
 * Movement order is ignored so a reversed list is still the same piece.
 * This is not a text-similarity guess.
 */
export function pieceSignature(
  format: PieceFormat | string,
  movements: Array<Pick<PieceMovement, "key" | "amount">>,
): string {
  const parts = movements
    .map((m) => `${m.key.trim().toLowerCase()}:${m.amount.trim().replace(/\s+/g, "")}`)
    .filter((part) => part !== ":")
    .sort();
  if (!format || parts.length === 0) return "";
  return `${format}|${parts.join("|")}`;
}
