import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { classWeekToTrain } from "../src/lib/month-plan/calendar";
import { adminEngineErrorText, adminEngineWeek } from "../src/lib/programming/admin-tools";
import { ensureProgrammingMonth, regenerateProgrammingWeek } from "../src/lib/programming/engine";
import { markPipelineFailureRecorded, pipelineFailureRecorded, redactSecretText } from "../src/lib/programming/store";

const NOW = Date.parse("2099-10-13T04:00:00.000Z");
const FAKE_KEY = "sk-testredactiontoken";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

vi.mock("@/lib/programming/admin-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/programming/admin-tools")>();
  return { ...actual, runAdminAction: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import { runAdminAction } from "@/lib/programming/admin-tools";
import { POST } from "@/app/api/admin/engine/route";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-pipeline-fail-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.SHADOW_GENERATOR;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
  getSqlite();
}

describe("pipeline failure log", () => {
  afterEach(() => {
    delete process.env.MONTH_PLAN_MODEL_KEY;
    vi.mocked(getCurrentUser).mockReset();
    vi.mocked(runAdminAction).mockReset();
    resetDbConnection();
  });

  it("keeps a failure row when regenerate throws before the model", async () => {
    freshDb();
    const month = await ensureProgrammingMonth("2099-10-01", { nowMs: NOW, key: null });
    getSqlite()
      .prepare(
        `INSERT INTO programming_weeks (
           month_id, week_index, week_start, intent_json, plan_json, display_json, input_summary_json,
           generation_source, fallback_reason, generated_at, engine_version, created_at, status,
           generation_version, generation_attempt, prompt_version, rules_version, generation_timestamp,
           input_summary_version
         ) VALUES (?, 1, '2099-10-05', '{}', '{', '{}', '{}', 'fallback', 'timeout', ?, 'test', ?, 'active', 1, 1, 'weekly-program-v1', 'rules-v1', ?, 'v1')`,
      )
      .run(month.id, NOW, NOW, NOW);

    await expect(regenerateProgrammingWeek("2099-10-12", { nowMs: NOW, key: null })).rejects.toThrow();

    const adopted = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM programming_weeks WHERE week_start = '2099-10-12'")
      .get() as { c: number };
    expect(adopted.c).toBe(0);

    const row = getSqlite()
      .prepare(
        `SELECT scope, scope_key, plan_id, generation_attempt, prompt_version, raw_json
         FROM programming_generation_logs
         WHERE prompt_version = 'pipeline-failure-v1'`,
      )
      .get() as {
      scope: string;
      scope_key: string;
      plan_id: number | null;
      generation_attempt: number;
      prompt_version: string;
      raw_json: string;
    };
    expect(row.scope).toBe("week");
    expect(row.scope_key).toBe("2099-10-12");
    expect(row.plan_id).toBeNull();
    expect(row.generation_attempt).toBe(0);
    const body = JSON.parse(row.raw_json) as { failed: boolean; stage: string; reason: string; message: string };
    expect(body.failed).toBe(true);
    expect(body.stage).toBe("summary");
    expect(body.reason).toBe("SyntaxError");
    expect(body.message.length).toBeGreaterThan(0);
  });

  it("redacts key text and names the failed action in Korean", () => {
    process.env.MONTH_PLAN_MODEL_KEY = FAKE_KEY;
    const leaked = `model refused ${FAKE_KEY} Bearer ${FAKE_KEY}`;
    const safe = redactSecretText(leaked);
    expect(safe).not.toContain(FAKE_KEY);
    expect(safe).toContain("[redacted]");
    expect(safe).not.toMatch(/Bearer\s+sk-/);

    const error = new Error(leaked);
    expect(pipelineFailureRecorded(error)).toBe(false);
    markPipelineFailureRecorded(error);
    expect(pipelineFailureRecorded(error)).toBe(true);

    expect(adminEngineWeek("regenerate-week", NOW)).toBe("2099-10-12");
    expect(adminEngineWeek("generate-month", NOW)).toBeNull();
    const sentence = adminEngineErrorText("regenerate-week", "2099-10-12", safe);
    expect(sentence).toContain("「이 주 다시 만들기」 실행이 실패했습니다.");
    expect(sentence).toContain("대상 주는 2099-10-12");
    expect(sentence).toContain(safe);
    expect(sentence).not.toContain(FAKE_KEY);
  });

  it("logs the action, week, message, and stack from the engine route catch", async () => {
    freshDb();
    process.env.MONTH_PLAN_MODEL_KEY = FAKE_KEY;
    vi.mocked(getCurrentUser).mockResolvedValue({
      id: 1,
      email: "admin@example.com",
      unit: "kg",
      currentProgram: null,
      lastSession: null,
      sex: null,
      isAdmin: true,
    });
    const failure = new Error(`pipeline stopped ${FAKE_KEY}`);
    failure.stack = `Error: pipeline stopped ${FAKE_KEY}\n    at writeProgrammingWeek`;
    vi.mocked(runAdminAction).mockRejectedValue(failure);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(
      new Request("http://localhost/api/admin/engine", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "regenerate-week" }),
      }),
    );
    const payload = (await res.json()) as { error: string; action: string; week_start: string };
    const week = classWeekToTrain(Date.now());
    expect(res.status).toBe(400);
    expect(payload.action).toBe("regenerate-week");
    expect(payload.week_start).toBe(week);
    expect(payload.error).toContain("「이 주 다시 만들기」 실행이 실패했습니다.");
    expect(payload.error).toContain(`대상 주는 ${week}`);
    expect(payload.error).not.toContain(FAKE_KEY);
    expect(payload.error).toContain("[redacted]");

    const logged = spy.mock.calls.map((call) => call.map((part) => String(part)).join(" ")).join("\n");
    expect(logged).toContain("[admin-engine]");
    expect(logged).toContain("regenerate-week");
    expect(logged).toContain(week);
    expect(logged).toContain("writeProgrammingWeek");
    expect(logged).not.toContain(FAKE_KEY);
    spy.mockRestore();
  });
});
