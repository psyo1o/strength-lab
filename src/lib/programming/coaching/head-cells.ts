import type { DayKey } from "../../month-plan/types";
import type { SessionDraft } from "../types";
import type { HeadPieceRef } from "./contract";
import { patchStoredMovement } from "./movement-catalog";
import { applyCatalogOption, peerMovementIds } from "./slot-choices";
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

export type PieceCell = HeadPieceRef & {
  amount: string;
  unit: string | null;
  load: { male: string | null; female: string | null } | null;
};

/** Movements that are actually on each day and block. Strength and warmup have no movement cells. */
export function pieceCells(sessions: readonly SessionDraft[]): PieceCell[] {
  const cells: PieceCell[] = [];
  for (const session of sessions) {
    for (const movement of session.conditioning?.movements ?? []) {
      if (!movement.key) continue;
      cells.push({
        day: session.day,
        block: "conditioning",
        catalog_key: movement.key,
        amount: movement.amount,
        unit: movement.unit ?? null,
        load: movement.load ?? null,
      });
    }
  }
  return cells;
}

/** Write each head cell. A catalog miss reverts that cell and leaves the week in place. */
export function applyHeadCells(
  sessions: readonly SessionDraft[],
  revisions: readonly SessionRevision[],
  context?: { avoidHeavyLower?: boolean },
): HeadCellReport {
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
    if (cell.field === "quantity_option" || cell.field === "movement_id" || cell.field === "unit" || cell.field === "load") {
      const allowed = peerMovementIds(movement.key, session?.strength?.lift ?? null);
      const patched = applyCatalogOption(movement, cell.field, cell.value, allowed, {
        stimulus: session?.conditioning?.stimulus ?? null,
        intensity: session?.conditioning?.intensity ?? null,
        avoidHeavyLower: context?.avoidHeavyLower,
      });
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
      continue;
    }
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
