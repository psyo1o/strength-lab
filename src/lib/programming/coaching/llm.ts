import { MONTH_PLAN_OPENAI_URL } from "../../month-plan/week-model";
import { parseModelJson, type FetchLike } from "../model";
import { coachModel, type CoachAgentName } from "./models";
import { coachSystemPrompt } from "./prompts";

export async function askCoach(input: {
  agent: CoachAgentName;
  user: unknown;
  key: string;
  fetchImpl?: FetchLike;
  timeoutMs: number;
  maxTokens: number;
}): Promise<{ ok: true; json: unknown; model: string; latencyMs: number } | { ok: false; reason: string; model: string; latencyMs: number; raw: unknown }> {
  const model = coachModel(input.agent);
  const started = Date.now();
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(MONTH_PLAN_OPENAI_URL, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(input.timeoutMs),
      headers: {
        Authorization: `Bearer ${input.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "developer", content: coachSystemPrompt(input.agent) },
          { role: "user", content: JSON.stringify(input.user) },
        ],
        response_format: { type: "json_object" },
        reasoning_effort: "none",
        max_completion_tokens: input.maxTokens,
      }),
    });
    const raw = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, reason: "http_error", model, latencyMs: Date.now() - started, raw };
    }
    const json = parseModelJson(raw);
    if (!json || typeof json !== "object") {
      return { ok: false, reason: "bad_json", model, latencyMs: Date.now() - started, raw };
    }
    return { ok: true, json, model, latencyMs: Date.now() - started };
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? String(error.name) : "";
    const reason = name === "AbortError" || name === "TimeoutError" ? "timeout" : "http_error";
    return { ok: false, reason, model, latencyMs: Date.now() - started, raw: null };
  }
}
