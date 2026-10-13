import { MONTH_PLAN_OPENAI_MODEL, MONTH_PLAN_OPENAI_URL } from "../../month-plan/week-model";
import { serverModelKey } from "../../month-plan/adapter";
import type { ResponseFormat } from "./contract";
import { coachModel, type CoachAgentName } from "./models";
import type { TokenUsage } from "./trace";

export const COACH_PROVIDERS = ["openai", "anthropic", "xai", "gemini"] as const;
export type CoachProvider = (typeof COACH_PROVIDERS)[number];

const KEY_ENV: Record<CoachProvider, string> = {
  openai: "MONTH_PLAN_MODEL_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  xai: "XAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

export const XAI_CHAT_URL = "https://api.x.ai/v1/chat/completions";
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export const GEMINI_GENERATE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export class MissingProviderKeyError extends Error {
  readonly provider: CoachProvider;
  readonly envName: string;

  constructor(provider: CoachProvider) {
    const envName = KEY_ENV[provider];
    super(`coach provider ${provider} is selected but ${envName} is empty`);
    this.name = "MissingProviderKeyError";
    this.provider = provider;
    this.envName = envName;
  }
}

export class MissingProviderModelError extends Error {
  readonly provider: CoachProvider;

  constructor(provider: CoachProvider) {
    super(`coach provider ${provider} needs COACH_MODEL_NAME`);
    this.name = "MissingProviderModelError";
    this.provider = provider;
  }
}

export function coachProvider(env: NodeJS.ProcessEnv = process.env): CoachProvider {
  const raw = env.COACH_MODEL_PROVIDER?.trim().toLowerCase() ?? "";
  if (!raw) return "openai";
  if ((COACH_PROVIDERS as readonly string[]).includes(raw)) return raw as CoachProvider;
  throw new Error(`unknown coach provider ${raw}`);
}

export function providerKeyEnv(provider: CoachProvider): string {
  return KEY_ENV[provider];
}

export function providerKey(env: NodeJS.ProcessEnv = process.env, provider: CoachProvider = coachProvider(env)): string | null {
  const value = env[KEY_ENV[provider]]?.trim();
  return value ? value : null;
}

/** Unset provider keeps the OpenAI key. An explicit provider with an empty key throws and does not call. */
export function resolveImplicitCoachKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.COACH_MODEL_PROVIDER?.trim()) {
    const provider = coachProvider(env);
    const key = providerKey(env, provider);
    if (!key) throw new MissingProviderKeyError(provider);
    return key;
  }
  return serverModelKey(env);
}

/** Agent env and COACHING_MODEL stay first. COACH_MODEL_NAME is the shared name after those. */
export function coachModelForCall(agent: CoachAgentName, env: NodeJS.ProcessEnv = process.env): string {
  const provider = coachProvider(env);
  const model = coachModel(agent, env);
  if (provider !== "openai" && !env.COACH_MODEL_NAME?.trim() && model === MONTH_PLAN_OPENAI_MODEL) {
    throw new MissingProviderModelError(provider);
  }
  return model;
}

export type CoachRequest = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export function buildCoachRequest(input: {
  provider: CoachProvider;
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number | null;
  format: ResponseFormat;
}): CoachRequest {
  if (input.provider === "anthropic") return anthropicRequest(input);
  if (input.provider === "gemini") return geminiRequest(input);
  return chatRequest(input, input.provider === "xai" ? XAI_CHAT_URL : MONTH_PLAN_OPENAI_URL, input.provider === "xai");
}

function chatRequest(
  input: {
    key: string;
    model: string;
    system: string;
    user: string;
    maxTokens: number;
    temperature: number | null;
    format: ResponseFormat;
  },
  url: string,
  xai: boolean,
): CoachRequest {
  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      { role: xai ? "system" : "developer", content: input.system },
      { role: "user", content: input.user },
    ],
    response_format: input.format,
    max_completion_tokens: input.maxTokens,
  };
  if (!xai) body.reasoning_effort = "none";
  if (input.temperature != null) body.temperature = input.temperature;
  return {
    url,
    headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json" },
    body,
  };
}

function anthropicRequest(input: {
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number | null;
  format: ResponseFormat;
}): CoachRequest {
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: "user", content: input.user }],
  };
  if (input.temperature != null) body.temperature = input.temperature;
  if (input.format.type === "json_schema") {
    body.output_config = { format: { type: "json_schema", schema: input.format.json_schema.schema } };
  }
  return {
    url: ANTHROPIC_MESSAGES_URL,
    headers: {
      "x-api-key": input.key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body,
  };
}

