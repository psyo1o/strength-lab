import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { ensureProgrammingMonth, ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorWeek, wodFromIntentPrompt } from "../src/lib/programming/model";
import { constraintFailureBriefs, judgeWeek, structureValidationErrors } from "../src/lib/programming/rules";
import type { MonthDirection, WeekDraft, WeekIndex } from "../src/lib/programming/types";
import { planWeeklyIntent } from "../src/lib/programming/weekly-intent";

const KEY = "sk-ops-path-schema-test";
const NOW = Date.parse("2099-05-04T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-ops-path-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
}

function legalWeek(month: MonthDirection, weekIndex: WeekIndex = 1): WeekDraft {
  return buildFallbackWeek({ month, weekIndex, intent: fallbackIntent(month, weekIndex, "ops-path") });
}

/** Flag-off archive shape: every piece labeled short while duration_min is 35. */
function shortThirtyFive(month: MonthDirection): WeekDraft {
  const draft = legalWeek(month);
  for (const session of draft.sessions) {
    if (!session.conditioning) continue;
    session.time_domain = "short";
    session.expected_duration = 35;
    session.conditioning = { ...session.conditioning, time_domain: "short", duration_min: 35, long_conditioning: false };
  }
  return draft;
}

function userJson(fetchImpl: ReturnType<typeof vi.fn>, call: number): Record<string, unknown> {
  const body = JSON.parse(String((fetchImpl.mock.calls[call]?.[1] as RequestInit).body)) as {
    messages: Array<{ content: string }>;
  };
  return JSON.parse(body.messages[1]!.content) as Record<string, unknown>;
}

