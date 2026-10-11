import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import type { DayKey } from "../src/lib/month-plan/types";
import { MAX_DAY_SCHEMA_RECOVERIES } from "../src/lib/programming/coaching/day-recovery";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { movementCatalog } from "../src/lib/programming/coaching/pieces";
import { coachWeek, type CoachWeekInput } from "../src/lib/programming/coaching/pipeline";
import { HEAD_COACH_PROMPT_VERSION } from "../src/lib/programming/coaching/prompts";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { COACHING_POLICY } from "../src/lib/programming/coaching/stage13/policy";
import { MOVEMENT_EQUIPMENT } from "../src/lib/programming/coaching/stage13/units";
import { headStanceOf } from "../src/lib/programming/coaching/stage16/pass";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { getProgrammingWeek } from "../src/lib/programming/store";
import type { MonthDirection, SessionDraft, WeeklyIntentPlan } from "../src/lib/programming/types";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const KEY = "sk-phase1-compliance";
const WEEK = "2099-07-06";

type Mode = "amount_only" | "extra_movement" | "exact_replace" | "both_fail" | "no_session" | "coarse" | "prose" | "recover" | "block";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-phase1-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function chat(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function weeklyJson(plan: WeeklyIntentPlan) {
  return {
    block_phase: plan.block_phase,
    emphasis: plan.emphasis,
    why_ko: plan.why_ko,
    focus: plan.focus,
    scheme_note: plan.scheme_note,
    adjustment_ko: plan.adjustment_ko,
    days: plan.days,
  };
}

function sessionJson(session: SessionDraft) {
  const piece = session.conditioning;
  if (!piece) return { day: session.day, notes_ko: "휴식입니다.", conditioning: null };
  return {
    day: session.day,
    notes_ko: "이 날의 컨디셔닝 목적을 유지합니다.",
    conditioning: {
      format: piece.format,
      duration_min: piece.duration_min,
      stimulus: piece.stimulus,
      movements: piece.movements.map((movement) => ({ ...movement })),
      equipment: [...piece.equipment],
      volume: piece.volume,
      intensity: piece.intensity,
      interval_work_sec: piece.format === "intervals" ? 30 : null,
      interval_rest_sec: piece.format === "intervals" ? 30 : null,
    },
  };
}

function bumpAmount(amount: string): string {
  return amount.replace(/^\d+/, (value) => String(Number(value) + 1));
}

function withAmounts(session: SessionDraft, keys: readonly string[]) {
  const full = sessionJson(session);
  const conditioning = full.conditioning as { movements?: Array<{ key: string; amount: string }> } | null;
  if (conditioning?.movements) {
    conditioning.movements = conditioning.movements.map((movement) =>
      keys.includes(movement.key) ? { ...movement, amount: bumpAmount(movement.amount) } : movement,
    );
  }
  return full;
}

function repsOnly(session: SessionDraft) {
  const full = sessionJson(session);
  const conditioning = full.conditioning as { movements?: Array<{ amount?: string }> } | null;
  if (conditioning?.movements) conditioning.movements = conditioning.movements.map((movement) => ({ ...movement, amount: "reps" }));
  return full;
}

function replacementFor(session: SessionDraft) {
  const used = new Set((session.conditioning?.movements ?? []).map((movement) => movement.key));
  const pick = movementCatalog().find((row) => !used.has(row.key) && MOVEMENT_EQUIPMENT[row.key] == null);
  if (!pick) throw new Error("no bodyweight replacement in the catalog");
  return pick;
}

function withReplacement(session: SessionDraft, key: string) {
  const next = replacementFor(session);
  const full = sessionJson(session);
  const conditioning = full.conditioning as { movements?: Array<{ key: string; amount: string; name_ko: string }> } | null;
  if (conditioning?.movements) {
    conditioning.movements = conditioning.movements.map((movement) =>
      movement.key === key ? { key: next.key, amount: "8", name_ko: next.name_ko } : movement,
    );
  }
  return { body: full, replacement: next.key };
}

function agentOf(user: Record<string, unknown>): string {
  if (typeof user.agent_name === "string") return user.agent_name;
  const context = user.context;
  if (context && typeof context === "object" && "agent" in context) {
    const agent = String((context as { agent?: unknown }).agent);
    if (agent === "conditioning" || agent === "strength" || agent === "warmup") return `${agent}_coach`;
    return `context:${agent}`;
  }
  const original = user.original_input;
  if (original && typeof original === "object" && typeof (original as { agent_name?: unknown }).agent_name === "string") {
    return String((original as { agent_name: string }).agent_name);
  }
  return "unknown";
}

function dayOf(user: Record<string, unknown>): string {
  const direct = (user.day_intent as { day?: string } | undefined)?.day;
  if (direct) return direct;
  const original = user.original_input as { day_intent?: { day?: string } } | undefined;
  return original?.day_intent?.day ?? "";
}

function revisionOf(user: Record<string, unknown>): number {
  const context = user.context as { revision_number?: number } | undefined;
  const original = user.original_input as { revision_number?: number } | undefined;
  return Number(user.revision_number ?? context?.revision_number ?? original?.revision_number ?? 0);
}

type Target = { day: DayKey; key: string; other: string; session: SessionDraft };

function targetOf(sessions: readonly SessionDraft[]): Target {
  const training = sessions.filter((session) => session.conditioning && session.conditioning.movements.length >= 2);
  const session = training.find((row) => row.conditioning?.movements.some((movement) => movement.key === "box_jump")) ?? training[0];
  if (!session?.conditioning) throw new Error("no multi-movement day");
  const key = session.conditioning.movements.find((movement) => movement.key === "box_jump")?.key ?? session.conditioning.movements[0]!.key;
  const other = session.conditioning.movements.find((movement) => movement.key !== key)?.key ?? key;
  return { day: session.day, key, other, session };
}

function headBody(mode: Mode, target: Target) {
  if (mode === "block" || mode === "recover") {
    return { status: mode === "block" ? "BLOCK" : "APPROVE", note_ko: mode === "block" ? "이 주는 채택할 수 없습니다." : "이번 주는 유지합니다.", revisions: [], adjustments: [] };
  }
  const machine = mode !== "coarse" && mode !== "prose";
  const replace = mode === "amount_only" || mode === "exact_replace" || mode === "both_fail" || mode === "no_session";
  const only = mode === "extra_movement" || mode === "amount_only";
  return {
    status: "REVISE",
    note_ko: "지정한 날의 컨디셔닝만 다시 씁니다.",
    revisions: [
      {
        day: target.day,
        reason: "이 날의 컨디셔닝이 목적과 어긋납니다.",
        correction_instruction:
          mode === "prose" ? "box_jump를 다른 허용 동작으로 바꾸세요." : "지시한 범위만 고치고 나머지 구성은 유지하세요.",
        priority: "high",
        constraints: "다른 날과 주간 뼈대는 바꾸지 않습니다.",
        target_coach: "conditioning_coach",
        preserve: machine ? ["weekly_strength_progression", "warmup", `keep_movement:${target.other}`] : ["weekly_strength_progression", "warmup"],
        allowed_changes: [
          ...(replace ? [`replace_movement:${target.key}`] : []),
          ...(only ? [`only_movement:${target.key}`] : []),
          ...(mode === "coarse" || mode === "prose" ? ["movement_selection"] : []),
        ],
        forbidden_changes: ["other_days", "locked_weekly_structure"],
      },
    ],
    adjustments: [],
  };
}

function harness(mode: Mode) {
  const month = month531();
  const plan = planCoachedWeek({ month, weekIndex: 1 });
  const built = assembleLegalWeek({ month, weekIndex: 1, plan });
  const target = targetOf(built.draft.sessions);
  const calls: Array<{ agent: string; day: string; revision: number; recovery: boolean; user: Record<string, unknown> }> = [];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const user = JSON.parse(body.messages?.find((message) => message.role === "user")?.content ?? "{}") as Record<string, unknown>;
    const agent = agentOf(user);
    const day = dayOf(user);
    const original = user.original_input as { day_recovery?: unknown } | undefined;
    const recovery = Boolean(user.day_recovery ?? original?.day_recovery);
    const revision = revisionOf(user);
    calls.push({ agent, day, revision, recovery, user });
    if (agent === "monthly_coach" || agent === "context:monthly") {
      const monthly = deterministicMonthlyPlan(month);
      return chat({ ...monthly, fatigue_tolerance: "moderate", variety_requirement: "moderate" });
    }
    if (agent === "weekly_coach" || agent === "context:weekly") return chat(weeklyJson(plan));
    if (agent === "strength_coach") return chat({ day, strength_note_ko: `모델 ${day} 스트렝스 목적을 유지합니다.` });
    if (agent === "warmup_coach") return chat({ day, warmup_ko: `모델 ${day} 준비 동작을 먼저 합니다.` });
    if (agent === "conditioning_coach") {
      const session = built.draft.sessions.find((row) => row.day === day);
      if (!session) return chat({ day });
      if (mode === "recover" && day === "mon" && !recovery) return chat(repsOnly(session));
      if (mode === "no_session" && day === target.day && (revision === 0 || recovery)) return chat(repsOnly(session));
      if ((mode === "amount_only" || mode === "both_fail" || mode === "prose" || mode === "no_session") && day === target.day && revision > 0 && !recovery) {
        return chat(withAmounts(session, [target.key]));
      }
      if (mode === "extra_movement" && day === target.day && revision > 0 && !recovery) {
        return chat(withAmounts(session, session.conditioning?.movements.map((movement) => movement.key) ?? []));
      }
      if (mode === "exact_replace" && day === target.day && revision > 0 && !recovery) return chat(withReplacement(session, target.key).body);
      return chat(sessionJson(session));
    }
    if (agent === "load_coach" || agent === "context:load") {
      return chat({
        decisions: plan.days
          .filter((row) => row.primary_training !== "rest" && row.recovery_role !== "rest")
          .map((row) => ({ day: row.day, action: "hold", reason_ko: "방법 표를 유지합니다.", target_effort: "moderate", relative_intensity: "same" })),
      });
    }
    if (agent === "head_coach" || agent === "context:head") return chat(headBody(mode, target));
    return chat({ status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [], adjustments: [] });
  };
  const input: CoachWeekInput = { month, weekIndex: 1, weekStart: WEEK, key: KEY, fetchImpl, timeoutMs: 1000 };
  return { fetchImpl, calls, plan, input, target };
}