function geminiRequest(input: {
  key: string;
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature: number | null;
  format: ResponseFormat;
}): CoachRequest {
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxTokens,
    responseMimeType: "application/json",
  };
  if (input.temperature != null) generationConfig.temperature = input.temperature;
  if (input.format.type === "json_schema") generationConfig.responseJsonSchema = input.format.json_schema.schema;
  return {
    url: `${GEMINI_GENERATE_URL}/${encodeURIComponent(input.model)}:generateContent`,
    headers: { "x-goog-api-key": input.key, "Content-Type": "application/json" },
    body: {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: "user", parts: [{ text: input.user }] }],
      generationConfig,
    },
  };
}

export type ParsedCoachPayload = {
  text: string | null;
  usage: TokenUsage | null;
  truncated: boolean;
};

export function parseCoachPayload(provider: CoachProvider, payload: unknown): ParsedCoachPayload {
  if (provider === "anthropic") return parseAnthropic(payload);
  if (provider === "gemini") return parseGemini(payload);
  return parseChat(payload);
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function usageFrom(prompt: number | null, completion: number | null, total: number | null): TokenUsage | null {
  if (prompt == null && completion == null && total == null) return null;
  const promptTokens = prompt ?? 0;
  const completionTokens = completion ?? 0;
  const totalTokens = total ?? promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) return null;
  return { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens };
}

function parseChat(payload: unknown): ParsedCoachPayload {
  const text = chatText(payload);
  const usage = chatUsage(payload);
  const finish = chatFinish(payload);
  return { text, usage, truncated: finish === "length" };
}

function chatText(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object" || !("message" in first)) return null;
  const message = (first as { message?: { content?: unknown } }).message;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
  return text.trim() ? text : null;
}

function chatUsage(payload: unknown): TokenUsage | null {
  if (!payload || typeof payload !== "object" || !("usage" in payload)) return null;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return null;
  const row = usage as { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
  return usageFrom(numeric(row.prompt_tokens), numeric(row.completion_tokens), numeric(row.total_tokens));
}

function chatFinish(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || !("choices" in payload)) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return null;
  const reason = (choices[0] as { finish_reason?: unknown }).finish_reason;
  return typeof reason === "string" ? reason : null;
}

function parseAnthropic(payload: unknown): ParsedCoachPayload {
  if (!payload || typeof payload !== "object") return { text: null, usage: null, truncated: false };
  const row = payload as { content?: unknown; stop_reason?: unknown; usage?: unknown };
  let text: string | null = null;
  if (Array.isArray(row.content)) {
    const joined = row.content
      .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
      .join("");
    text = joined.trim() ? joined : null;
  }
  const usage = row.usage && typeof row.usage === "object" ? (row.usage as { input_tokens?: unknown; output_tokens?: unknown }) : null;
  const prompt = usage ? numeric(usage.input_tokens) : null;
  const completion = usage ? numeric(usage.output_tokens) : null;
  return {
    text,
    usage: usageFrom(prompt, completion, prompt != null && completion != null ? prompt + completion : null),
    truncated: row.stop_reason === "max_tokens",
  };
}

function parseGemini(payload: unknown): ParsedCoachPayload {
  if (!payload || typeof payload !== "object") return { text: null, usage: null, truncated: false };
  const row = payload as { candidates?: unknown; usageMetadata?: unknown };
  let text: string | null = null;
  let truncated = false;
  if (Array.isArray(row.candidates) && row.candidates[0] && typeof row.candidates[0] === "object") {
    const candidate = row.candidates[0] as { content?: { parts?: unknown }; finishReason?: unknown };
    truncated = candidate.finishReason === "MAX_TOKENS";
    const parts = candidate.content?.parts;
    if (Array.isArray(parts)) {
      const joined = parts
        .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
        .join("");
      text = joined.trim() ? joined : null;
    }
  }
  const usage = row.usageMetadata && typeof row.usageMetadata === "object"
    ? (row.usageMetadata as { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown })
    : null;
  return {
    text,
    usage: usage
      ? usageFrom(numeric(usage.promptTokenCount), numeric(usage.candidatesTokenCount), numeric(usage.totalTokenCount))
      : null,
    truncated,
  };
}

export function coachEndpoint(provider: CoachProvider, model = ""): string {
  if (provider === "anthropic") return ANTHROPIC_MESSAGES_URL;
  if (provider === "xai") return XAI_CHAT_URL;
  if (provider === "gemini") return `${GEMINI_GENERATE_URL}/${encodeURIComponent(model)}:generateContent`;
  return MONTH_PLAN_OPENAI_URL;
}
