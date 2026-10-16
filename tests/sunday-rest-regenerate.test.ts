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
import { askCoach, isOutputLimitFailure, raisedOutputLimit, shrinkCoachUser } from "../src/lib/programming/coaching/llm";
import { restDayFor } from "../src/lib/programming/coaching/goal-table";
import { extractWeekRules, weekPlanErrors } from "../src/lib/programming/coaching/stage13/rules";
import { applyClassIntentFrame, classFrameAlignmentErrors, intensityWithinCode, planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { parseWeeklyIntent } from "../src/lib/programming/weekly-intent";
import { applyClassSkeletonFrame, planLongitudinal } from "../src/lib/programming/planning/plan";
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
      promptVersion: "conditioning-coach-v8",
      runId: "output-limit",
      format: JSON_OBJECT,
      retryTransport: false,
    });
    expect(raised.ok).toBe(true);
    expect(bodies).toEqual([1800, raisedOutputLimit(1800)]);
    const shrunk = shrinkCoachUser({ task: "fill", recent_structures: [1, 2, 3], focus: "x".repeat(500) }) as {
      input_reduced?: boolean;
      recent_structures?: unknown;
      focus?: string;
    };
    expect(shrunk.input_reduced).toBe(true);
    expect(shrunk.recent_structures).toBeUndefined();
    expect(shrunk.focus?.length).toBe(400);
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
      promptVersion: "conditioning-coach-v8",
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
    expect(status.week.skeletonLocked).toBe(false);
    expect(status.week.usedFallback).toBe(true);
    expect(status.week.fallbackReason).toBe("weekly_schema");
  });

  it("keeps Monday through Saturday as training when the skeleton answers Wednesday or Friday rest", async () => {
    const month = fallbackMonth({ summary_ko: "블록을 유지합니다.", next_scheme: "531", strength_method: "531" });
    const code = await planLongitudinal({ month, weekIndex: 2, key: null });
    const seed = code.skeleton;
    const moved = structuredClone(seed.days);
    const sun = moved.find((day) => day.day === "sun")!;
    const wed = moved.find((day) => day.day === "wed")!;
    const fri = moved.find((day) => day.day === "fri")!;
    sun.status = "training";
    sun.primary_goal = "mixed_modal";
    wed.status = "rest";
    wed.primary_goal = "rest";
    fri.status = "rest";
    fri.primary_goal = "rest";
    const framed = applyClassSkeletonFrame(moved, seed);
    expect(framed.find((day) => day.day === "sun")?.status).toBe("rest");
    expect(framed.filter((day) => day.status === "training").map((day) => day.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    const plan = planCoachedWeek({ month, weekIndex: 2 });
    const modelPlan = structuredClone(plan);
    modelPlan.days.find((day) => day.day === "sun")!.primary_training = "mixed_modal";
    modelPlan.days.find((day) => day.day === "sun")!.recovery_role = "train";
    modelPlan.days.find((day) => day.day === "wed")!.primary_training = "rest";
    modelPlan.days.find((day) => day.day === "wed")!.recovery_role = "rest";
    modelPlan.days.find((day) => day.day === "fri")!.primary_training = "rest";
    modelPlan.days.find((day) => day.day === "fri")!.recovery_role = "rest";
    const intentFrame = applyClassIntentFrame(modelPlan, plan);
    expect(intentFrame.days.find((day) => day.day === "sun")?.primary_training).toBe("rest");
    expect(intentFrame.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
    ]);
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ days: moved }) } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const planned = await planLongitudinal({ month, weekIndex: 2, key: "probe-key", fetchImpl, timeoutMs: 1000 });
    expect(planned.skeleton.skeleton_locked).toBe(true);
    expect(planned.skeleton.days.filter((day) => day.status === "rest").map((day) => day.day)).toEqual(["sun"]);
    expect(planned.skeleton.days.filter((day) => day.status === "training")).toHaveLength(6);
  });

  it("keeps the code pattern when the weekly answer uses a long duration and a different movement", () => {
    const month = fallbackMonth({ summary_ko: "블록을 유지합니다.", next_scheme: "531", strength_method: "531" });
    const plan = planCoachedWeek({ month, weekIndex: 2 });
    const saturday = plan.days.find((day) => day.day === "sat")!;
    const body = {
      block_phase: plan.block_phase,
      emphasis: plan.emphasis,
      why_ko: plan.why_ko,
      focus: plan.focus,
      scheme_note: plan.scheme_note,
      adjustment_ko: plan.adjustment_ko,
      days: plan.days.map((day) =>
        day.day === "sat"
          ? { ...day, duration_profile: "90-110", movement_pattern: "olympic", intensity_profile: "heavy", volume_profile: "high", stimulus: "long_mixed" }
          : day,
      ),
    };
    const parsed = parseWeeklyIntent(body, plan);
    expect(parsed?.days.find((day) => day.day === "sat")?.duration_profile).toBe("90-110");
    const framed = applyClassIntentFrame(parsed!, plan);
    expect(framed.days.find((day) => day.day === "sat")?.duration_profile).toBe(saturday.duration_profile);
    expect(framed.days.find((day) => day.day === "sat")?.movement_pattern).toBe(saturday.movement_pattern);
    expect(framed.days.find((day) => day.day === "sat")?.volume_profile).toBe(saturday.volume_profile);
    expect(framed.days.find((day) => day.day === "sat")?.stimulus).toBe(saturday.stimulus);
    expect(framed.days.find((day) => day.day === "sat")?.intensity_profile).toBe(intensityWithinCode("heavy", saturday.intensity_profile));
    const lighter = structuredClone(parsed!);
    lighter.days.find((day) => day.day === "sat")!.intensity_profile = "light";
    expect(applyClassIntentFrame(lighter, plan).days.find((day) => day.day === "sat")?.intensity_profile).toBe("light");
    expect(
      classFrameAlignmentErrors(
        [
          "mon movement_pattern must be pull",
          "sat long conditioning must follow the monthly table",
          "wed rest must follow the monthly table (train)",
        ],
        "sun",
      ),
    ).toEqual(["wed rest must follow the monthly table (train)"]);
    expect(classFrameAlignmentErrors(["mon movement_pattern must be pull"], null)).toEqual(["mon movement_pattern must be pull"]);
  });

  it("retries an output-limit once with a smaller input and backs off HTTP twice", async () => {
    const bodies: string[] = [];
    const limited: FetchLike = async (_url, init) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) return new Response("max_tokens or model output limit was reached", { status: 400 });
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const raised = await askCoach({
      agent: "conditioning",
      user: { task: "fill monday", recent_structures: ["bulky"] },
      key: "test-key",
      fetchImpl: limited,
      timeoutMs: 1000,
      maxTokens: 1800,
      promptVersion: "conditioning-coach-v8",
      runId: "output-limit-shrink",
      format: JSON_OBJECT,
      retryTransport: false,
    });
    expect(raised.ok).toBe(true);
    expect(bodies[1]).toContain("input_reduced");
    expect(bodies[1]).not.toContain("recent_structures");
    const httpBodies: number[] = [];
    const http: FetchLike = async () => {
      httpBodies.push(1);
      return new Response("upstream down", { status: 500 });
    };
    const failed = await askCoach({
      agent: "load",
      retryTransport: true,
      user: { agent_name: "load_coach" },
      key: "test-key",
      fetchImpl: http,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "load-coach-v2",
      runId: "http-backoff",
      format: JSON_OBJECT,
    });
    expect(failed.ok).toBe(false);
    expect(failed.reason).toBe("http_error");
    expect(httpBodies).toHaveLength(3);
    let limitedCalls = 0;
    const rate: FetchLike = async () => {
      limitedCalls += 1;
      return new Response("slow down", { status: 429 });
    };
    const stopped = await askCoach({
      agent: "load",
      retryTransport: true,
      user: { agent_name: "load_coach" },
      key: "test-key",
      fetchImpl: rate,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "load-coach-v2",
      runId: "http-429",
      format: JSON_OBJECT,
    });
    expect(limitedCalls).toBe(1);
    expect(stopped.reason).toBe("http_error");
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
    await expect(runAdminAction("regenerate-week", { nowMs: NOW, key: "probe-key", fetchImpl })).rejects.toThrow(
      /weekly skeleton format failed/,
    );
    expect(seen.some((body) => body.includes("Write the weekly skeleton"))).toBe(true);
    const logs = getSqlite()
      .prepare(`SELECT prompt_version, raw_json FROM programming_generation_logs WHERE scope_key = ?`)
      .all(WEEK) as Array<{ prompt_version: string; raw_json: string }>;
    expect(logs.some((row) => row.raw_json.includes("skeleton_lock_enabled") || row.raw_json.includes("skeleton-v1"))).toBe(true);
    expect(logs.some((row) => row.prompt_version === "pipeline-failure-v1" || row.raw_json.includes("weekly_schema"))).toBe(true);
    const stored = getSqlite().prepare(`SELECT COUNT(*) AS n FROM programming_weeks WHERE week_start = ?`).get(WEEK) as { n: number };
    expect(stored.n).toBe(0);
    expect(process.env.LONGITUDINAL_PLANNING).toBeUndefined();
  }, 120000);

  it("plans a skeleton from generate-next-week through the same writer", async () => {
    freshDb();
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(String(init?.body ?? ""));
      return new Response(
        JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    await expect(runAdminAction("generate-next-week", { nowMs: NOW, key: "probe-key", fetchImpl })).rejects.toThrow(
      /weekly skeleton format failed/,
    );
    expect(seen.some((body) => body.includes("Write the weekly skeleton"))).toBe(true);
    expect(engineRequestBody("regenerate-week")).toEqual({ action: "regenerate-week", actualCase: null });
    expect(engineRequestBody("regenerate-week", "", WEEK).weekStart).toBe(WEEK);
  }, 120000);
});
