import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "../src/lib/audit-log";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { FIRST_ADMIN_EMAIL } from "../src/lib/first-admin";
import { movementCatalogVersion } from "../src/lib/programming/coaching/movement-catalog";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import * as evaluateWeekModule from "../src/lib/programming/evaluate-week";
import { evaluateWeek } from "../src/lib/programming/evaluate-week";
import { getProgrammingMonthById } from "../src/lib/programming/store";
import {
  CELL_FORBIDDEN_KO,
  CELL_UNKNOWN_KO,
  VERSION_CONFLICT_KO,
  WEEK_BLOCKED_KO,
  decideWeekSave,
  loadWeekEditor,
  revertWeekEdit,
  saveWeekEdit,
} from "../src/lib/wod-edit";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import { POST as wodPost } from "@/app/api/admin/wod/route";

const WEEK = "2099-01-05";
const NOW = Date.parse("2099-01-05T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-wod-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.FIRST_ADMIN_EMAIL;
  resetDbConnection();
}

function planJson(): string {
  return (getSqlite().prepare("SELECT plan_json FROM programming_weeks WHERE week_start = ? AND status = 'active'").get(WEEK) as { plan_json: string }).plan_json;
}

function editionCount(): number {
  return (getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_editions WHERE week_start = ?").get(WEEK) as { c: number }).c;
}

beforeEach(() => {
  freshDb();
  vi.mocked(getCurrentUser).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetDbConnection();
});

describe("decideWeekSave", () => {
  it("allows a fatigue-cap sentence and blocks every other hard error", () => {
    expect(
      decideWeekSave({
        ok: false,
        errors: ["intent says lower load was reduced but the prescription is heavier than the fatigue limit"],
      }),
    ).toEqual({
      allow: true,
      hard: [],
      warnings: ["intent says lower load was reduced but the prescription is heavier than the fatigue limit"],
    });
    const mixed = decideWeekSave({
      ok: false,
      errors: ["high intensity days exceed the cap", "heavier than the fatigue limit"],
    });
    expect(mixed.allow).toBe(false);
    expect(mixed.hard).toEqual(["high intensity days exceed the cap"]);
    expect(decideWeekSave({ ok: true, errors: [] })).toEqual({ allow: true, hard: [], warnings: [] });
  });
});

describe("admin week edit", () => {
  it("rejects a member and keeps the original week", async () => {
    const member = registerUser("member@example.com", "password123");
    if ("error" in member) throw new Error(member.error);
    vi.mocked(getCurrentUser).mockResolvedValue(member.user);
    const res = await wodPost(
      new Request("http://localhost/api/admin/wod", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStart: WEEK, baseVersion: 0, reason_ko: "사유", cells: [] }),
      }),
    );
    expect(res.status).toBe(403);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_editions").get()).toEqual({ c: 0 });
  });

  it("versions an enum edit, blocks a failed week, and reverts as a new version", async () => {
    const admin = registerUser(FIRST_ADMIN_EMAIL, "password123");
    if ("error" in admin) throw new Error(admin.error);
    const stored = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const month = getProgrammingMonthById(stored.monthId);
    if (!month) throw new Error("month missing");
    const broken = structuredClone(stored.draft);
    for (const session of broken.sessions) {
      if (session.conditioning) session.conditioning.movements = [];
    }
    const illegal = evaluateWeek(broken, month.direction, stored.weekIndex, []);
    expect(illegal.ok).toBe(false);
    expect(decideWeekSave(illegal).allow).toBe(false);

    const editor = loadWeekEditor(WEEK);
    if (!editor || editor.cells.length === 0) throw new Error("editor has no cells");
    const original = planJson();
    const pin = getSqlite().prepare("SELECT catalog_version FROM week_catalog_pins WHERE week_id = ?").get(stored.id) as {
      catalog_version: string;
    };
    expect(pin.catalog_version).toBe(movementCatalogVersion());
    expect(editor.catalogVersion).toBe(pin.catalog_version);
    expect(editor.version).toBe(0);

    const cells = editor.cells.map((cell) => ({
      id: cell.id,
      movement_id: cell.movement_id,
      quantity_option: cell.quantity_option,
      note_ko: cell.note_ko,
    }));
    const forbidden = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 0,
      reason_ko: "단위를 넣음",
      cells,
      unit: "kg",
    });
    expect(forbidden).toEqual({ error: CELL_FORBIDDEN_KO, status: 400 });
    const unknown = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 0,
      reason_ko: "없는 동작",
      cells: cells.map((cell, index) => (index === 0 ? { ...cell, movement_id: "not_a_real_move" } : cell)),
    });
    expect(unknown).toEqual({ error: CELL_UNKNOWN_KO, status: 400 });
    expect(editionCount()).toBe(0);
    expect(planJson()).toBe(original);

    const target = cells[0]!;
    const saved = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 0,
      reason_ko: "노트만 바꿈",
      cells: cells.map((cell, index) => (index === 0 ? { ...cell, note_ko: "준비 운동 후 시작" } : cell)),
    });
    expect(saved).toMatchObject({ ok: true, version: 2 });
    expect(planJson()).toBe(original);
    const rows = getSqlite()
      .prepare("SELECT version, kind, editor_id, reason_ko, catalog_version, validation_json, changes_json, cells_json FROM wod_editions WHERE week_start = ? ORDER BY version")
      .all(WEEK) as Array<{
      version: number;
      kind: string;
      editor_id: number | null;
      reason_ko: string;
      catalog_version: string;
      validation_json: string;
      changes_json: string;
      cells_json: string;
    }>;
    expect(rows.map((row) => row.kind)).toEqual(["original", "edit"]);
    expect(rows[0]?.editor_id).toBeNull();
    expect(rows[1]?.editor_id).toBe(admin.user.id);
    expect(rows[1]?.reason_ko).toBe("노트만 바꿈");
    expect(rows[1]?.catalog_version).toBe(pin.catalog_version);
    const validation = JSON.parse(rows[1]!.validation_json) as { passed: boolean };
    expect(validation.passed).toBe(true);
    const changes = JSON.parse(rows[1]!.changes_json) as { cells: Array<{ field: string; before: string; after: string }> };
    expect(changes.cells).toEqual([
      expect.objectContaining({ field: "note_ko", before: "", after: "준비 운동 후 시작" }),
    ]);
    const editedCells = JSON.parse(rows[1]!.cells_json) as Array<{ id: string; source: string; note_ko: string }>;
    expect(editedCells.find((cell) => cell.id === target.id)?.source).toBe("admin_edit");
    expect(editedCells.filter((cell) => cell.id !== target.id).every((cell) => cell.source !== "admin_edit")).toBe(true);
    const originalSnapshot = rows[0]!.cells_json;
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_weeks WHERE week_start = ?").get(WEEK)).toEqual({ c: 1 });

    const conflict = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 0,
      reason_ko: "늦게 저장",
      cells: cells.map((cell, index) => (index === 0 ? { ...cell, note_ko: "다른 노트" } : cell)),
    });
    expect(conflict).toEqual({ error: VERSION_CONFLICT_KO, status: 409 });
    expect(editionCount()).toBe(2);

    const fatigue = vi.spyOn(evaluateWeekModule, "evaluateWeek").mockReturnValue({
      ok: false,
      status: "ADJUST",
      reason: "feedback",
      detail: "heavier than the fatigue limit",
      errors: ["intent says lower load was reduced but the prescription is heavier than the fatigue limit"],
      issues: [],
      normalizations: [],
    } as never);
    const warned = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 2,
      reason_ko: "피로 경고만",
      cells: cells.map((cell, index) => (index === 0 ? { ...cell, note_ko: "피로 경고 확인" } : cell)),
    });
    expect(warned).toMatchObject({
      ok: true,
      version: 3,
      warnings: ["intent says lower load was reduced but the prescription is heavier than the fatigue limit"],
    });
    fatigue.mockReturnValue({
      ok: false,
      status: "BLOCK",
      reason: "rule_break",
      detail: "high intensity days exceed the cap",
      errors: ["high intensity days exceed the cap", "heavier than the fatigue limit"],
      issues: [],
      normalizations: [],
    } as never);
    const blocked = saveWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 3,
      reason_ko: "하드 오류",
      cells: cells.map((cell, index) => (index === 0 ? { ...cell, note_ko: "막혀야 함" } : cell)),
    });
    expect(blocked).toMatchObject({ error: WEEK_BLOCKED_KO, status: 400 });
    expect(editionCount()).toBe(3);
    expect(planJson()).toBe(original);
    fatigue.mockRestore();

    const reverted = revertWeekEdit(admin.user.id, {
      weekStart: WEEK,
      baseVersion: 3,
      targetVersion: 1,
      reason_ko: "원본으로",
    });
    expect(reverted).toMatchObject({ ok: true, version: 4 });
    const kinds = getSqlite()
      .prepare("SELECT version, kind FROM wod_editions WHERE week_start = ? ORDER BY version")
      .all(WEEK) as Array<{ version: number; kind: string }>;
    expect(kinds.map((row) => row.kind)).toEqual(["original", "edit", "edit", "revert"]);
    expect(getSqlite().prepare("SELECT cells_json FROM wod_editions WHERE week_start = ? AND version = 1").get(WEEK)).toEqual({
      cells_json: originalSnapshot,
    });
    const current = loadWeekEditor(WEEK);
    expect(current?.version).toBe(4);
    expect(current?.cells.find((cell) => cell.id === target.id)?.note_ko).toBe("");
    expect(planJson()).toBe(original);
    const actions = listAudit().map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(["wod_edit", "wod_revert"]));
    expect(JSON.stringify(listAudit())).not.toMatch(/password|token|sk-/);
  }, 180_000);
});
