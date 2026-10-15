import { writeAudit } from "./audit-log";
import { catalogMovement, displayAmount, movementCatalogVersion, prescribedLoad } from "./programming/coaching/movement-catalog";
import { applyCatalogOption, choiceById, peerMovementIds, quantityOptions } from "./programming/coaching/slot-choices";
import { evaluateWeek, type WeekVerdict } from "./programming/evaluate-week";
import { projectWeek } from "./programming/project";
import { getProgrammingMonthById, getProgrammingWeek, getWeeklyActualForStart, listRecentLiftMaps, listRecentStructures, previousProgrammingWeek } from "./programming/store";
import { ADMIN_CONDITIONING_ID } from "./month-plan/metcon-edit";
import { getSqlite } from "./db/client";
import { validateNoteKo, validateReasonKo } from "./member-profile";
import type { DayKey, PlannedWeek } from "./month-plan/types";
import type { MovementDraft, SessionDraft, WeekDraft } from "./programming/types";

export const WEEK_MISSING_KO = "그 주를 찾지 못했어요.";
export const VERSION_CONFLICT_KO = "다른 수정이 먼저 저장됐어요. 다시 불러 주세요.";
export const CELL_FORBIDDEN_KO = "단위와 Rx는 직접 넣을 수 없어요.";
export const CELL_UNKNOWN_KO = "허용된 칸만 고를 수 있어요.";
export const SKELETON_LOCKED_KO = "뼈대는 이 화면에서 바꾸지 않아요.";
export const NO_CHANGE_KO = "바꾼 칸이 없어요.";
export const WEEK_BLOCKED_KO = "검증을 통과하지 못했어요.";

export type CellSource = "model" | "head_coach" | "admin_edit";

export type WeekCell = {
  id: string;
  day: DayKey;
  block: "conditioning" | "zone2";
  index: number;
  movement_id: string;
  quantity_option: string;
  note_ko: string;
  source: CellSource;
  name_ko: string;
  unit: string | null;
  load: { male: string | null; female: string | null } | null;
  allowed: {
    movement_id: string;
    name_ko: string;
    quantity_option: { id: string; label: string }[];
  }[];
};

type StoredCell = {
  id: string;
  day: DayKey;
  block: "conditioning" | "zone2";
  index: number;
  movement_id: string;
  quantity_option: string;
  note_ko: string;
  source: CellSource;
};

type EditionRow = {
  version: number;
  kind: string;
  draft_json: string;
  cells_json: string;
  catalog_version: string;
};

export function isFatigueCapWarning(error: string): boolean {
  return /heavier than the fatigue limit/i.test(error);
}

/** evaluateWeek 하드 오류만 저장을 막는다. 피로 상한 문장은 경고다. */
export function decideWeekSave(verdict: Pick<WeekVerdict, "ok" | "errors">): {
  allow: boolean;
  hard: string[];
  warnings: string[];
} {
  if (verdict.ok) return { allow: true, hard: [], warnings: [] };
  const warnings = verdict.errors.filter(isFatigueCapWarning);
  const hard = verdict.errors.filter((error) => !isFatigueCapWarning(error));
  return { allow: hard.length === 0, hard, warnings };
}

function quantityId(movement: MovementDraft): string {
  if (movement.unit && movement.amount_value != null) {
    const id = `${movement.unit}:${movement.amount_value}`;
    if (choiceById(movement.key, id)) return id;
  }
  const match = quantityOptions(movement.key).find((option) => displayAmount(option.amount, option.unit) === movement.amount);
  return match ? match.id : `current:${movement.amount}`;
}

function headCoachMarks(weekId: number): Set<string> {
  const rows = getSqlite()
    .prepare("SELECT raw_json FROM programming_generation_logs WHERE scope = 'week' AND plan_id = ?")
    .all(weekId) as { raw_json: string }[];
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    const row = value as Record<string, unknown>;
    if (row.result === "applied" && typeof row.day === "string" && typeof row.catalog_key === "string") {
      found.add(`${row.day}:${row.catalog_key}`);
      if (typeof row.value === "string") found.add(`${row.day}:value:${row.value}`);
    }
    for (const child of Object.values(row)) walk(child);
  };
  for (const row of rows) {
    try {
      walk(JSON.parse(row.raw_json));
    } catch {
      /* 로그 한 건이 깨져도 칸 출처만 model로 남긴다. */
    }
  }
  return found;
}

