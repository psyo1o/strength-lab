import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ENGINE_BUTTONS, enginePanelText, engineRequestBody } from "../src/lib/programming/admin-actions";

const NOW = Date.parse("2099-10-13T04:00:00.000Z");
const FAKE_KEY = "sk-buttonpathtestkey";
const SCREEN = fs.readFileSync(path.join(process.cwd(), "src/components/EngineAdminConsole.tsx"), "utf8");

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import { POST } from "@/app/api/admin/engine/route";

const fetchMock = vi.fn(async () => new Response("mocked-failure", { status: 500 }));
let errorSpy: ReturnType<typeof vi.spyOn>;

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-button-path-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACH_MODEL_PROVIDER;
  delete process.env.COACHING_MODEL;
  delete process.env.COACH_MODEL_NAME;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.SHADOW_GENERATOR;
  delete process.env.FALLBACK_WEEK_DISPLAY;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
  getSqlite();
}

function useFakeKey() {
  process.env.MONTH_PLAN_MODEL_KEY = FAKE_KEY;
}

function counts() {
  const db = getSqlite();
  const tables = [
    "programming_months",
    "programming_weeks",
    "programming_generation_logs",
    "programming_evaluations",
    "class_weeks",
  ] as const;
  const out = {} as Record<(typeof tables)[number], number>;
  for (const table of tables) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }
  return out;
}

function weeks() {
  return getSqlite()
    .prepare(
      `SELECT week_start, status, generation_source, fallback_reason, prompt_version
       FROM programming_weeks ORDER BY id`,
    )
    .all() as {
    week_start: string;
    status: string;
    generation_source: string;
    fallback_reason: string | null;
    prompt_version: string;
  }[];
}

function months() {
  return getSqlite()
    .prepare(
      `SELECT month_start, status, generation_source, fallback_reason, prompt_version
       FROM programming_months ORDER BY id`,
    )
    .all() as {
    month_start: string;
    status: string;
    generation_source: string;
    fallback_reason: string | null;
    prompt_version: string;
  }[];
}

function logVersions(): string[] {
  return (
    getSqlite().prepare("SELECT DISTINCT prompt_version FROM programming_generation_logs").all() as { prompt_version: string }[]
  ).map((row) => row.prompt_version);
}

function failureStages(): { scope_key: string; stage: string; reason: string }[] {
  const rows = getSqlite()
    .prepare("SELECT scope_key, raw_json FROM programming_generation_logs WHERE prompt_version = 'pipeline-failure-v1'")
    .all() as { scope_key: string; raw_json: string }[];
  return rows.map((row) => {
    const body = JSON.parse(row.raw_json) as { stage: string; reason: string };
    return { scope_key: row.scope_key, stage: body.stage, reason: body.reason };
  });
}

function insertBrokenMonth(monthStart: string) {
  getSqlite()
    .prepare(
      `INSERT INTO programming_months (
         month_start, scheme, direction_json, input_summary_json, generation_source, generated_at, engine_version,
         created_at, status, generation_version, generation_attempt, prompt_version, rules_version,
         generation_timestamp, input_summary_version
       ) VALUES (?, '531', '{', '{}', 'fallback', ?, 'test', ?, 'active', 1, 1, 'monthly-program-v1', 'rules-v1', ?, 'v1')`,
    )
    .run(monthStart, NOW, NOW, NOW);
}

function insertBrokenWeek(monthId: number, weekStart: string) {
  getSqlite()
    .prepare(
      `INSERT INTO programming_weeks (
         month_id, week_index, week_start, intent_json, plan_json, display_json, input_summary_json,
         generation_source, fallback_reason, generated_at, engine_version, created_at, status,
         generation_version, generation_attempt, prompt_version, rules_version, generation_timestamp,
         input_summary_version
       ) VALUES (?, 1, ?, '{}', '{', '{}', '{}', 'fallback', 'timeout', ?, 'test', ?, 'active', 1, 1,
         'weekly-program-v1', 'rules-v1', ?, 'v1')`,
    )
    .run(monthId, weekStart, NOW, NOW, NOW);
}

