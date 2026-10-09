import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askCoach } from "../src/lib/programming/coaching/llm";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { authorMonth } from "../src/lib/programming/model";
import { archiveProbePass, verifyProbeArchives } from "../src/lib/programming/probe-archive";
import { monthSchemaErrors } from "../src/lib/programming/rules";
import { readOnlyMonthSummary } from "../src/lib/programming/engine";
import type { MonthDirection } from "../src/lib/programming/types";

const KEY = "sk-stage22-test-key";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage22-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function envelope(body: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function month(method: "531" | "ACCUMULATION" | "INTENSITY_BLOCK" | "DELOAD_RECOVERY" | "TECHNIQUE_SKILL"): MonthDirection {
  const scheme =
    method === "531" ? "531" : method === "ACCUMULATION" ? "volume" : method === "INTENSITY_BLOCK" ? "intensity" : method === "TECHNIQUE_SKILL" ? "skill" : "deload";
  return fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: scheme, strength_method: method });
}

function archiveInput(root: string, runId: string, pass: string, logs: unknown[]) {
  return archiveProbePass({
    root,
    runId,
    pass,
    generationLogs: logs,
    weeks: [{ week_start: "2099-07-06", plan: { sessions: [] } }],
    months: [{ month_start: "2099-07-01", direction: { scheme: "volume", strength_method: "ACCUMULATION" } }],
    evaluations: [],
    calls: 1,
    tokens: 5,
    elapsed_ms: 10,
  });
}

describe("stage22 archive and month pairs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps A1 raw files after A2 and rejects a missing log", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage22-archive-"));
    const runId = "stage22-run-a";
    const raw = { raw_output: "60sec", parsed_output: "90", normalizations: [{ original_value: "60sec", converted_value: "90", rule: "double_under_sec_to_reps" }] };
    const first = archiveInput(root, runId, "A1", [raw]);
    const a1Log = path.join(first.dir, "generation-logs.json");
    const a1Hash = fs.readFileSync(a1Log);
    const second = archiveInput(root, runId, "A2", [{ raw_output: "40", parsed_output: "40", normalizations: [] }]);
    expect(first.dir).not.toBe(second.dir);
    expect(first.manifest.execution_id).not.toBe(second.manifest.execution_id);
    expect(fs.readFileSync(a1Log).equals(a1Hash)).toBe(true);
    const intact = verifyProbeArchives({ root, runId, passes: ["A1", "A2"] });
    expect(intact.ok).toBe(true);
    const dotted = archiveInput(root, "stage23.1-run", "A1", [raw]);
    expect(verifyProbeArchives({ root, runId: "stage23.1-run", passes: ["A1"] }).ok).toBe(true);
    expect(dotted.dir).toContain("stage23.1-run");
    expect(() => archiveInput(root, "stage23..1", "A1", [raw])).toThrow(/not a file label/);

    const other = archiveInput(root, "stage22-run-b", "A1", [raw]);
    expect(other.dir).not.toBe(first.dir);
    expect(fs.readFileSync(a1Log).equals(a1Hash)).toBe(true);

    fs.unlinkSync(a1Log);
    const missing = verifyProbeArchives({ root, runId, passes: ["A1", "A2"] });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.missing.some((item) => item.includes("generation-logs.json"))).toBe(true);

    const stored = JSON.parse(a1Hash.toString("utf8")) as Array<{ raw_output: string; parsed_output: string }>;
    expect(stored[0]?.raw_output).toBe("60sec");
    expect(stored[0]?.parsed_output).toBe("90");
    expect(stored[0]?.raw_output).not.toBe(stored[0]?.parsed_output);
  });

  it("keeps the first validation error after a successful retry", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(envelope({ day: "bad" }))
      .mockResolvedValueOnce(envelope({ day: "ok" }));
    const result = await askCoach({
      agent: "session",
      user: { day: "mon", amount: "60sec" },
      key: KEY,
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "session-coach-v2",
      runId: "stage22-retry",
      validate: (json) => {
        const day = (json as { day?: string }).day;
        return day === "ok" ? { ok: true } : { ok: false, errors: ["volume ceiling refused 60sec"] };
      },
    });
    expect(result.ok).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.firstValidationErrors).toEqual(["volume ceiling refused 60sec"]);
    expect(result.retryCount).toBe(1);
    expect(result.attempts[0]?.validation_errors).toEqual(["volume ceiling refused 60sec"]);
    expect(result.attempts[1]?.validation_errors).toEqual([]);
    expect(result.attempts[0]?.raw).not.toEqual(result.attempts[1]?.raw);
  });

  it("rejects deload plus 531 and does not rewrite the pair", async () => {
    const allowed: Array<["531" | "ACCUMULATION" | "INTENSITY_BLOCK" | "DELOAD_RECOVERY" | "TECHNIQUE_SKILL"]> = [
      ["531"],
      ["ACCUMULATION"],
      ["INTENSITY_BLOCK"],
      ["DELOAD_RECOVERY"],
      ["TECHNIQUE_SKILL"],
    ];
    for (const [method] of allowed) {
      const legal = month(method);
      expect(monthSchemaErrors(legal, legal)).toEqual([]);
    }

    const recovery = month("DELOAD_RECOVERY");
    const mixed = { ...recovery, scheme: "deload" as const, strength_method: "531" };
    const rejected = monthSchemaErrors(mixed, mixed);
    expect(rejected[0]).toContain("scheme deload does not allow strength_method 531");
    expect(rejected[0]).toContain("DELOAD_RECOVERY");
    expect(mixed.scheme).toBe("deload");
    expect(mixed.strength_method).toBe("531");

    const flipped = { ...month("531"), strength_method: "DELOAD_RECOVERY" };
    expect(monthSchemaErrors(flipped, flipped)[0]).toContain("scheme 531 does not allow strength_method DELOAD_RECOVERY");
    expect(flipped.strength_method).toBe("DELOAD_RECOVERY");

    const volumeWith531 = { ...month("531"), scheme: "volume" as const };
    expect(monthSchemaErrors(volumeWith531, volumeWith531)[0]).toContain("does not match strength_method 531");
    expect(volumeWith531.strength_method).toBe("531");

    freshDb();
    const legalRecovery = month("DELOAD_RECOVERY");
    const fetchImpl = vi.fn().mockResolvedValueOnce(envelope(mixed)).mockResolvedValueOnce(envelope(legalRecovery));
    const authored = await authorMonth({
      summary: readOnlyMonthSummary("2099-09-01"),
      key: KEY,
      fetchImpl,
      timeoutMs: 1000,
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.direction.scheme).toBe("deload");
    expect(authored.direction.strength_method).toBe("DELOAD_RECOVERY");
    expect(authored.trace.responses[0]?.errors?.join(" ")).toContain("scheme deload does not allow strength_method 531");
    expect(authored.trace.responses[1]?.errors).toEqual([]);
    expect(mixed.strength_method).toBe("531");
  });
});
