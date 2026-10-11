import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { archiveProbePass } from "../src/lib/programming/probe-archive";
import { SIMILARITY_CONFIG, WEEKLY_PROMPT_VERSION } from "../src/lib/programming/types";
import { STAGE16_PIPELINE_VERSION } from "../src/lib/programming/coaching/prompts";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-orchestrator-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
}

describe("coaching orchestrator entry", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    delete process.env.COACHING_PIPELINE;
    delete process.env.STRENGTH_LAB_PROBE;
    resetDbConnection();
  });

  it("keeps a null key on the no_model stamp for both flag values", async () => {
    const off = await ensureProgrammingWeek("2099-07-06", { nowMs: NOW, key: null });
    process.env.COACHING_PIPELINE = "1";
    const on = await ensureProgrammingWeek("2099-07-13", { nowMs: NOW, key: null });
    expect(off.promptVersion).toBe(WEEKLY_PROMPT_VERSION);
    expect(on.promptVersion).toBe(WEEKLY_PROMPT_VERSION);
    expect(off.generationSource).toBe("fallback");
    expect(on.generationSource).toBe("fallback");
    expect(off.fallbackReason).toBe("no_model");
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
  });

  it("sends a string key through the coaching pipeline even when the flag is off", async () => {
    const fetchImpl = vi.fn(async () => new Response("no", { status: 429 }));
    const week = await ensureProgrammingWeek("2099-07-20", { nowMs: NOW, key: "sk-orchestrator-test", fetchImpl });
    expect(week.promptVersion).toBe(STAGE16_PIPELINE_VERSION);
    expect(week.promptVersion).not.toBe("wod-from-intent-v1");
    expect(week.generationSource).toBe("fallback");
    expect(week.generationSource).not.toBe("model");
    expect(week.fallbackReason).toBe("http_error");
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(24);
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain("sk-orchestrator-test");
  });

  it("refuses the live class week when a probe holds a key", async () => {
    process.env.STRENGTH_LAB_PROBE = "1";
    await expect(ensureProgrammingWeek("2026-10-05", { nowMs: NOW, key: "sk-orchestrator-test" })).rejects.toThrow(/2026-10-05/);
  });

  it("archives a missing token total as null", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sl-orchestrator-archive-"));
    const archived = archiveProbePass({
      root,
      runId: "orchestrator-tokens",
      pass: "A1",
      generationLogs: [{ raw_output: "kept" }],
      weeks: [],
      months: [],
      evaluations: [],
      calls: 0,
      tokens: null,
      elapsed_ms: 0,
    });
    const usage = JSON.parse(fs.readFileSync(path.join(archived.dir, "usage.json"), "utf8")) as { tokens: number | null };
    expect(usage.tokens).toBeNull();
  });
});