function sourceFor(marks: Set<string>, day: string, movementId: string): CellSource {
  if (marks.has(`${day}:${movementId}`) || marks.has(`${day}:value:${movementId}`)) return "head_coach";
  return "model";
}

function movementsOf(session: SessionDraft, block: "conditioning" | "zone2"): MovementDraft[] {
  if (block === "conditioning") return session.conditioning?.movements ?? [];
  return session.zone2?.alternate?.movements ?? [];
}

function cellsFromDraft(draft: WeekDraft, marks: Set<string>, previous?: StoredCell[]): StoredCell[] {
  const prior = new Map((previous ?? []).map((cell) => [cell.id, cell]));
  const cells: StoredCell[] = [];
  for (const session of draft.sessions) {
    for (const block of ["conditioning", "zone2"] as const) {
      movementsOf(session, block).forEach((movement, index) => {
        if (!movement.key) return;
        const id = `${session.day}:${block}:${index}`;
        const kept = prior.get(id);
        cells.push({
          id,
          day: session.day,
          block,
          index,
          movement_id: movement.key,
          quantity_option: quantityId(movement),
          note_ko: kept?.note_ko ?? "",
          source: kept?.source ?? sourceFor(marks, session.day, movement.key),
        });
      });
    }
  }
  return cells;
}

function allowedFor(cell: StoredCell, lift: string | null): WeekCell["allowed"] {
  const ids = new Set(peerMovementIds(cell.movement_id, lift));
  ids.add(cell.movement_id);
  return [...ids].map((movementId) => ({
    movement_id: movementId,
    name_ko: catalogMovement(movementId)?.name_ko ?? movementId,
    quantity_option: quantityOptions(movementId).map((option) => ({
      id: option.id,
      label: displayAmount(option.amount, option.unit),
    })),
  }));
}

function presentCell(cell: StoredCell, draft: WeekDraft): WeekCell {
  const session = draft.sessions.find((row) => row.day === cell.day);
  const movement = session ? movementsOf(session, cell.block)[cell.index] : undefined;
  return {
    ...cell,
    name_ko: movement?.name_ko ?? cell.movement_id,
    unit: movement?.unit ?? null,
    load: movement?.load ?? prescribedLoad(cell.movement_id),
    allowed: allowedFor(cell, session?.strength?.lift ?? null),
  };
}

function latestEdition(weekStart: string): EditionRow | null {
  return (
    (getSqlite()
      .prepare(
        `SELECT version, kind, draft_json, cells_json, catalog_version
         FROM wod_editions WHERE week_start = ? ORDER BY version DESC LIMIT 1`,
      )
      .get(weekStart) as EditionRow | undefined) ?? null
  );
}

function pinnedCatalog(weekId: number): string {
  const row = getSqlite()
    .prepare("SELECT catalog_version FROM week_catalog_pins WHERE week_id = ?")
    .get(weekId) as { catalog_version: string } | undefined;
  return row?.catalog_version ?? movementCatalogVersion();
}

function skeletonKey(draft: WeekDraft): string {
  return JSON.stringify(
    draft.sessions.map((session) => ({
      day: session.day,
      rest: session.rest,
      lift: session.strength?.lift ?? null,
      format: session.conditioning?.format ?? null,
      duration: session.conditioning?.duration_min ?? null,
      stimulus: session.conditioning?.stimulus ?? null,
      count: session.conditioning?.movements.length ?? 0,
      zone2: session.zone2?.modality ?? null,
      zone2Count: session.zone2?.alternate?.movements?.length ?? 0,
    })),
  );
}

