import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TokenUsage } from "../coaching/trace";

/** 이번 실행 전체 상한. 넘으면 다음 호출 전에 멈춘다. */
export const PHASE4_TOKEN_CAP = 1_500_000;

export class Phase4Stop extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Phase4Stop";
  }
}

type Phase4State = {
  cap: number | null;
  spent: number;
  logPath: string | null;
};

const state: Phase4State = { cap: null, spent: 0, logPath: null };

export function resetPhase4Run(): void {
  state.cap = null;
  state.spent = 0;
  state.logPath = null;
}

export function configurePhase4Run(input: { tokenCap?: number | null; logPath?: string | null }): void {
  state.cap = input.tokenCap ?? null;
  state.spent = 0;
  state.logPath = input.logPath ?? null;
  if (state.logPath) {
    mkdirSync(path.dirname(state.logPath), { recursive: true });
    writeFileSync(state.logPath, "");
  }
}

export function phase4TokensSpent(): number {
  return state.spent;
}

export function assertPhase4Budget(): void {
  if (state.cap != null && state.spent >= state.cap) {
    throw new Phase4Stop(`token cap ${state.cap} reached at ${state.spent}`);
  }
}

function redact(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 240);
}

export function notePhase4Tokens(usage: TokenUsage | null): void {
  if (!usage || !Number.isFinite(usage.total_tokens)) return;
  state.spent += usage.total_tokens;
  if (state.cap != null && state.spent >= state.cap) {
    throw new Phase4Stop(`token cap ${state.cap} reached at ${state.spent}`);
  }
}

export function logPhase4Call(input: {
  stage: string;
  coach: string;
  promptVersion: string;
  tokens: number | null;
  result: string;
  firstFailure: string;
}): void {
  if (!state.logPath) return;
  const line = [
    input.stage || "-",
    input.coach,
    input.promptVersion,
    `tokens=${input.tokens ?? "null"}`,
    `result=${input.result}`,
    `first=${redact(input.firstFailure || "-")}`,
  ].join(" ");
  appendFileSync(state.logPath, `${line}\n`);
}
