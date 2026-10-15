import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ENGINE_DRY_ACTIONS, ENGINE_LIVE_ACTIONS, ENGINE_WRITE_ACTIONS } from "../src/lib/programming/admin-actions";
import { ENGINE_CASE_HELP, ENGINE_HELP } from "../src/lib/programming/admin-help";
import {
  engineCopyNote,
  engineNextAction,
  formatEngineTime,
  memberWodSentence,
  readEngineAdminStatus,
} from "../src/lib/programming/admin-status";
import { ensureProgrammingMonth } from "../src/lib/programming/engine";

const NOW = Date.parse("2099-10-13T04:00:00.000Z");
const SECRET = /sk-|MONTH_PLAN_MODEL_KEY|API_KEY|Bearer /;

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-engine-help-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.SHADOW_GENERATOR;
  resetDbConnection();
  getSqlite();
}

describe("engine admin help", () => {
  afterEach(() => {
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.SHADOW_GENERATOR;
    resetDbConnection();
  });

  it("explains every button with the five facts and does not print a key", () => {
    const actions = [...ENGINE_LIVE_ACTIONS, ...ENGINE_DRY_ACTIONS, ...ENGINE_WRITE_ACTIONS].map(([action]) => action);
    expect(Object.keys(ENGINE_HELP).sort()).toEqual([...actions].sort());
    for (const help of [...Object.values(ENGINE_HELP), ENGINE_CASE_HELP]) {
      expect(help.short.length).toBeGreaterThan(10);
      expect(help.does.length).toBeGreaterThan(help.short.length / 2);
      for (const fact of [help.does, help.when, help.effect, help.cost, help.undo]) {
        expect(fact.length).toBeGreaterThan(8);
        expect(fact).not.toMatch(SECRET);
      }
      expect(help.short).not.toMatch(SECRET);
    }
  });

  it("names one next action from the stored month and week", () => {
    expect(engineNextAction({ monthGenerated: false, weekGenerated: false })).toBe("이번 달 계획 만들기를 누르세요");
    expect(engineNextAction({ monthGenerated: true, weekGenerated: false })).toBe("다음 주 만들기를 누르세요");
    expect(engineNextAction({ monthGenerated: true, weekGenerated: true })).toBe("이미 생성됨, 할 일 없음");
    expect(formatEngineTime(Date.parse("2099-10-13T04:00:00.000Z"))).toBe("2099-10-13 13:00 KST");
    expect(engineCopyNote(false)).toContain("복사됩니다");
    expect(engineCopyNote(true)).toContain("SHADOW_GENERATOR");
  });

  it("says the member screen is an existing seed when no programming week is linked", () => {
    expect(
      memberWodSentence({
        weekStart: "2099-10-12",
        programming: null,
        classWeekId: 4,
      }),
    ).toContain("기존 시드");
    expect(
      memberWodSentence({
        weekStart: "2099-10-12",
        programming: { id: 2, classWeekId: 4, origin: "model", promptVersion: "coaching-pipeline-v6" },
        classWeekId: 4,
      }),
    ).toContain("model");
    expect(
      memberWodSentence({
        weekStart: "2099-10-12",
        programming: { id: 2, classWeekId: null, origin: "fallback", promptVersion: "weekly-program-v10" },
        classWeekId: 4,
      }),
    ).toContain("기존 시드");
  });

  it("reads an empty 2099 week as not generated and does not write", () => {
    freshDb();
    const before = (getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_months").get() as { c: number }).c;
    const status = readEngineAdminStatus(NOW);
    expect(status.month).toMatchObject({ start: "2099-10-01", generated: false, origin: "없음" });
    expect(status.week).toMatchObject({ start: "2099-10-12", generated: false, origin: "없음" });
    expect(status.nextAction).toBe("이번 달 계획 만들기를 누르세요");
    expect(status.memberWod).toContain("없습니다");
    expect((getSqlite().prepare("SELECT COUNT(*) AS c FROM programming_months").get() as { c: number }).c).toBe(before);
  });

  it("treats a class week without a programming week as an existing seed", async () => {
    freshDb();
    getSqlite()
      .prepare(
        `INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at)
         VALUES (2, '2099-10-12', 'm', ?, ?)`,
      )
      .run(JSON.stringify({ days: [] }), NOW);
    const status = readEngineAdminStatus(NOW);
    expect(status.week.origin).toBe("기존 시드");
    expect(status.week.generated).toBe(false);
    expect(status.memberWod).toContain("기존 시드");
    expect(status.nextAction).toBe("이번 달 계획 만들기를 누르세요");

    await ensureProgrammingMonth("2099-10-01", { nowMs: NOW, key: null });
    const ready = readEngineAdminStatus(NOW);
    expect(ready.month.generated).toBe(true);
    expect(ready.month.origin).toBe("fallback");
    expect(ready.month.promptVersion).toBe("monthly-program-v4");
    expect(ready.nextAction).toBe("다음 주 만들기를 누르세요");
  });
});
