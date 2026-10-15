import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { classWeekToTrain } from "../src/lib/month-plan/calendar";
import { engineRequestBody } from "../src/lib/programming/admin-actions";
import { readEngineAdminStatus } from "../src/lib/programming/admin-status";
import { runAdminAction } from "../src/lib/programming/admin-tools";
import { JSON_OBJECT } from "../src/lib/programming/coaching/contract";
import { askCoach, isOutputLimitFailure, raisedOutputLimit } from "../src/lib/programming/coaching/llm";
import { restDayFor } from "../src/lib/programming/coaching/goal-table";
import { extractWeekRules, weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { insertProgrammingWeek } from "../src/lib/programming/store";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { FetchLike } from "../src/lib/programming/model";

const WEEK = "2099-09-07";
const NOW = Date.parse(`${WEEK}T03:00:00.000Z`);
const CARD_NOW = Date.parse("2099-10-13T04:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-sunday-rest-"));
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

function tokensOf(init: RequestInit | undefined): number {
  const body = JSON.parse(String(init?.body ?? "{}")) as { max_completion_tokens?: number };
  return body.max_completion_tokens ?? 0;
}

describe("sunday rest and regenerate-week skeleton lock", () => {
  afterEach(() => {
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.LONGITUDINAL_PLANNING;
    delete process.env.COACHING_PIPELINE;
    resetDbConnection();
  });

  it("keeps every default class week on Sunday rest and rejects another rest day", () => {
    expect([1, 2, 3, 4].map((week) => restDayFor(week as 1, week === 4 ? "deload" : "accumulation"))).toEqual([
      "sun",
      "sun",
      "sun",
      "sun",
    ]);
    const month = fallbackMonth({ summary_ko: "블록을 유지합니다.", next_scheme: "531", strength_method: "531" });
    const plan = planCoachedWeek({ month, weekIndex: 2 });
    const rules = extractWeekRules({ month, weekIndex: 2 });
    expect(rules.fixed_rest_day).toBe("sun");
    expect(weekPlanErrors(plan, rules)).toEqual([]);
    const moved = structuredClone(plan);
    const sun = moved.days.find((day) => day.day === "sun")!;
    const wed = moved.days.find((day) => day.day === "wed")!;
    sun.primary_training = "mixed_modal";
    sun.recovery_role = "train";
    wed.primary_training = "rest";
    wed.recovery_role = "rest";
    expect(weekPlanErrors(moved, rules).join(" ")).toMatch(/rest day must be sun/);
  });

  it("retries an output-limit error once at a higher cap and does not repeat the same cap", async () => {
    expect(isOutputLimitFailure("http_error", "max_tokens or model output limit was reached")).toBe(true);
    expect(isOutputLimitFailure("http_error", "upstream unavailable")).toBe(false);
    expect(raisedOutputLimit(1800)).toBeGreaterThan(1800);
    const bodies: number[] = [];
    const limited: FetchLike = async (_url, init) => {
      bodies.push(tokensOf(init));
      if (bodies.length === 1) {
        return new Response("max_tokens or model output limit was reached", { status: 400 });
      }
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const raised = await askCoach({
      agent: "conditioning",
      user: { day: "sun" },
      key: "test-key",
      fetchImpl: limited,
      timeoutMs: 1000,
      maxTokens: 1800,
      promptVersion: "conditioning-coach-v7",
      runId: "output-limit",
      format: JSON_OBJECT,
      retryTransport: false,
    });
    expect(raised.ok).toBe(true);
    expect(bodies).toEqual([1800, raisedOutputLimit(1800)]);
    const stuck: number[] = [];
    const stillLimited: FetchLike = async (_url, init) => {
      stuck.push(tokensOf(init));
      return new Response("max_tokens or model output limit was reached", { status: 400 });
    };
    const failed = await askCoach({
      agent: "conditioning",
      user: { day: "sun" },
      key: "test-key",
      fetchImpl: stillLimited,
      timeoutMs: 1000,
      maxTokens: 1800,
      promptVersion: "conditioning-coach-v7",
      runId: "output-limit-stop",
      format: JSON_OBJECT,
      retryTransport: true,
    });
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("output_limit");
    expect(stuck).toEqual([1800, raisedOutputLimit(1800)]);
  });

  it("shows the latest programming week prompt and source, including a failed regenerate", async () => {
    freshDb();
    const week = await ensureProgrammingWeek("2099-10-12", { nowMs: CARD_NOW, key: null });
    insertProgrammingWeek({
      monthId: week.monthId,
      weekIndex: week.weekIndex,
      weekStart: week.weekStart,
      draft: week.draft,
      display: week.display,
      inputSummaryJson: week.inputSummaryJson,
      mode: "create",
      generationSource: "fallback",
      fallbackReason: "weekly_schema",
      generatedAt: week.generatedAt + 1,
      modelName: "gpt-5.4-nano",
      promptVersion: "weekly-coach-v5",
      rulesVersion: week.rulesVersion,
      inputSummaryVersion: week.inputSummaryVersion,
      generationAttempt: week.generationAttempt + 1,
      responses: [],
    });
    const status = readEngineAdminStatus(CARD_NOW);
    expect(status.week.start).toBe("2099-10-12");
    expect(status.week.promptVersion).toBe("weekly-coach-v5");
    expect(status.week.origin).toBe("fallback");
    expect(status.week.rowStatus).toBe("failed");
    expect(status.week.rowId).not.toBe(week.id);
  });

  it("calls regenerate-week on a 2099 week with the planning flag off and records a skeleton lock", async () => {
    freshDb();
    expect(process.env.LONGITUDINAL_PLANNING).toBeUndefined();
    expect(classWeekToTrain(NOW)).toBe(WEEK);
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await runAdminAction("regenerate-week", { nowMs: NOW, key: "probe-key", fetchImpl });
    expect(result.week_start).toBe(WEEK);
    expect(seen.some((body) => body.includes("Write the weekly skeleton"))).toBe(true);
    const logs = getSqlite()
      .prepare(`SELECT raw_json FROM programming_generation_logs WHERE scope_key = ?`)
      .all(WEEK) as Array<{ raw_json: string }>;
    expect(logs.some((row) => row.raw_json.includes("skeleton_planner") || row.raw_json.includes("skeleton-v1"))).toBe(true);
    expect(process.env.LONGITUDINAL_PLANNING).toBeUndefined();
  }, 120000);

  it("does not plan a skeleton from generate-next-week when the flag is off", async () => {
    freshDb();
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const result = await runAdminAction("generate-next-week", { nowMs: NOW, key: "probe-key", fetchImpl });
    expect(String(result.week_start)).toMatch(/^2099-/);
    expect(seen.some((body) => body.includes("Write the weekly skeleton"))).toBe(false);
    expect(engineRequestBody("regenerate-week")).toEqual({ action: "regenerate-week", actualCase: null });
    expect(engineRequestBody("regenerate-week", "", WEEK).weekStart).toBe(WEEK);
  }, 120000);
});