function published(weekStart: string): { version: number; draft: WeekDraft; cells: StoredCell[]; catalogVersion: string } | null {
  const week = getProgrammingWeek(weekStart);
  if (!week) return null;
  const edition = latestEdition(weekStart);
  const marks = headCoachMarks(week.id);
  if (!edition) {
    return {
      version: 0,
      draft: week.draft,
      cells: cellsFromDraft(week.draft, marks),
      catalogVersion: pinnedCatalog(week.id),
    };
  }
  const draft = JSON.parse(edition.draft_json) as WeekDraft;
  const cells = JSON.parse(edition.cells_json) as StoredCell[];
  return { version: edition.version, draft, cells, catalogVersion: edition.catalog_version };
}

export function loadWeekEditor(weekStart: string): {
  weekStart: string;
  programmingWeekId: number;
  version: number;
  catalogVersion: string;
  cells: WeekCell[];
} | null {
  const week = getProgrammingWeek(weekStart);
  const current = published(weekStart);
  if (!week || !current) return null;
  return {
    weekStart,
    programmingWeekId: week.id,
    version: current.version,
    catalogVersion: current.catalogVersion,
    cells: current.cells.map((cell) => presentCell(cell, current.draft)),
  };
}

type IncomingCell = { id?: unknown; movement_id?: unknown; quantity_option?: unknown; note_ko?: unknown };

function forbiddenKeys(body: Record<string, unknown>): boolean {
  const top = ["unit", "load", "amount", "rx", "quantity", "movement"];
  if (top.some((key) => key in body)) return true;
  if (!Array.isArray(body.cells)) return false;
  return body.cells.some((cell) => {
    if (!cell || typeof cell !== "object") return false;
    const row = cell as Record<string, unknown>;
    return ["unit", "load", "amount", "rx", "name_ko", "source"].some((key) => key in row);
  });
}

function applyCells(
  draft: WeekDraft,
  current: StoredCell[],
  incoming: IncomingCell[],
): { ok: true; draft: WeekDraft; cells: StoredCell[]; changes: Array<Record<string, string>> } | { error: string } {
  if (incoming.length !== current.length) return { error: CELL_UNKNOWN_KO };
  const byId = new Map(incoming.map((cell) => [String(cell.id ?? ""), cell]));
  const nextDraft = structuredClone(draft) as WeekDraft;
  const changes: Array<Record<string, string>> = [];
  const nextCells: StoredCell[] = [];
  for (const cell of current) {
    const row = byId.get(cell.id);
    if (!row || typeof row.movement_id !== "string" || typeof row.quantity_option !== "string") return { error: CELL_UNKNOWN_KO };
    const note = validateNoteKo(row.note_ko ?? "");
    if ("error" in note) return note;
    const session = nextDraft.sessions.find((item) => item.day === cell.day);
    const movement = session ? movementsOf(session, cell.block)[cell.index] : undefined;
    if (!session || !movement) return { error: CELL_UNKNOWN_KO };
    const allowedIds = allowedFor(cell, session.strength?.lift ?? null).map((item) => item.movement_id);
    const sameMove = row.movement_id === cell.movement_id;
    const sameQty = row.quantity_option === cell.quantity_option;
    if (!sameMove) {
      if (!allowedIds.includes(row.movement_id)) return { error: CELL_UNKNOWN_KO };
      const applied = applyCatalogOption(movement, "movement_id", row.movement_id, allowedIds);
      if (!applied.ok) return { error: CELL_UNKNOWN_KO };
      changes.push({ id: cell.id, field: "movement_id", before: cell.movement_id, after: row.movement_id });
    }
    if (!sameQty) {
      if (row.quantity_option.startsWith("current:")) return { error: CELL_UNKNOWN_KO };
      const applied = applyCatalogOption(movement, "quantity_option", row.quantity_option, allowedIds);
      if (!applied.ok) return { error: CELL_UNKNOWN_KO };
      changes.push({ id: cell.id, field: "quantity_option", before: cell.quantity_option, after: row.quantity_option });
    }
    if (note.note !== cell.note_ko) {
      changes.push({ id: cell.id, field: "note_ko", before: cell.note_ko, after: note.note });
    }
    const touched = !sameMove || !sameQty || note.note !== cell.note_ko;
    nextCells.push({
      ...cell,
      movement_id: movement.key,
      quantity_option: quantityId(movement),
      note_ko: note.note,
      source: touched ? "admin_edit" : cell.source,
    });
  }
  if (skeletonKey(draft) !== skeletonKey(nextDraft)) return { error: SKELETON_LOCKED_KO };
  return { ok: true, draft: nextDraft, cells: nextCells, changes };
}

