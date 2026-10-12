import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import type { DayKey } from "../src/lib/month-plan/types";
import { editItemErrors } from "../src/lib/programming/coaching/contract";
import { MAX_DAY_SCHEMA_RECOVERIES } from "../src/lib/programming/coaching/day-recovery";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { catalogMovement, prescribedLoad, rangeFor, sampleAmount } from "../src/lib/programming/coaching/movement-catalog";
import { movementCatalog } from "../src/lib/programming/coaching/pieces";
import { coachWeek, type CoachWeekInput } from "../src/lib/programming/coaching/pipeline";
import {
  CONDITIONING_COACH_PROMPT_VERSION,
  HEAD_COACH_PROMPT_VERSION,
  STRENGTH_COACH_PROMPT_VERSION,
  WARMUP_COACH_PROMPT_VERSION,
  coachSystemPrompt,
} from "../src/lib/programming/coaching/prompts";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { COACHING_POLICY } from "../src/lib/programming/coaching/stage13/policy";
import { MOVEMENT_EQUIPMENT } from "../src/lib/programming/coaching/stage13/units";
import { headStanceOf } from "../src/lib/programming/coaching/stage16/pass";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { getProgrammingWeek } from "../src/lib/programming/store";
import { SIMILARITY_CONFIG } from "../src/lib/programming/types";
import type { MonthDirection, SessionDraft, WeeklyIntentPlan } from "../src/lib/programming/types";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const KEY = "sk-phase1-compliance";
const WEEK = "2099-07-06";

type Mode = "prose" | "amount_exact" | "amount_extra" | "replace_exact" | "replace_amount" | "no_session" | "recover" | "block" | "budget";

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

function slotFrom(user: Record<string, unknown> | undefined): {
  primary_keys?: string[];
  format?: string;
  duration_min?: number;
  stimulus?: string;
  volume?: string;
} | null {
  if (!user) return null;
  const read = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const slot = value as { primary_keys?: string[]; format?: string; duration_min?: number; stimulus?: string; volume?: string };
    return slot.primary_keys?.length ? slot : null;
  };
  return read(user.conditioning_slot) ?? read((user.original_input as { conditioning_slot?: unknown } | undefined)?.conditioning_slot);
}

function goalMovements(keys: readonly string[]) {
  return keys.map((key) => ({
    key,
    movement: key,
    amount: sampleAmount(key),
    unit: catalogMovement(key)?.units[0] ?? "reps",
    name_ko: movementCatalog().find((row) => row.key === key)?.name_ko ?? catalogMovement(key)?.name_ko ?? key,
    load: prescribedLoad(key),
  }));
}

function sessionJson(session: SessionDraft, user?: Record<string, unknown>) {
  const piece = session.conditioning;
  if (!piece) return { day: session.day, notes_ko: "휴식입니다.", conditioning: null };
  const slot = slotFrom(user);
  const movements = slot?.primary_keys?.length
    ? goalMovements(slot.primary_keys)
    : piece.movements.map((movement) => ({ ...movement, load: movement.load ?? prescribedLoad(movement.key) }));
  return {
    day: session.day,
    notes_ko: "이 날의 컨디셔닝 목적을 유지합니다.",
    conditioning: {
      format: slot?.format ?? piece.format,
      duration_min: slot?.duration_min ?? piece.duration_min,
      stimulus: slot?.stimulus ?? piece.stimulus,
      movements,
      equipment: [...piece.equipment],
      volume: slot?.volume ?? piece.volume,
      intensity: piece.intensity,
      interval_work_sec: (slot?.format ?? piece.format) === "intervals" ? 30 : null,
      interval_rest_sec: (slot?.format ?? piece.format) === "intervals" ? 30 : null,
    },
  };
}

function nextCount(amount: string): string {
  return String(Number(amount.match(/^\d+/)?.[0] ?? "8") + 1);
}

