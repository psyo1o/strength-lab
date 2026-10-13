import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askCoach } from "../src/lib/programming/coaching/llm";
import { configurePhase4Run, phase4TokensSpent, Phase4Stop, resetPhase4Run } from "../src/lib/programming/phase4/budget";
import { assertIsolated2099Database } from "../src/lib/programming/phase4/isolation";

function chat(content: unknown, usage = { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 }) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("phase 4 call guard", () => {
  afterEach(() => {
    resetPhase4Run();
    delete process.env.PHASE4_STAGE;
  });

  it("retries one http error and sends the error text", async () => {
    const bodies: string[] = [];
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      if (bodies.length === 1) return new Response("upstream down", { status: 500 });
      return chat({ ok: true });
    };
    const result = await askCoach({
      agent: "load",
      retryTransport: true,
      user: { agent_name: "load_coach" },
      key: "test-key",
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "load-coach-v2",
      runId: "phase4-http",
      validate: () => ({ ok: true }),
    });
    expect(result.ok).toBe(true);
    expect(result.retryCount).toBe(1);
    expect(bodies[1]).toContain("http_error");
    expect(bodies[1]).toContain("upstream down");
  });

  it("does not retry HTTP 429", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("slow down", { status: 429 });
    };
    const result = await askCoach({
      agent: "load",
      retryTransport: true,
      user: { agent_name: "load_coach" },
      key: "test-key",
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "load-coach-v2",
      runId: "phase4-429",
      validate: () => ({ ok: true }),
    });
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("http_error");
  });

  it("stops when the token cap is crossed", async () => {
    configurePhase4Run({ tokenCap: 4, logPath: null });
    const fetchImpl = async () => chat({ ok: true }, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
    await expect(
      askCoach({
        agent: "load",
        user: { agent_name: "load_coach" },
        key: "test-key",
        fetchImpl,
        timeoutMs: 1000,
        maxTokens: 100,
        promptVersion: "load-coach-v2",
        runId: "phase4-cap",
        validate: () => ({ ok: true }),
      }),
    ).rejects.toBeInstanceOf(Phase4Stop);
    expect(phase4TokensSpent()).toBeGreaterThanOrEqual(4);
  });

  it("writes one call line without the key", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "phase4-log-"));
    const logPath = path.join(dir, "calls.log");
    configurePhase4Run({ tokenCap: null, logPath });
    process.env.PHASE4_STAGE = "A";
    await askCoach({
      agent: "load",
      user: { agent_name: "load_coach", secret: "sk-testsecretvalue" },
      key: "sk-testsecretvalue",
      fetchImpl: async () => chat({ ok: true }),
      timeoutMs: 1000,
      maxTokens: 100,
      promptVersion: "load-coach-v2",
      runId: "phase4-log",
      validate: () => ({ ok: true }),
    });
    const line = readFileSync(logPath, "utf8");
    expect(line).toContain("A load load-coach-v2");
    expect(line).toContain("result=ok");
    expect(line).not.toContain("sk-testsecretvalue");
  });

  it("refuses a database that is not the 2099 tmp file", () => {
    expect(() => assertIsolated2099Database("/tmp/strength-lab-phase4-2099.db", { months: [], weeks: [] })).not.toThrow();
    expect(() => assertIsolated2099Database("/tmp/strength-lab-phase4-2099.db", { months: ["2099-07-01"], weeks: ["2099-07-06"] })).not.toThrow();
    expect(() => assertIsolated2099Database("data/app.db", { months: [], weeks: [] })).toThrow(/tmp/);
    expect(() => assertIsolated2099Database("/tmp/strength-lab-phase4-2099.db", { months: [], weeks: ["2026-10-05"] })).toThrow(/operational/);
    expect(() => assertIsolated2099Database("/tmp/strength-lab-phase4-2099.db", { months: ["2026-10-01"], weeks: [] })).toThrow(/2099/);
  });
});