function weekCheckContext(weekStart: string) {
  const previous = previousProgrammingWeek(weekStart);
  return {
    previousActual: previous ? getWeeklyActualForStart(previous.weekStart) : null,
    recentLiftMaps: listRecentLiftMaps(weekStart),
  };
}

function validationPayload(verdict: WeekVerdict, decision: ReturnType<typeof decideWeekSave>) {
  return {
    passed: decision.allow,
    status: verdict.status,
    hard: decision.hard,
    warnings: decision.warnings,
    fatigue_cap_warning: decision.warnings.length > 0,
  };
}

function publishDisplay(weekStart: string, weekIndex: number, display: PlannedWeek, nowMs: number) {
  const json = JSON.stringify(display);
  const existing = getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = ?").get(weekStart) as { id: number } | undefined;
  if (existing) {
    getSqlite().prepare("UPDATE class_weeks SET plan_json = ?, week_index = ? WHERE id = ?").run(json, weekIndex, existing.id);
    return;
  }
  getSqlite()
    .prepare("INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (?, ?, 'm', ?, ?)")
    .run(weekIndex, weekStart, json, nowMs);
}

function displayOf(draft: WeekDraft, weekIndex: PlannedWeek["weekIndex"], method: string, cells: StoredCell[]): PlannedWeek {
  const display = projectWeek(draft, weekIndex, "model", method);
  const editedDays = new Set(cells.filter((cell) => cell.source === "admin_edit").map((cell) => cell.day));
  for (const day of display.days) {
    const notes = cells.filter((cell) => cell.day === day.day && cell.note_ko).map((cell) => cell.note_ko);
    if (day.piece && editedDays.has(day.day)) day.piece.id = ADMIN_CONDITIONING_ID;
    if (notes.length && day.piece) day.piece.bodyKo = `${day.piece.bodyKo}\n${notes.join(" / ")}`;
  }
  return display;
}