function withAmounts(session: SessionDraft, keys: readonly string[], user?: Record<string, unknown>) {
  const full = sessionJson(session, user);
  const conditioning = full.conditioning as { movements?: Array<{ key: string; amount: string }> } | null;
  if (conditioning?.movements) {
    conditioning.movements = conditioning.movements.map((movement) =>
      keys.includes(movement.key) ? { ...movement, amount: nextCount(movement.amount) } : movement,
    );
  }
  return full;
}

function repsOnly(session: SessionDraft, user?: Record<string, unknown>) {
  const full = sessionJson(session, user);
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

function withReplacement(session: SessionDraft, key: string, user?: Record<string, unknown>) {
  const next = replacementFor(session);
  const full = sessionJson(session, user);
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

type Target = { day: DayKey; key: string; other: string; session: SessionDraft; nextAmount: string };

function targetOf(month: MonthDirection): Target {
  const day = deterministicMonthlyPlan(month).goal_table?.weeks.find((week) => week.week_index === 1)?.days.find((row) => !row.rest && row.primary_keys.length >= 2);
  if (!day) throw new Error("no multi-movement day");
  const key =
    day.primary_keys.find((candidate) => {
      const range = rangeFor(candidate, "reps");
      return Boolean(range && range.min <= 20 && range.max >= 20);
    }) ?? day.primary_keys[0]!;
  const other = day.primary_keys.find((candidate) => candidate !== key) ?? key;
  const session = {
    day: day.day,
    conditioning: {
      movements: day.primary_keys.map((candidate) => ({
        key: candidate,
        amount: sampleAmount(candidate),
        name_ko: catalogMovement(candidate)?.name_ko ?? candidate,
      })),
    },
  } as SessionDraft;
  return { day: day.day, key, other, session, nextAmount: nextCount(sampleAmount(key)) };
}

function edit(day: string, action: string, target: string | null, next: string | null, amount: string | null, unit: string | null, reason: string) {
  return {
    day,
    target_coach: "conditioning_coach",
    block: "conditioning",
    action,
    target_movement: target,
    new_movement: next,
    new_amount: amount,
    new_unit: unit,
    reason,
  };
}

function headBody(mode: Mode, target: Target, plan: WeeklyIntentPlan) {
  if (mode === "block" || mode === "recover") {
    return { status: mode === "block" ? "BLOCK" : "APPROVE", note_ko: mode === "block" ? "이 주는 채택할 수 없습니다." : "이번 주는 유지합니다.", revisions: [], adjustments: [] };
  }
  if (mode === "prose") {
    return {
      status: "REVISE",
      note_ko: "문장만 있는 지시는 편집이 아닙니다.",
      revisions: [
        {
          day: target.day,
          reason: "이 날의 컨디셔닝이 목적과 어긋납니다.",
          correction_instruction: "box_jump를 다른 허용 동작으로 바꾸세요.",
          target_coach: "conditioning_coach",
        },
      ],
      adjustments: [],
    };
  }
  if (mode === "budget") {
    const days = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").slice(0, 3);
    return {
      status: "REVISE",
      note_ko: "훈련일 세 곳의 수량만 바꿉니다.",
      revisions: days.map((day) => edit(day.day, "change_amount", "box_jump", null, "9", "reps", "이 동작의 수량만 바꿉니다.")),
      adjustments: [],
    };
  }
  if (mode === "replace_amount") {
    return {
      status: "REVISE",
      note_ko: "범위 밖 수량은 그 칸만 되돌립니다.",
      revisions: [
        {
          day: target.day,
          block: "conditioning",
          catalog_key: target.key,
          field: "amount",
          value: "99999",
          reason: "This amount is outside the catalog range.",
        },
      ],
      adjustments: [],
    };
  }
  const replacement = replacementFor(target.session).key;
  const row =
    mode === "amount_exact" || mode === "amount_extra"
      ? edit(target.day, "change_amount", target.key, null, "20", "reps", "이 동작의 수량만 바꿉니다.")
      : edit(target.day, "replace", target.key, replacement, "8", "reps", "이 동작을 다른 허용 동작으로 바꿉니다.");
  return { status: "REVISE", note_ko: "지정한 편집만 적용합니다.", revisions: [row], adjustments: [] };
}

function harness(mode: Mode) {
  const month = month531();
  const plan = planCoachedWeek({ month, weekIndex: 1 });
  const built = assembleLegalWeek({ month, weekIndex: 1, plan });
  const target = targetOf(month);
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
      if (mode === "recover" && day === "mon" && !recovery) return chat(repsOnly(session, user));
      if (mode === "no_session" && day === target.day && (revision === 0 || recovery)) return chat(repsOnly(session, user));
      if (mode === "amount_exact" && day === target.day && revision > 0 && !recovery) return chat(withAmounts(session, [target.key], user));
      if ((mode === "amount_extra" || mode === "replace_amount") && day === target.day && revision > 0 && !recovery) {
        const keys = mode === "amount_extra" ? (slotFrom(user)?.primary_keys ?? session.conditioning?.movements.map((movement) => movement.key) ?? []) : [target.key];
        return chat(withAmounts(session, keys, user));
      }
      if ((mode === "replace_exact" || mode === "no_session") && day === target.day && revision > 0 && !recovery) {
        return chat(mode === "replace_exact" ? withReplacement(session, target.key, user).body : withAmounts(session, [target.key], user));
      }
      return chat(sessionJson(session, user));
    }
    if (agent === "load_coach" || agent === "context:load") {
      return chat({
        decisions: plan.days
          .filter((row) => row.primary_training !== "rest" && row.recovery_role !== "rest")
          .map((row) => ({ day: row.day, action: "hold", reason_ko: "방법 표를 유지합니다.", target_effort: "moderate", relative_intensity: "same" })),
      });
    }
    if (agent === "head_coach" || agent === "context:head") return chat(headBody(mode, target, plan));
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

describe("explicit edit list", () => {
  it("rejects a sentence and asks the head once", async () => {
    const { result, calls, target } = await run("prose");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    const head = result.traces.find((trace) => trace.agent_name === "head_coach");
    expect(head?.retry_count).toBe(1);
    expect(JSON.stringify(head?.validation_errors)).toContain("prose-only");
    expect(calls.filter((call) => call.agent === "head_coach")).toHaveLength(1);
    expect(calls.filter((call) => call.agent === "context:head")).toHaveLength(1);
    expect(complianceTraces(result).some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(false);
    expect(result.revision_count).toBe(0);
    expect(result.generation_source).toBe("model");
  });

  it("adopts a change_amount that touches only the named movement", async () => {
    const { result, calls, target } = await run("amount_exact");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    const beforeMoves = before?.conditioning?.movements ?? [];
    const afterMoves = after?.conditioning?.movements ?? [];
    expect(afterMoves.find((movement) => movement.key === target.key)?.amount).toBe("20");
    expect(afterMoves.find((movement) => movement.key === target.other)?.amount).toBe(beforeMoves.find((movement) => movement.key === target.other)?.amount);
    expect(afterMoves.map((movement) => movement.key)).toEqual(beforeMoves.map((movement) => movement.key));
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    const traces = complianceTraces(result);
    expect(traces).toHaveLength(1);
    expect(JSON.stringify(traces[0]?.output)).toContain("success");
    expect(traces[0]?.token_usage).toBeNull();
    expect(traces[0]?.retry_count).toBe(0);
    expect(result.final_validation?.ok).toBe(true);
    expect(result.generation_source).toBe("model");
    expect(calls.filter((call) => call.agent === "conditioning_coach" && call.day !== target.day && call.revision > 0)).toHaveLength(0);
  });

  it("changes only the named cell and does not call the specialist", async () => {
    const { result, calls, target } = await run("amount_extra");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    const beforeMoves = before?.conditioning?.movements ?? [];
    const afterMoves = after?.conditioning?.movements ?? [];
    expect(afterMoves.find((movement) => movement.key === target.key)?.amount).toBe("20");
    expect(afterMoves.find((movement) => movement.key === target.other)?.amount).toBe(beforeMoves.find((movement) => movement.key === target.other)?.amount);
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    expect(JSON.stringify(complianceTraces(result)[0]?.output)).toContain("success");
    expect(result.day_records?.[target.day]?.day_status).not.toBe("FAILED");
    expect(result.generation_source).toBe("model");
    expect(calls.some((call) => call.revision >= 3)).toBe(false);
  });

  it("adopts a replacement and leaves every other day", async () => {
    const { result, calls, target } = await run("replace_exact");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    const replacement = replacementFor(target.session).key;
    expect(movementsOf(before)).toContain(target.key);
    expect(movementsOf(after)).not.toContain(`"${target.key}"`);
    expect(movementsOf(after)).toContain(replacement);
    expect(after?.conditioning?.movements.find((movement) => movement.key === target.other)?.amount).toBe(
      before?.conditioning?.movements.find((movement) => movement.key === target.other)?.amount,
    );
    expect(result.day_records?.[target.day]?.day_status).not.toBe("FAILED");
    expect(result.final_validation?.ok).toBe(true);
    expect(complianceTraces(result).some((trace) => JSON.stringify(trace.output).includes("success"))).toBe(true);
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    for (const day of result.plan.days.map((row) => row.day)) {
      if (day === target.day) continue;
      const kept = result.day_records?.[day]?.original_model_output;
      if (!kept) continue;
      const session = result.draft.sessions.find((row) => row.day === day);
      expect(movementsOf(session)).toBe(movementsOf(kept));
      expect(session?.warmup_ko).toBe(kept.warmup_ko);
      expect(JSON.stringify(session?.strength)).toBe(JSON.stringify(kept.strength));
    }
  });

  it("does not adopt an amount change when the edit says replace", async () => {
    const { result, calls, target } = await run("replace_amount");
    const before = result.day_records?.[target.day]?.original_model_output;
    const after = result.draft.sessions.find((session) => session.day === target.day);
    expect(movementsOf(after)).toBe(movementsOf(before));
    expect(movementsOf(after)).toContain(`"amount":"${target.session.conditioning?.movements.find((movement) => movement.key === target.key)?.amount}"`);
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    expect(result.traces.some((trace) => trace.agent_name === "revision_rejected" && JSON.stringify(trace.output).includes("rejected"))).toBe(true);
    expect(result.generation_source).toBe("model");
  });

  it("leaves the day failed when no valid session exists and the edit is not applied", async () => {
    const { result, calls, target } = await run("no_session");
    expect(result.day_sources[target.day]).not.toBe("model");
    expect(result.day_records?.[target.day]?.day_status).toBe("FAILED");
    expect(result.day_records?.[target.day]?.final_prescription).toBeNull();
    expect(result.generation_source).not.toBe("model");
    expect(result.final_validation?.ok).toBe(false);
    expect(revisionCalls(calls, target.day)).toHaveLength(0);
    expect(calls.some((call) => call.revision >= 3)).toBe(false);
    expect(movementsOf(result.draft.sessions.find((session) => session.day === target.day))).not.toContain(`"amount":"${target.nextAmount}"`);
  });

  it("sends field, current value, and required format on schema recovery", async () => {
    expect(MAX_DAY_SCHEMA_RECOVERIES).toBe(1);
    expect(COACHING_POLICY.max_head_revisions).toBe(2);
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    expect(headStanceOf({ status: "BLOCK" })).toBe("ACCEPT_WITH_NOTE");
    expect(HEAD_COACH_PROMPT_VERSION).toBe("head-coach-v8");
    expect(STRENGTH_COACH_PROMPT_VERSION).toBe("strength-coach-v2");
    expect(CONDITIONING_COACH_PROMPT_VERSION).toBe("conditioning-coach-v5");
    expect(WARMUP_COACH_PROMPT_VERSION).toBe("warmup-coach-v2");
    expect(coachSystemPrompt("conditioning")).toContain("edit_list");
    expect(coachSystemPrompt("conditioning")).toContain("not in edit_list");
    expect(coachSystemPrompt("head")).toContain("A sentence without those fields is invalid");
    expect(coachSystemPrompt("strength")).toContain("field_edits");

    const recovered = await run("recover");
    const recovery = recovered.calls.find((call) => call.agent === "conditioning_coach" && call.day === "mon" && call.recovery);
    const fieldEdits = (recovery?.user.day_recovery as { field_edits?: Array<{ field?: string; current_value?: string; required_format?: string }> } | undefined)?.field_edits ?? [];
    expect(fieldEdits.some((row) => String(row.field).includes("amount") && row.current_value === "reps" && String(row.required_format).length > 0)).toBe(true);
    expect(recovered.result.day_sources.mon).toBe("model");
    expect(recovered.result.day_records?.mon?.revision_reason).toBe("schema recovery");
    expect(recovered.result.generation_source).toBe("model");
    expect(recovered.result.final_validation?.ok).toBe(true);
  });

  it("stops at two specialist rewrites and refuses BLOCK", async () => {
    const budget = await run("budget");
    const revisions = budget.calls.filter((call) => call.agent === "conditioning_coach" && call.revision > 0 && !call.recovery);
    expect(revisions).toHaveLength(0);
    expect(budget.calls.some((call) => call.revision >= 3)).toBe(false);
    expect(budget.result.traces.some((trace) => trace.agent_name === "revision_scope")).toBe(false);
    expect(budget.result.traces.some((trace) => trace.agent_name === "head_cell_apply")).toBe(true);
    expect(budget.result.generation_source).toBe("model");
    expect(Object.values(budget.result.day_records ?? {}).some((row) => row?.day_status === "FAILED")).toBe(false);

    const blocked = await run("block");
    expect(blocked.result.generation_source).not.toBe("model");
    expect(blocked.result.final_validation?.ok).toBe(false);
    expect(blocked.result.traces.some((trace) => trace.agent_name === "approval_refused")).toBe(true);
    expect(blocked.result.revision_count).toBe(0);
  });

  it("treats a sentence, a delete with an amount, and an add with a target as schema errors", () => {
    expect(editItemErrors({ day: "mon", reason: "문장만 있습니다." }, 0).join(" ")).toContain("prose-only");
    expect(editItemErrors({ day: "mon", target_coach: "conditioning_coach", block: "conditioning", action: "delete", target_movement: "box_jump", new_movement: null, new_amount: "8", new_unit: "reps", reason: "이 동작을 뺍니다." }, 0).join(" ")).toContain("null");
    expect(editItemErrors({ day: "mon", target_coach: "conditioning_coach", block: "conditioning", action: "add", target_movement: "box_jump", new_movement: "burpee", new_amount: "8", new_unit: "reps", reason: "동작을 더합니다." }, 0).join(" ")).toContain("null");
    expect(editItemErrors({ day: "mon", target_coach: "conditioning_coach", block: "conditioning", action: "change_amount", target_movement: "box_jump", new_movement: null, new_amount: "9", new_unit: "reps", reason: "수량만 바꿉니다." }, 0)).toEqual([]);
  });
});

describe("explicit edit list storage", () => {
  beforeEach(() => freshDb());

  it("does not store a week whose only revision target never had a valid session", async () => {
    const unresolved = harness("no_session");
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: KEY, fetchImpl: unresolved.fetchImpl });
    expect(saved.status).toBe("failed");
    expect(saved.generationSource).not.toBe("model");
    expect(getProgrammingWeek(WEEK)).toBeNull();
  });
});