describe("wod-from-intent-v1 schema failures from the flag-off probe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.COACHING_PIPELINE;
    delete process.env.LONGITUDINAL_PLANNING;
    resetDbConnection();
  });

  it("accepts a legal model week and shows the duration rules on the first prompt", async () => {
    freshDb();
    const month = month531();
    const good = legalWeek(month);
    const judged = judgeWeek(good, month, 1, []);
    expect(judged.ok, judged.ok ? "" : judged.errors.join(" | ")).toBe(true);
    const fetchImpl = vi.fn(async () => envelope(good));
    const authored = await authorWeek({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      key: KEY,
      fetchImpl,
    });
    expect(authored.ok, authored.ok ? "" : authored.reason).toBe(true);
    if (!authored.ok) return;
    expect(authored.trace.attempt).toBe(1);
    const prompt = userJson(fetchImpl, 0);
    expect(prompt.prompt_version).toBe("wod-from-intent-v1");
    const examples = prompt.time_domain_examples as { invalid: Array<{ time_domain: string; duration_min: number }> };
    expect(examples.invalid).toEqual(
      expect.arrayContaining([
        { time_domain: "short", duration_min: 35, why: "35 is long, not short" },
        { time_domain: "medium", duration_min: 30, why: "30 is long, not medium" },
        { time_domain: "long", duration_min: 60, why: "60 is outside 30–40" },
      ]),
    );
  });

  it("reproduces short plus 35, does not rewrite the label, and names the required domain", () => {
    const month = month531();
    const bad = shortThirtyFive(month);
    const judged = judgeWeek(bad, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("schema");
    expect(judged.errors.join(" ")).toContain("time_domain=short duration=35 is outside 1–12");
    expect(judged.normalizations.join(" ")).not.toContain("time_domain");
    const structured = structureValidationErrors(judged.errors).find((row) => row.rule === "time_domain_range");
    expect(structured?.priority).toBe(1);
    expect(structured?.current).toBe(35);
    const briefs = constraintFailureBriefs(judged.errors);
    const rangeBrief = briefs.find((brief) => brief.includes("duration_min=35"));
    expect(rangeBrief).toContain("35 is long, not short");
    expect(rangeBrief).not.toContain("Fill every session-level field");
    const prompt = wodFromIntentPrompt({
      summary: { progression: { months_recorded: 0, last_evaluation: null } } as never,
      month,
      weekIndex: 1,
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      retryErrors: judged.errors,
      previousDraft: bad,
    }) as { retry?: { failure_briefs?: string[]; instruction?: string; repair?: string } };
    expect(prompt.retry?.instruction).toContain("Previous output violated");
    expect(prompt.retry?.failure_briefs?.join(" ")).toContain("35 is long, not short");
    expect(prompt.retry?.repair).toContain("duration_min chooses time_domain");
    expect(JSON.stringify(prompt)).not.toContain("Do not regenerate the week");
  });

  it("adopts the corrected retry as the model week", async () => {
    freshDb();
    const month = month531();
    const bad = shortThirtyFive(month);
    const good = legalWeek(month);
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(bad)).mockResolvedValueOnce(envelope(good));
    const authored = await authorWeek({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      key: KEY,
      fetchImpl,
    });
    expect(authored.ok, authored.ok ? "" : authored.reason).toBe(true);
    if (!authored.ok) return;
    expect(authored.trace.attempt).toBe(2);
    expect(authored.trace.errors).toEqual([]);
    const retry = userJson(fetchImpl, 1) as { retry?: { failure_briefs?: string[] } };
    expect(retry.retry?.failure_briefs?.join(" ")).toContain("35 is long, not short");
  });

  it("keeps an out-of-range duration and a repeated stimulus as failures", async () => {
    freshDb();
    const month = month531();
    const illegal = legalWeek(month);
    const day = illegal.sessions.find((session) => session.conditioning);
    if (!day?.conditioning) throw new Error("conditioning missing");
    day.time_domain = "long";
    day.expected_duration = 60;
    day.conditioning = { ...day.conditioning, time_domain: "long", duration_min: 60, long_conditioning: true };
    const judged = judgeWeek(illegal, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors.join(" ")).toContain("time_domain=long duration=60 is outside 30–40");
    expect(constraintFailureBriefs(judged.errors).join(" ")).toContain("Do not label an out-of-range duration as long");
    const fetchImpl = vi.fn(async () => envelope(illegal));
    const authored = await authorWeek({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      key: KEY,
      fetchImpl,
    });
    expect(authored.ok).toBe(false);
    if (authored.ok) return;
    expect(authored.reason).toBe("schema");
    expect(authored.trace.attempt).toBe(2);
    expect(authored.trace.errors.join(" ")).toContain("duration=60");

    const repeated = legalWeek(month);
    const training = repeated.sessions.filter((session) => session.conditioning);
    const first = training[0];
    const second = training[1];
    if (!first?.conditioning || !second?.conditioning) throw new Error("two training days missing");
    second.stimulus = first.stimulus;
    second.conditioning = { ...second.conditioning, stimulus: first.conditioning.stimulus };
    const stimulus = judgeWeek(repeated, month, 1, []);
    expect(stimulus.ok).toBe(false);
    if (stimulus.ok) return;
    expect(stimulus.errors.join(" ")).toContain("stimulus");
    const stimulusFetch = vi.fn(async () => envelope(repeated));
    const stimulusAuthored = await authorWeek({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      key: KEY,
      fetchImpl: stimulusFetch,
    });
    expect(stimulusAuthored.ok).toBe(false);
    if (stimulusAuthored.ok) return;
    expect(stimulusAuthored.reason).not.toBe("http_error");
    expect(stimulusAuthored.trace.errors.join(" ")).toContain("stimulus");
  });

  it("records schema fallback separately from an HTTP failure and does not store it as a model week", async () => {
    freshDb();
    const month = month531();
    const httpFetch = vi.fn(async () => new Response("down", { status: 503 }));
    const http = await authorWeek({
      summary: readOnlyWeekSummary("2099-05-05"),
      month,
      weekIndex: 1,
      recent: [],
      weeklyIntent: planWeeklyIntent({ month, weekIndex: 1 }),
      key: KEY,
      fetchImpl: httpFetch,
    });
    expect(http.ok).toBe(false);
    if (http.ok) return;
    expect(http.reason).toBe("http_error");

    await ensureProgrammingMonth("2099-05-01", { nowMs: NOW, key: null });
    const bad = shortThirtyFive(month);
    const fetchImpl = vi.fn(async () => envelope(bad));
    const saved = await ensureProgrammingWeek("2099-05-04", { nowMs: NOW, key: KEY, fetchImpl });
    expect(saved.weekStart).toBe("2099-05-04");
    expect(saved.generationSource).toBe("fallback");
    expect(saved.fallbackReason).toBe("schema");
    expect(saved.generationSource).not.toBe("model");
  });

  it("tells a null session copy to come from conditioning and still rejects the null", () => {
    const month = month531();
    const draft = legalWeek(month);
    const day = draft.sessions.find((session) => session.conditioning && session.time_domain);
    if (!day) throw new Error("training day missing");
    day.time_domain = null;
    const judged = judgeWeek(draft, month, 1, []);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.errors.join(" ")).toContain("missing session fields");
    expect(judged.normalizations.join(" ")).not.toContain("time_domain");
    expect(constraintFailureBriefs(judged.errors).join(" ")).toContain("Copy metcon_format, time_domain");
  });
});