function insertEdition(input: {
  weekStart: string;
  programmingWeekId: number;
  version: number;
  parentVersion: number | null;
  kind: "original" | "edit" | "revert";
  editorId: number | null;
  reason: string;
  catalogVersion: string;
  draft: WeekDraft;
  display: PlannedWeek;
  cells: StoredCell[];
  changes: unknown;
  validation: unknown;
  nowMs: number;
}) {
  getSqlite()
    .prepare(
      `INSERT INTO wod_editions (
         week_start, programming_week_id, version, parent_version, kind, editor_id, edited_at, reason_ko,
         catalog_version, draft_json, display_json, cells_json, changes_json, validation_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.weekStart,
      input.programmingWeekId,
      input.version,
      input.parentVersion,
      input.kind,
      input.editorId,
      input.nowMs,
      input.reason,
      input.catalogVersion,
      JSON.stringify(input.draft),
      JSON.stringify(input.display),
      JSON.stringify(input.cells),
      JSON.stringify(input.changes),
      JSON.stringify(input.validation),
    );
}

export function saveWeekEdit(
  actorId: number,
  body: Record<string, unknown>,
  nowMs = Date.now(),
): { ok: true; version: number; warnings: string[] } | { error: string; status: number; warnings?: string[] } {
  if (forbiddenKeys(body)) return { error: CELL_FORBIDDEN_KO, status: 400 };
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const baseVersion = Number(body.baseVersion);
  const reason = validateReasonKo(body.reason_ko);
  if ("error" in reason) return { error: reason.error, status: 400 };
  if (!Array.isArray(body.cells)) return { error: CELL_UNKNOWN_KO, status: 400 };
  const week = getProgrammingWeek(weekStart);
  const month = week ? getProgrammingMonthById(week.monthId) : null;
  if (!week || !month) return { error: WEEK_MISSING_KO, status: 404 };
  const originalPlan = getSqlite().prepare("SELECT plan_json FROM programming_weeks WHERE id = ?").get(week.id) as { plan_json: string };
  const db = getSqlite();
  let result: { ok: true; version: number; warnings: string[] } | { error: string; status: number; warnings?: string[] } = {
    error: WEEK_BLOCKED_KO,
    status: 400,
  };
  const run = db.transaction(() => {
    const current = published(weekStart);
    if (!current || current.version !== baseVersion) {
      result = { error: VERSION_CONFLICT_KO, status: 409 };
      return;
    }
    const applied = applyCells(current.draft, current.cells, body.cells as IncomingCell[]);
    if ("error" in applied) {
      result = { error: applied.error, status: 400 };
      return;
    }
    if (applied.changes.length === 0) {
      result = { error: NO_CHANGE_KO, status: 400 };
      return;
    }
    const verdict = evaluateWeek(applied.draft, month.direction, week.weekIndex, listRecentStructures(weekStart), weekCheckContext(weekStart));
    const decision = decideWeekSave(verdict);
    const validation = validationPayload(verdict, decision);
    if (!decision.allow) {
      result = { error: WEEK_BLOCKED_KO, status: 400, warnings: decision.warnings };
      return;
    }
    const method = month.direction.strength_method || month.direction.scheme;
    const display = displayOf(applied.draft, week.weekIndex, method, applied.cells);
    let version = current.version;
    if (version === 0) {
      version = 1;
      insertEdition({
        weekStart,
        programmingWeekId: week.id,
        version,
        parentVersion: null,
        kind: "original",
        editorId: null,
        reason: "",
        catalogVersion: current.catalogVersion,
        draft: current.draft,
        display: projectWeek(current.draft, week.weekIndex, "model", method),
        cells: current.cells,
        changes: [],
        validation: { passed: true, status: "ORIGINAL", hard: [], warnings: [], fatigue_cap_warning: false },
        nowMs,
      });
    }
    version += 1;
    insertEdition({
      weekStart,
      programmingWeekId: week.id,
      version,
      parentVersion: version - 1,
      kind: "edit",
      editorId: actorId,
      reason: reason.reason,
      catalogVersion: current.catalogVersion,
      draft: applied.draft,
      display,
      cells: applied.cells,
      changes: { cells: applied.changes, before_version: current.version, after_version: version },
      validation,
      nowMs,
    });
    publishDisplay(weekStart, week.weekIndex, display, nowMs);
    writeAudit({
      actorId,
      action: "wod_edit",
      weekStart,
      detail: {
        version,
        catalog_version: current.catalogVersion,
        changes: applied.changes,
        validation,
        reason_ko: reason.reason,
      },
    });
    const after = db.prepare("SELECT plan_json FROM programming_weeks WHERE id = ?").get(week.id) as { plan_json: string };
    if (after.plan_json !== originalPlan.plan_json) throw new Error("original week was rewritten");
    result = { ok: true, version, warnings: decision.warnings };
  });
  run();
  return result;
}

export function revertWeekEdit(
  actorId: number,
  body: Record<string, unknown>,
  nowMs = Date.now(),
): { ok: true; version: number; warnings: string[] } | { error: string; status: number } {
  const weekStart = typeof body.weekStart === "string" ? body.weekStart : "";
  const baseVersion = Number(body.baseVersion);
  const targetVersion = Number(body.targetVersion);
  const reason = validateReasonKo(body.reason_ko);
  if ("error" in reason) return { error: reason.error, status: 400 };
  const week = getProgrammingWeek(weekStart);
  const month = week ? getProgrammingMonthById(week.monthId) : null;
  if (!week || !month) return { error: WEEK_MISSING_KO, status: 404 };
  const originalPlan = getSqlite().prepare("SELECT plan_json FROM programming_weeks WHERE id = ?").get(week.id) as { plan_json: string };
  let result: { ok: true; version: number; warnings: string[] } | { error: string; status: number } = {
    error: WEEK_BLOCKED_KO,
    status: 400,
  };
  const run = getSqlite().transaction(() => {
    const current = published(weekStart);
    if (!current || current.version !== baseVersion) {
      result = { error: VERSION_CONFLICT_KO, status: 409 };
      return;
    }
    if (!Number.isInteger(targetVersion) || targetVersion < 0 || targetVersion >= current.version) {
      result = { error: "되돌릴 버전을 확인해 주세요.", status: 400 };
      return;
    }
    const target =
      targetVersion === 0
        ? { draft: week.draft, cells: cellsFromDraft(week.draft, headCoachMarks(week.id)) }
        : (getSqlite()
            .prepare("SELECT draft_json, cells_json FROM wod_editions WHERE week_start = ? AND version = ?")
            .get(weekStart, targetVersion) as { draft_json: string; cells_json: string } | undefined);
    if (!target) {
      result = { error: "되돌릴 버전을 확인해 주세요.", status: 404 };
      return;
    }
    const draft = "draft_json" in target ? (JSON.parse(target.draft_json) as WeekDraft) : target.draft;
    const cells = "cells_json" in target ? (JSON.parse(target.cells_json) as StoredCell[]) : target.cells;
    if (skeletonKey(current.draft) !== skeletonKey(draft)) {
      result = { error: SKELETON_LOCKED_KO, status: 400 };
      return;
    }
    const verdict = evaluateWeek(draft, month.direction, week.weekIndex, listRecentStructures(weekStart), weekCheckContext(weekStart));
    const decision = decideWeekSave(verdict);
    if (!decision.allow) {
      result = { error: WEEK_BLOCKED_KO, status: 400 };
      return;
    }
    const method = month.direction.strength_method || month.direction.scheme;
    const display = displayOf(draft, week.weekIndex, method, cells);
    const version = current.version + 1;
    const changes = cells
      .map((cell) => {
        const before = current.cells.find((row) => row.id === cell.id);
        if (!before || (before.movement_id === cell.movement_id && before.quantity_option === cell.quantity_option && before.note_ko === cell.note_ko)) {
          return null;
        }
        return {
          id: cell.id,
          before: { movement_id: before.movement_id, quantity_option: before.quantity_option, note_ko: before.note_ko },
          after: { movement_id: cell.movement_id, quantity_option: cell.quantity_option, note_ko: cell.note_ko },
        };
      })
      .filter((row) => row != null);
    insertEdition({
      weekStart,
      programmingWeekId: week.id,
      version,
      parentVersion: current.version,
      kind: "revert",
      editorId: actorId,
      reason: reason.reason,
      catalogVersion: current.catalogVersion,
      draft,
      display,
      cells,
      changes: { target_version: targetVersion, cells: changes },
      validation: validationPayload(verdict, decision),
      nowMs,
    });
    publishDisplay(weekStart, week.weekIndex, display, nowMs);
    writeAudit({
      actorId,
      action: "wod_revert",
      weekStart,
      detail: { version, target_version: targetVersion, catalog_version: current.catalogVersion, validation: validationPayload(verdict, decision) },
    });
    const after = getSqlite().prepare("SELECT plan_json FROM programming_weeks WHERE id = ?").get(week.id) as { plan_json: string };
    if (after.plan_json !== originalPlan.plan_json) throw new Error("original week was rewritten");
    result = { ok: true, version, warnings: decision.warnings };
  });
  run();
  return result;
}

export function listEditableWeeks(limit = 16): Array<{ weekStart: string; weekIndex: number }> {
  return getSqlite()
    .prepare(
      `SELECT week_start, week_index FROM programming_weeks
       WHERE status = 'active' ORDER BY week_start DESC LIMIT ?`,
    )
    .all(limit)
    .map((row) => {
      const item = row as { week_start: string; week_index: number };
      return { weekStart: item.week_start, weekIndex: item.week_index };
    });
}

export function listWeekEditions(weekStart: string): Array<{ version: number; kind: string; editorId: number | null; editedAt: number; reason: string }> {
  return getSqlite()
    .prepare(
      `SELECT version, kind, editor_id, edited_at, reason_ko
       FROM wod_editions WHERE week_start = ? ORDER BY version ASC`,
    )
    .all(weekStart)
    .map((row) => {
      const item = row as { version: number; kind: string; editor_id: number | null; edited_at: number; reason_ko: string };
      return { version: item.version, kind: item.kind, editorId: item.editor_id, editedAt: item.edited_at, reason: item.reason_ko };
    });
}
