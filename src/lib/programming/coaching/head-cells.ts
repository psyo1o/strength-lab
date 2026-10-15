import type { DayKey } from "../../month-plan/types";
import type { SessionDraft } from "../types";
import type { HeadPieceRef } from "./contract";
import { patchStoredMovement, type MovementCellField } from "./movement-catalog";
import { intensityBandsAtMost, intensityBandsForStimulus, intensityLockEnum, isLockPatchField } from "./session-contract";
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

/** Days whose stored intensity is outside the skeleton ceiling. The same head call can patch that one field. */
export function intensityRevisionCells(
  sessions: readonly SessionDraft[],
  ceilingFor: (day: DayKey) => string | null | undefined,
  classFor?: (day: DayKey) => string | null | undefined,
): HeadPieceRef[] {
  const cells: HeadPieceRef[] = [];
  for (const session of sessions) {
    if (session.rest || !session.conditioning) continue;
    const current = session.conditioning.intensity;
    const ceiling = ceilingFor(session.day);
    const stimulus = session.conditioning.stimulus;
    const named = classFor?.(session.day);
    const intensityClass = named === "light" || named === "moderate" || named === "heavy" ? named : null;
    const choices = intensityClass
      ? intensityLockEnum(
          {
            intensity_ceiling: ceiling === "light" || ceiling === "moderate" || ceiling === "heavy" ? ceiling : "heavy",
            intensity_class: intensityClass,
          },
          stimulus ? [stimulus] : [],
        ).filter((band) => band !== current)
      : intensityBandsAtMost(ceiling).includes(current)
        ? []
        : intensityBandsForStimulus(ceiling, stimulus ? [stimulus] : []).filter((band) => band !== current);
    if (!choices.length) continue;
    cells.push({
      day: session.day,
      block: "conditioning",
      catalog_key: "intensity",
      intensity_values: choices,
      required: true,
    });
  }
  return cells;
}

/**
 * 후보를 적용한 뒤 위반이 없으면 그 값만 남긴다.
 * 잠금을 깨는 수량은 여기서 빠진다. 코드가 다른 값을 채우지 않는다.
 */
export function clearingValues(
  sessions: readonly SessionDraft[],
  revision: { day: DayKey; catalog_key: string; field: MovementCellField; values: readonly string[] },
  violates: (sessions: SessionDraft[]) => boolean,
  context?: { avoidHeavyLower?: boolean },
): string[] {
  const kept: string[] = [];
  for (const value of revision.values) {
    const clone = JSON.parse(JSON.stringify(sessions)) as SessionDraft[];
    const report = applyHeadCells(
      clone,
      [
        {
          day: revision.day,
          reason: "후보가 뼈대와 규칙을 지키는지 확인합니다.",
          correction_instruction: "candidate",
          cell: {
            day: revision.day,
            block: "conditioning",
            catalog_key: revision.catalog_key,
            field: revision.field,
            value,
            reason: "후보가 뼈대와 규칙을 지키는지 확인합니다.",
          },
        },
      ],
      context,
    );
    if (report.applied !== 1) continue;
    if (violates(clone)) continue;
    kept.push(value);
  }
  return kept;
}

/** Write each head cell. A catalog miss reverts that cell and leaves the week in place. */
export function applyHeadCells(
  sessions: readonly SessionDraft[],
  revisions: readonly SessionRevision[],
  context?: { avoidHeavyLower?: boolean; accept?: (sessions: readonly SessionDraft[]) => boolean },
): HeadCellReport {
  const rows: HeadCellRow[] = [];
  for (const revision of revisions) {
    const cell = revision.cell;
    if (!cell) continue;
    const session = sessions.find((row) => row.day === cell.day);
    if (isLockPatchField(cell.field)) {
      rows.push({
        day: cell.day,
        catalog_key: cell.catalog_key,
        field: cell.field,
        value: cell.value,
        result: "reverted",
        reason: "lock field is not a patch target",
      });
      continue;
    }
    if (cell.field === "intensity") {
      const band = cell.value === "light" || cell.value === "moderate" || cell.value === "heavy" ? cell.value : null;
      if (cell.catalog_key !== "intensity" || !band || !session?.conditioning) {
        rows.push({
          day: cell.day,
          catalog_key: cell.catalog_key,
          field: cell.field,
          value: cell.value,
          result: "reverted",
          reason: "intensity is not on this day",
        });
        continue;
      }
      const previousBand = session.conditioning.intensity;
      const previousSessionBand = session.intensity;
      session.conditioning.intensity = band;
      session.intensity = band;
      if (context?.accept && !context.accept(sessions)) {
        session.conditioning.intensity = previousBand;
        session.intensity = previousSessionBand;
        rows.push({
          day: cell.day,
          catalog_key: cell.catalog_key,
          field: cell.field,
          value: cell.value,
          result: "reverted",
          reason: "not an allowed candidate",
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
      if (!patched.ok || (context?.accept && !context.accept(sessions))) {
        Object.assign(movement, before);
        rows.push({
          day: cell.day,
          catalog_key: cell.catalog_key,
          field: cell.field,
          value: cell.value,
          result: "reverted",
          reason: patched.ok ? "not an allowed candidate" : patched.reason,
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
    if (!patched.ok || (context?.accept && !context.accept(sessions))) {
      Object.assign(movement, before);
      rows.push({
        day: cell.day,
        catalog_key: cell.catalog_key,
        field: cell.field,
        value: cell.value,
        result: "reverted",
        reason: patched.ok ? "not an allowed candidate" : patched.reason,
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
