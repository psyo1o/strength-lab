import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { TokenUsage } from "../coaching/trace";

/** 이번 실행 전체 상한. 넘으면 다음 호출 전에 멈춘다. */
export const PHASE4_TOKEN_CAP = 4_000_000;

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

/** 기본 상한은 4000000이다. PHASE4_TOKEN_CAP이 양수면 그 실행의 상한이다. PHASE4_REMAINING_CAP은 그 값보다 작을 때만 더 줄인다. */
export function phase4RunCap(env: NodeJS.ProcessEnv = process.env): number {
  const override = Number(env.PHASE4_TOKEN_CAP ?? "");
  const base = Number.isFinite(override) && override > 0 ? override : PHASE4_TOKEN_CAP;
  const remaining = Number(env.PHASE4_REMAINING_CAP ?? "");
  if (Number.isFinite(remaining) && remaining > 0) return Math.min(remaining, base);
  return base;
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