function monthId(monthStart: string): number {
  return (getSqlite().prepare("SELECT id FROM programming_months WHERE month_start = ?").get(monthStart) as { id: number }).id;
}

function logged(): string {
  return errorSpy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
}

async function post(action: string, actualCase: "" | "a" | "b" = "") {
  const payload = engineRequestBody(action, actualCase);
  const res = await POST(
    new Request("http://localhost/api/admin/engine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  const body = (await res.json().catch(() => null)) as { error?: string; wrote?: boolean } | null;
  return { payload, res, body, panel: enginePanelText(res.ok, body) };
}

function expectButton(action: string, label: string) {
  expect(ENGINE_BUTTONS).toContainEqual([action, label]);
  expect(SCREEN).toContain("engineRequestBody(action, actualCase)");
  expect(SCREEN).toContain('fetch("/api/admin/engine"');
  expect(engineRequestBody(action).action).toBe(action);
}

function expectFailureOnScreen(action: string, label: string, panel: { error: string; result: string }) {
  expect(panel.error).toContain(`「${label}」 실행이 실패했습니다.`);
  expect(panel.result).toBe(panel.error);
  const text = logged();
  expect(text).toContain("[admin-engine]");
  expect(text).toContain(`"action":"${action}"`);
  expect(text).not.toContain(FAKE_KEY);
}

describe("engine button paths", () => {
  beforeEach(() => {
    freshDb();
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      unit: "kg",
      currentProgram: null,
      lastSession: null,
      sex: null,
      isAdmin: true,
      name: null,
      birthDate: null,
      status: "active",
      role: "admin",
      rejectionReason: null,
    });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(Date, "now").mockReturnValue(NOW);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.MONTH_PLAN_MODEL_KEY;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetDbConnection();
  });

  it("이번 달 계획 만들기 posts generate-month through authorMonth", async () => {
    expectButton("generate-month", "이번 달 계획 만들기");
    insertBrokenMonth("2099-09-01");
    const failed = await post("generate-month");
    expect(failed.payload).toEqual({ action: "generate-month", actualCase: null });
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("generate-month", "이번 달 계획 만들기", failed.panel);
    expect(months().some((row) => row.month_start === "2099-10-01")).toBe(false);
    expect(failureStages()).toEqual([]);

    getSqlite().prepare("DELETE FROM programming_months WHERE month_start = '2099-09-01'").run();
    errorSpy.mockClear();
    fetchMock.mockClear();
    const before = counts();
    const ok = await post("generate-month");
    expect(ok.res.status).toBe(200);
    expect(ok.panel.error).toBe("");
    expect(ok.body).toMatchObject({ wrote: true, month_start: "2099-10-01", generation_source: "fallback" });
    expect(months()).toEqual([
      {
        month_start: "2099-10-01",
        status: "active",
        generation_source: "fallback",
        fallback_reason: "no_model",
        prompt_version: "monthly-program-v4",
      },
    ]);
    expect(counts().programming_months).toBe(before.programming_months + 1);
    expect(counts().programming_weeks).toBe(before.programming_weeks);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("다음 주 만들기 posts generate-next-week through the coaching pipeline", async () => {
    expectButton("generate-next-week", "다음 주 만들기");
    useFakeKey();
    const before = counts();
    const ok = await post("generate-next-week");
    expect(ok.payload.action).toBe("generate-next-week");
    expect(ok.res.status).toBe(200);
    expect(ok.panel.error).toBe("");
    expect(ok.body).toMatchObject({ wrote: true, week_start: "2099-10-12", generation_source: "fallback" });
    expect(weeks()).toEqual([
      {
        week_start: "2099-10-12",
        status: "failed",
        generation_source: "fallback",
        fallback_reason: "http_error;final_validation_failed",
        prompt_version: "coaching-pipeline-v6",
      },
    ]);
    expect(months()[0]).toMatchObject({ month_start: "2099-10-01", prompt_version: "monthly-program-v4", generation_source: "fallback" });
    expect(logVersions()).toEqual(expect.arrayContaining(["monthly-coach-v11", "weekly-coach-v5", "head-coach-v12", "skeleton-v1"]));
    expect(counts().programming_weeks).toBe(before.programming_weeks + 1);
    expect(counts().class_weeks).toBe(before.class_weeks);
    expect(fetchMock).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    insertBrokenWeek(monthId("2099-10-01"), "2099-10-05");
    errorSpy.mockClear();
    const failed = await post("generate-next-week");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("generate-next-week", "다음 주 만들기", failed.panel);
    expect(failureStages()).toContainEqual({ scope_key: "2099-10-12", stage: "summary", reason: "SyntaxError" });
    expect(weeks().filter((row) => row.week_start === "2099-10-12")).toHaveLength(1);
  }, 60_000);

  it("이 주 다시 만들기 posts regenerate-week through the coaching pipeline", async () => {
    expectButton("regenerate-week", "이 주 다시 만들기");
    useFakeKey();
    const ok = await post("regenerate-week");
    expect(ok.payload).toEqual({ action: "regenerate-week", actualCase: null });
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, week_start: "2099-10-12", generation_source: "fallback" });
    expect(weeks()[0]).toMatchObject({
      week_start: "2099-10-12",
      status: "failed",
      prompt_version: "coaching-pipeline-v6",
      fallback_reason: "http_error;final_validation_failed",
    });
    expect(logVersions()).toEqual(expect.arrayContaining(["monthly-coach-v11", "weekly-coach-v5", "skeleton-v1"]));
    expect(fetchMock).toHaveBeenCalled();

    insertBrokenWeek(monthId("2099-10-01"), "2099-10-05");
    const kept = counts().programming_weeks;
    errorSpy.mockClear();
    const failed = await post("regenerate-week");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("regenerate-week", "이 주 다시 만들기", failed.panel);
    expect(failureStages()).toContainEqual({ scope_key: "2099-10-12", stage: "summary", reason: "SyntaxError" });
    expect(counts().programming_weeks).toBe(kept);
  }, 60_000);

  it("검증 실행 posts validate and does not write", async () => {
    expectButton("validate", "검증 실행");
    const before = counts();
    const missing = await post("validate");
    expect(missing.payload.action).toBe("validate");
    expect(missing.res.status).toBe(200);
    expect(missing.body).toMatchObject({ ok: false, error: "검증할 주가 없습니다." });
    expect(missing.panel.error).toBe("검증할 주가 없습니다.");
    expect(missing.panel.result).toBe("검증할 주가 없습니다.");
    expect(logged()).toContain('"action":"validate"');
    expect(counts()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();

    const { ensureProgrammingMonth, ensureProgrammingWeek } = await import("../src/lib/programming/engine");
    await ensureProgrammingMonth("2099-10-01", { nowMs: NOW, key: null });
    await ensureProgrammingWeek("2099-10-12", { nowMs: NOW, key: null });
    const ready = counts();
    errorSpy.mockClear();
    fetchMock.mockClear();
    const checked = await post("validate");
    expect(checked.res.status).toBe(200);
    expect(checked.panel.error).toBe("");
    expect(checked.body).toMatchObject({ wrote: false, week_start: "2099-10-12" });
    expect(checked.panel.result).toContain("2099-10-12");
    expect(counts()).toEqual(ready);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("폴백 시험 posts fallback-test and stores a coaching fallback week", async () => {
    expectButton("fallback-test", "폴백 시험");
    const ok = await post("fallback-test");
    expect(ok.payload.action).toBe("fallback-test");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, week_start: "2099-10-12", generation_source: "fallback" });
    expect(String((ok.body as { fallback_reason?: string }).fallback_reason)).toContain("http_error");
    expect(weeks()[0]).toMatchObject({ prompt_version: "coaching-pipeline-v6", status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();

    insertBrokenWeek(monthId("2099-10-01"), "2099-10-05");
    errorSpy.mockClear();
    const failed = await post("fallback-test");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("fallback-test", "폴백 시험", failed.panel);
    expect(failureStages()).toContainEqual({ scope_key: "2099-10-12", stage: "summary", reason: "SyntaxError" });
  }, 60_000);

  it("이번 달 평가 posts evaluate-month and skips the model", async () => {
    expectButton("evaluate-month", "이번 달 평가");
    const before = counts();
    const missing = await post("evaluate-month");
    expect(missing.payload.action).toBe("evaluate-month");
    expect(missing.res.status).toBe(200);
    expect(missing.body).toMatchObject({ wrote: false, error: "달을 찾지 못했습니다." });
    expect(missing.panel.result).toBe("달을 찾지 못했습니다.");
    expect(logged()).toContain('"action":"evaluate-month"');
    expect(counts()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();

    const { ensureProgrammingMonth } = await import("../src/lib/programming/engine");
    await ensureProgrammingMonth("2099-10-01", { nowMs: NOW, key: null });
    errorSpy.mockClear();
    const ready = counts();
    const ok = await post("evaluate-month");
    expect(ok.res.status).toBe(200);
    expect(ok.panel.error).toBe("");
    expect(ok.body).toMatchObject({ wrote: true });
    expect(counts().programming_evaluations).toBe(ready.programming_evaluations + 1);
    expect(counts().programming_months).toBe(ready.programming_months);
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);

  it("다음 달 만들기 posts generate-next-month through authorMonth", async () => {
    expectButton("generate-next-month", "다음 달 만들기");
    insertBrokenMonth("2099-10-01");
    const failed = await post("generate-next-month");
    expect(failed.payload.action).toBe("generate-next-month");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("generate-next-month", "다음 달 만들기", failed.panel);
    expect(months().some((row) => row.month_start === "2099-11-01")).toBe(false);

    getSqlite().prepare("DELETE FROM programming_months").run();
    errorSpy.mockClear();
    fetchMock.mockClear();
    const ok = await post("generate-next-month");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, month_start: "2099-11-01", generation_source: "fallback" });
    expect(months()[0]).toMatchObject({
      month_start: "2099-11-01",
      prompt_version: "monthly-program-v4",
      generation_source: "fallback",
      fallback_reason: "no_model",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  }, 30_000);

  it("달 드라이런 posts dry-run-month and does not write", async () => {
    expectButton("dry-run-month", "달 드라이런");
    useFakeKey();
    const before = counts();
    const ok = await post("dry-run-month");
    expect(ok.payload.action).toBe("dry-run-month");
    expect(ok.res.status).toBe(200);
    expect(ok.panel.error).toBe("");
    expect(ok.body).toMatchObject({ wrote: false, scope: "month", prompt_version: "monthly-program-v4" });
    expect(ok.panel.result).toContain("monthly-program-v4");
    expect(ok.panel.result).toContain("fallback");
    expect(counts()).toEqual(before);
    expect(fetchMock).toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    insertBrokenMonth("2099-09-01");
    const mid = counts();
    errorSpy.mockClear();
    const failed = await post("dry-run-month");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("dry-run-month", "달 드라이런", failed.panel);
    expect(counts()).toEqual(mid);
  }, 30_000);

  it("주 드라이런 posts dry-run-week and does not write", async () => {
    expectButton("dry-run-week", "주 드라이런");
    useFakeKey();
    const before = counts();
    const ok = await post("dry-run-week", "a");
    expect(ok.payload).toEqual({ action: "dry-run-week", actualCase: "a" });
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({
      wrote: false,
      scope: "week",
      prompt_version: "weekly-program-v10",
      actual_case: "a",
    });
    expect(ok.panel.result).toContain("weekly-program-v10");
    expect(counts()).toEqual(before);
    expect(fetchMock).toHaveBeenCalled();

    const { ensureProgrammingMonth } = await import("../src/lib/programming/engine");
    const month = await ensureProgrammingMonth("2099-10-01", { nowMs: NOW, key: null });
    insertBrokenWeek(month.id, "2099-10-05");
    const mid = counts();
    errorSpy.mockClear();
    const failed = await post("dry-run-week", "a");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("dry-run-week", "주 드라이런", failed.panel);
    expect(counts()).toEqual(mid);
  }, 30_000);

  it("유사도 시험 posts probe-similarity and does not write", async () => {
    expectButton("probe-similarity", "유사도 시험");
    const before = counts();
    const ok = await post("probe-similarity");
    expect(ok.payload.action).toBe("probe-similarity");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: false, action: "probe-similarity", near_copy: "FAIL", different: "PASS" });
    expect(ok.panel.error).toBe("");
    expect(ok.panel.result).toContain("FAIL");
    expect(counts()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("모델 주 저장 posts save-model-week onto the 2099 probe week", async () => {
    expectButton("save-model-week", "모델 주 저장 (2099 시험)");
    useFakeKey();
    const ok = await post("save-model-week");
    expect(ok.payload.action).toBe("save-model-week");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({
      wrote: true,
      action: "save-model-week",
      mode: "probe",
      week_start: "2099-08-03",
      generation_source: "fallback",
    });
    expect(weeks()[0]).toMatchObject({
      week_start: "2099-08-03",
      status: "failed",
      prompt_version: "coaching-pipeline-v6",
    });
    expect(weeks().some((row) => row.week_start === "2099-10-12")).toBe(false);
    expect(fetchMock).toHaveBeenCalled();

    insertBrokenWeek(monthId("2099-08-01"), "2099-07-27");
    errorSpy.mockClear();
    const failed = await post("save-model-week");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("save-model-week", "모델 주 저장 (2099 시험)", failed.panel);
    expect(failureStages()).toContainEqual({ scope_key: "2099-08-03", stage: "summary", reason: "SyntaxError" });
  }, 60_000);

  it("실패 후 폴백 저장 posts save-forced-fallback for this class week", async () => {
    expectButton("save-forced-fallback", "실패 후 폴백 저장");
    const ok = await post("save-forced-fallback");
    expect(ok.payload.action).toBe("save-forced-fallback");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, action: "save-forced-fallback", week_start: "2099-10-12", generation_source: "fallback" });
    expect(weeks()[0]).toMatchObject({ week_start: "2099-10-12", prompt_version: "coaching-pipeline-v6", status: "failed" });
    expect(fetchMock).not.toHaveBeenCalled();

    insertBrokenWeek(monthId("2099-10-01"), "2099-10-05");
    errorSpy.mockClear();
    const failed = await post("save-forced-fallback");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("save-forced-fallback", "실패 후 폴백 저장", failed.panel);
    expect(failureStages()).toContainEqual({ scope_key: "2099-10-12", stage: "summary", reason: "SyntaxError" });
  }, 60_000);

  it("수행 집계 시험 posts seed-week-actual and removes the probe rows", async () => {
    expectButton("seed-week-actual", "수행 집계 시험 후 삭제");
    const before = counts();
    const ok = await post("seed-week-actual");
    expect(ok.payload.action).toBe("seed-week-actual");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, action: "seed-week-actual", cleaned: true, week_start: "2099-08-04", member_rows_unchanged: true });
    expect(counts()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    insertBrokenMonth("2099-07-01");
    errorSpy.mockClear();
    const failed = await post("seed-week-actual");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("seed-week-actual", "수행 집계 시험 후 삭제", failed.panel);
    expect(months().some((row) => row.month_start === "2099-08-01")).toBe(false);
    expect(weeks().some((row) => row.week_start === "2099-08-04")).toBe(false);
  }, 60_000);

  it("한 달 평가 시험 posts simulate-month-cycle and removes the probe rows", async () => {
    expectButton("simulate-month-cycle", "한 달 평가 시험 후 삭제");
    const before = counts();
    const ok = await post("simulate-month-cycle");
    expect(ok.payload.action).toBe("simulate-month-cycle");
    expect(ok.res.status).toBe(200);
    expect(ok.body).toMatchObject({ wrote: true, action: "simulate-month-cycle", cleaned: true });
    expect((ok.body as { next_month_dry_run?: { wrote?: boolean; month_start?: string } }).next_month_dry_run).toMatchObject({
      wrote: false,
      month_start: "2099-04-01",
    });
    expect(counts()).toEqual(before);
    expect(fetchMock).not.toHaveBeenCalled();

    insertBrokenMonth("2099-02-01");
    errorSpy.mockClear();
    const failed = await post("simulate-month-cycle");
    expect(failed.res.status).toBe(400);
    expectFailureOnScreen("simulate-month-cycle", "한 달 평가 시험 후 삭제", failed.panel);
    expect(months().some((row) => row.month_start === "2099-03-01" || row.month_start === "2099-04-01")).toBe(false);
  }, 120_000);
});
