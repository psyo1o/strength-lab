import { afterEach, describe, expect, it, vi } from "vitest";
import { JSON_OBJECT, type ResponseFormat } from "../src/lib/programming/coaching/contract";
import { askCoach } from "../src/lib/programming/coaching/llm";
import { coachModel } from "../src/lib/programming/coaching/models";
import {
  ANTHROPIC_MESSAGES_URL,
  GEMINI_GENERATE_URL,
  MissingProviderKeyError,
  MissingProviderModelError,
  XAI_CHAT_URL,
  buildCoachRequest,
  coachModelForCall,
  parseCoachPayload,
  resolveImplicitCoachKey,
} from "../src/lib/programming/coaching/provider";
import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../src/lib/month-plan/week-model";

const schema: ResponseFormat = {
  type: "json_schema",
  json_schema: { name: "coach", strict: true, schema: { type: "object", additionalProperties: false, properties: { day: { type: "string" } }, required: ["day"] } },
};

const saved = {
  COACH_MODEL_PROVIDER: process.env.COACH_MODEL_PROVIDER,
  COACH_MODEL_NAME: process.env.COACH_MODEL_NAME,
  MONTH_PLAN_MODEL_KEY: process.env.MONTH_PLAN_MODEL_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value == null) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("coach provider requests", () => {
  it("keeps the openai body on the current model", () => {
    delete process.env.COACH_MODEL_PROVIDER;
    delete process.env.COACH_MODEL_NAME;
    const request = buildCoachRequest({
      provider: "openai",
      key: "test-openai",
      model: MONTH_PLAN_OPENAI_MODEL,
      system: "system",
      user: "{\"day\":\"mon\"}",
      maxTokens: 40,
      temperature: 0.2,
      format: schema,
    });
    expect(request.url).toBe(MONTH_PLAN_OPENAI_URL);
    expect(request.headers.Authorization).toBe("Bearer test-openai");
    expect(request.body).toMatchObject({
      model: "gpt-5.4-nano",
      reasoning_effort: "none",
      max_completion_tokens: 40,
      temperature: 0.2,
      response_format: schema,
    });
    expect(request.body.messages).toEqual([
      { role: "developer", content: "system" },
      { role: "user", content: "{\"day\":\"mon\"}" },
    ]);
    expect(coachModel("session")).toBe("gpt-5.4-nano");
  });

  it("sends an anthropic schema request and reads its tokens", () => {
    const request = buildCoachRequest({
      provider: "anthropic",
      key: "test-anthropic",
      model: "claude-sonnet-5",
      system: "system",
      user: "{\"day\":\"mon\"}",
      maxTokens: 40,
      temperature: null,
      format: schema,
    });
    expect(request.url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(request.headers["x-api-key"]).toBe("test-anthropic");
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.body).toMatchObject({
      model: "claude-sonnet-5",
      max_tokens: 40,
      system: "system",
      messages: [{ role: "user", content: "{\"day\":\"mon\"}" }],
      output_config: { format: { type: "json_schema", schema: schema.json_schema.schema } },
    });
    expect(request.body).not.toHaveProperty("temperature");
    const loose = buildCoachRequest({ ...requestInput("anthropic"), format: JSON_OBJECT });
    expect(loose.body).not.toHaveProperty("output_config");
    expect(parseCoachPayload("anthropic", {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{\"day\":\"mon\"}" }],
      usage: { input_tokens: 3, output_tokens: 4 },
    })).toEqual({ text: "{\"day\":\"mon\"}", usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 }, truncated: false });
    expect(parseCoachPayload("anthropic", { stop_reason: "max_tokens", content: [{ type: "text", text: "{" }] }).truncated).toBe(true);
  });

  it("sends an xai chat request and reads openai usage", () => {
    const request = buildCoachRequest({
      provider: "xai",
      key: "test-xai",
      model: "grok-4",
      system: "system",
      user: "{\"day\":\"tue\"}",
      maxTokens: 20,
      temperature: 0.2,
      format: JSON_OBJECT,
    });
    expect(request.url).toBe(XAI_CHAT_URL);
    expect(request.headers.Authorization).toBe("Bearer test-xai");
    expect(request.body).toMatchObject({
      model: "grok-4",
      response_format: JSON_OBJECT,
      max_completion_tokens: 20,
      messages: [
        { role: "system", content: "system" },
        { role: "user", content: "{\"day\":\"tue\"}" },
      ],
    });
    expect(request.body).not.toHaveProperty("reasoning_effort");
    expect(parseCoachPayload("xai", {
      choices: [{ finish_reason: "length", message: { content: "{" } }],
      usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
    })).toEqual({ text: "{", usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }, truncated: true });
  });

  it("sends a gemini schema request and reads usageMetadata", () => {
    const request = buildCoachRequest({
      provider: "gemini",
      key: "test-gemini",
      model: "gemini-3.8-flash",
      system: "system",
      user: "{\"day\":\"wed\"}",
      maxTokens: 30,
      temperature: 0.2,
      format: schema,
    });
    expect(request.url).toBe(`${GEMINI_GENERATE_URL}/gemini-3.8-flash:generateContent`);
    expect(request.url).not.toContain("test-gemini");
    expect(request.headers["x-goog-api-key"]).toBe("test-gemini");
    expect(request.body).toMatchObject({
      systemInstruction: { parts: [{ text: "system" }] },
      contents: [{ role: "user", parts: [{ text: "{\"day\":\"wed\"}" }] }],
      generationConfig: {
        maxOutputTokens: 30,
        temperature: 0.2,
        responseMimeType: "application/json",
        responseJsonSchema: schema.json_schema.schema,
      },
    });
    expect(parseCoachPayload("gemini", {
      candidates: [{ finishReason: "STOP", content: { parts: [{ text: "{\"day\":\"wed\"}" }] } }],
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 2, totalTokenCount: 10 },
    })).toEqual({ text: "{\"day\":\"wed\"}", usage: { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 }, truncated: false });
    expect(parseCoachPayload("gemini", { candidates: [{ finishReason: "MAX_TOKENS", content: { parts: [{ text: "{" }] } }] }).truncated).toBe(true);
  });

  it("stops before a call when the selected provider has no key", () => {
    process.env.COACH_MODEL_PROVIDER = "anthropic";
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => resolveImplicitCoachKey()).toThrow(MissingProviderKeyError);
    expect(() => resolveImplicitCoachKey()).toThrow(/ANTHROPIC_API_KEY is empty/);
    delete process.env.COACH_MODEL_PROVIDER;
    delete process.env.MONTH_PLAN_MODEL_KEY;
    expect(resolveImplicitCoachKey()).toBeNull();
  });

  it("requires a model name for a non-openai provider", () => {
    process.env.COACH_MODEL_PROVIDER = "gemini";
    delete process.env.COACH_MODEL_NAME;
    expect(() => coachModelForCall("session")).toThrow(MissingProviderModelError);
    process.env.COACH_MODEL_NAME = "gemini-3.8-flash";
    expect(coachModelForCall("session")).toBe("gemini-3.8-flash");
  });

  it("counts anthropic tokens through askCoach and does not fetch without a schema retry on http_error", async () => {
    process.env.COACH_MODEL_PROVIDER = "anthropic";
    process.env.COACH_MODEL_NAME = "claude-sonnet-5";
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "{\"day\":\"mon\"}" }],
      usage: { input_tokens: 5, output_tokens: 6 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const result = await askCoach({
      agent: "session",
      user: { day: "mon" },
      key: "test-anthropic",
      fetchImpl,
      timeoutMs: 1000,
      maxTokens: 40,
      promptVersion: "session-coach-v4",
      runId: "provider-anthropic",
      format: JSON_OBJECT,
    });
    expect(result.ok).toBe(true);
    expect(result.usage).toEqual({ prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 });
    expect(result.model).toBe("claude-sonnet-5");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(ANTHROPIC_MESSAGES_URL);
    expect(JSON.stringify(init)).not.toContain("MONTH_PLAN");
    const failed = vi.fn(async () => new Response("{\"error\":\"no\"}", { status: 503 }));
    const http = await askCoach({
      agent: "session",
      user: { day: "mon" },
      key: "test-anthropic",
      fetchImpl: failed,
      timeoutMs: 1000,
      maxTokens: 40,
      promptVersion: "session-coach-v4",
      runId: "provider-http",
      format: JSON_OBJECT,
    });
    expect(http.ok).toBe(false);
    expect(http.reason).toBe("http_error");
    expect(failed).toHaveBeenCalledTimes(1);
  });
});

function requestInput(provider: "anthropic") {
  return {
    provider,
    key: "test-anthropic",
    model: "claude-sonnet-5",
    system: "system",
    user: "{}",
    maxTokens: 40,
    temperature: null as number | null,
  };
}
