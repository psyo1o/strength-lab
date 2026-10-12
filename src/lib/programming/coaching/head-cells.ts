import type { DayKey } from "../../month-plan/types";
import type { SessionDraft } from "../types";
import { patchStoredMovement } from "./movement-catalog";
import type { SessionRevision } from "./review";

export type HeadCellRow = {
  day: DayKey;
  catalog_key: string;
  field: string;
  value: string;
  result: "applied" | "reverted";
  reason: string | null;
};

export type HeadCellReport = {
  proposed: number;
  applied: number;
  reverted: number;
  rows: HeadCellRow[];
};

/** Write each head cell. A catalog miss reverts that cell and leaves the week in place. */
export function applyHeadCells(sessions: readonly SessionDraft[], revisions: readonly SessionRevision[]): HeadCellReport {
  const rows: HeadCellRow[] = [];
  for (const revision of revisions) {
    const cell = revision.cell;
    if (!cell) continue;
    const session = sessions.find((row) => row.day === cell.day);
    const movement = session?.conditioning?.movements.find((row) => row.key === cell.catalog_key || row.movement === cell.catalog_key);
    if (!movement) {
      rows.push({
        day: cell.day,
        catalog_key: cell.catalog_key,
        field: cell.field,
        value: cell.value,
        result: "reverted",
        reason: `${cell.catalog_key} is not on this piece`,
      });
      continue;
    }
    const before = JSON.parse(JSON.stringify(movement)) as typeof movement;
    const patched = patchStoredMovement(movement, cell);
    if (!patched.ok) {
      Object.assign(movement, before);
      rows.push({
        day: cell.day,
        catalog_key: cell.catalog_key,
        field: cell.field,
        value: cell.value,
        result: "reverted",
        reason: patched.reason,
      });
      continue;
    }
    rows.push({
      day: cell.day,
      catalog_key: cell.catalog_key,
      field: cell.field,
      value: cell.value,
      result: "applied",
      reason: null,
    });
  }
  const applied = rows.filter((row) => row.result === "applied").length;
  return { proposed: rows.length, applied, reverted: rows.length - applied, rows };
}