async function run(mode: Mode) {
  const built = harness(mode);
  const result = await coachWeek(built.input);
  return { ...built, result };
}

function movementsOf(session: { conditioning?: { movements?: unknown } | null } | null | undefined) {
  return JSON.stringify(session?.conditioning?.movements ?? null);
}

function revisionCalls(calls: Array<{ agent: string; day: string; revision: number; recovery: boolean }>, day: string) {
  return calls.filter((call) => call.agent === "conditioning_coach" && call.day === day && call.revision > 0 && !call.recovery);
}

function complianceTraces(result: Awaited<ReturnType<typeof run>>["result"]) {
  return result.traces.filter((trace) => trace.agent_name === "revision_compliance");
}

describe("phase 1 revision compliance", () => {
  it("A rejects an amount-only change when the spec requires a movement replacement", async () => {
    const { result, calls, target } = await run("amount_only");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    expect(movementsOf(after)).toContain(target.key);
    expect(result.day_records?.[target.day]?.day_status).not.toBe("FAILED");
    expect(result.day_records?.[target.day]?.final_prescription).not.toBeNull();
    const traces = complianceTraces(result);
    expect(traces.length).toBeGreaterThan(0);
    expect(traces.some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(false);
    expect(traces.every((trace) => trace.token_usage == null)).toBe(true);
    expect(revisionCalls(calls, target.day)).toHaveLength(2);
    expect(calls.some((call) => call.agent === "conditioning_coach" && call.revision >= 3)).toBe(false);
  });

  it("B rejects a second movement when only one movement may change", async () => {
    const { result, calls, target } = await run("extra_movement");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    const traces = complianceTraces(result);
    expect(JSON.stringify(traces)).toContain(target.other);
    expect(traces.some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(false);
    expect(revisionCalls(calls, target.day)).toHaveLength(2);
  });

  it("C adopts a replacement that keeps the other movements and passes schema", async () => {
    const { result, calls, target } = await run("exact_replace");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    const replacement = replacementFor(target.session).key;
    expect(movementsOf(before)).toContain(target.key);
    expect(movementsOf(after)).not.toContain(`"${target.key}"`);
    expect(movementsOf(after)).toContain(replacement);
    expect(result.day_records?.[target.day]?.day_status).not.toBe("FAILED");
    expect(result.final_validation?.ok).toBe(true);
    const traces = complianceTraces(result);
    expect(traces.some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(true);
    expect(revisionCalls(calls, target.day)).toHaveLength(1);
    expect(calls.filter((call) => call.agent === "conditioning_coach" && call.day !== target.day && call.revision > 0)).toHaveLength(0);
  });

  it("D stops at the existing revision budget and keeps the last valid session", async () => {
    const { result, calls, target } = await run("both_fail");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    expect(result.day_records?.[target.day]?.day_status).not.toBe("FAILED");
    expect(result.generation_source).toBe("model");
    const revisions = revisionCalls(calls, target.day);
    expect(revisions).toHaveLength(2);
    expect(revisions.map((call) => call.revision)).toEqual([1, 2]);
    expect(JSON.stringify(revisions[1]?.user.revision)).toContain("compliance_feedback");
    expect(calls.some((call) => call.revision >= 3)).toBe(false);
    expect(COACHING_POLICY.max_head_revisions).toBe(2);
    const scope = result.traces.find((trace) => trace.agent_name === "revision_scope");
    expect((scope?.output as { budget?: number }).budget).toBe(2);
  });

  it("D leaves the day unresolved and does not adopt the week when no valid session exists", async () => {
    const { result, calls, target } = await run("no_session");
    expect(result.day_sources[target.day]).not.toBe("model");
    expect(result.day_records?.[target.day]?.day_status).toBe("FAILED");
    expect(result.day_records?.[target.day]?.final_prescription).toBeNull();
    expect(result.generation_source).not.toBe("model");
    expect(result.final_validation?.ok).toBe(false);
    const revisions = revisionCalls(calls, target.day);
    expect(revisions).toHaveLength(2);
    expect(JSON.stringify(revisions[1]?.user.revision)).toContain("compliance_feedback");
    expect(calls.some((call) => call.revision >= 3)).toBe(false);
    const bumped = bumpAmount(target.session.conditioning?.movements.find((movement) => movement.key === target.key)?.amount ?? "");
    expect(movementsOf(result.draft.sessions.find((session) => session.day === target.day))).not.toContain(`"amount":"${bumped}"`);
  });

  it("E leaves every other day untouched", async () => {
    const { result, target } = await run("exact_replace");
    for (const day of result.plan.days.map((row) => row.day)) {
      if (day === target.day) continue;
      const after = result.draft.sessions.find((session) => session.day === day);
      const before = result.day_records?.[day]?.original_model_output ?? result.draft.sessions.find((session) => session.day === day);
      if (result.day_records?.[day]?.original_model_output) {
        expect(movementsOf(after)).toBe(movementsOf(result.day_records?.[day]?.original_model_output));
        expect(after?.warmup_ko).toBe(result.day_records?.[day]?.original_model_output?.warmup_ko);
        expect(JSON.stringify(after?.strength)).toBe(JSON.stringify(result.day_records?.[day]?.original_model_output?.strength));
      }
      expect(before).toBeTruthy();
    }
    expect(result.draft.sessions.filter((session) => session.day !== target.day && !session.rest).every((session) => session.warmup_ko.includes("모델"))).toBe(true);
  });

  it("does not adopt a prose movement name that has no machine token", async () => {
    const { result, target } = await run("prose");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    const traces = complianceTraces(result);
    expect(JSON.stringify(traces)).toContain("box_jump");
    expect(traces.some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(false);
  });

  it("F keeps schema recovery, the revision budget, BLOCK, and a coarse revision", async () => {
    expect(MAX_DAY_SCHEMA_RECOVERIES).toBe(1);
    expect(COACHING_POLICY.max_head_revisions).toBe(2);
    expect(headStanceOf({ status: "BLOCK" })).toBe("ACCEPT_WITH_NOTE");
    expect(HEAD_COACH_PROMPT_VERSION).toBe("head-coach-v5");

    const recovered = await run("recover");
    expect(recovered.calls.some((call) => call.agent === "conditioning_coach" && call.day === "mon" && call.recovery)).toBe(true);
    expect(recovered.result.day_sources.mon).toBe("model");
    expect(recovered.result.day_records?.mon?.revision_reason).toBe("schema recovery");
    expect(recovered.result.generation_source).toBe("model");
    expect(recovered.result.final_validation?.ok).toBe(true);

    const blocked = await run("block");
    expect(blocked.result.generation_source).not.toBe("model");
    expect(blocked.result.final_validation?.ok).toBe(false);
    expect(blocked.result.traces.some((trace) => trace.agent_name === "approval_refused")).toBe(true);
    expect(blocked.result.revision_count).toBe(0);

    const coarse = await run("coarse");
    const adopted = coarse.result.traces.filter((trace) => trace.agent_name === "revision_compliance");
    expect(adopted.some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(true);
    expect(adopted.some((trace) => JSON.stringify(trace.output).includes("rejected") || JSON.stringify(trace.output).includes("unresolved"))).toBe(false);
    expect(revisionCalls(coarse.calls, coarse.target.day)).toHaveLength(1);
    expect(coarse.result.day_records?.[coarse.target.day]?.day_status).not.toBe("FAILED");
    expect(coarse.result.generation_source).toBe("model");
  });
});

describe("phase 1 storage", () => {
  beforeEach(() => freshDb());

  it("does not store a week whose only revision target never had a valid session", async () => {
    const unresolved = harness("no_session");
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: KEY, fetchImpl: unresolved.fetchImpl });
    expect(saved.status).toBe("failed");
    expect(saved.generationSource).not.toBe("model");
    expect(getProgrammingWeek(WEEK)).toBeNull();
  });
});
