import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";
import { dryRunWeek } from "../src/lib/programming/admin-tools";
import { dayRecoveryPayload, recoveryDrift, rejectedRevisionSpecs, setTransientAreaRetryMs } from "../src/lib/programming/coaching/day-recovery";
import { catalogMovement, catalogUnits, prescribedLoad, rangeFor, sampleAmount } from "../src/lib/programming/coaching/movement-catalog";
import { movementCatalog as pieceNames } from "../src/lib/programming/coaching/pieces";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { coachWeek, type CoachWeekInput } from "../src/lib/programming/coaching/pipeline";
import { HEAD_COACH_PROMPT_VERSION, STAGE16_PIPELINE_VERSION } from "../src/lib/programming/coaching/prompts";
import { parseHeadReview } from "../src/lib/programming/coaching/review";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { headStanceOf } from "../src/lib/programming/coaching/stage16/pass";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { getProgrammingWeek } from "../src/lib/programming/store";
import { SIMILARITY_CONFIG, WEEKLY_PROMPT_VERSION, type MonthDirection, type SessionDraft, type WeeklyIntentPlan } from "../src/lib/programming/types";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const KEY = "sk-day-recovery";
const WEEK = "2099-07-06";

type Mode =
  | "recover"
  | "always_bad"
  | "keep_valid"
  | "bad_coach"
  | "bad_range"
  | "block"
  | "approve"
  | "field_fix"
  | "field_drift"
  | "cell_head"
  | "bad_cal"
  | "cell_fix"
  | "http_once"
  | "http_twice"
  | "timeout_once";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-day-recovery-"));
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
  from_goal?: boolean;
  time_domain?: string;
  primary_keys?: string[];
  format?: string;
  duration_min?: number;
  stimulus?: string;
  volume?: string;
} | null {
  if (!user) return null;
  const read = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const slot = value as { from_goal?: boolean; time_domain?: string; primary_keys?: string[]; format?: string; duration_min?: number; stimulus?: string; volume?: string };
    return slot.from_goal || slot.primary_keys?.length ? slot : null;
  };
  return read(user.conditioning_slot) ?? read((user.original_input as { conditioning_slot?: unknown } | undefined)?.conditioning_slot);
}

function durationForSlot(slot: { time_domain?: string; duration_min?: number }): number {
  if (slot.time_domain === "long") return 32;
  if (slot.time_domain === "medium") return 16;
  if (slot.time_domain === "short") return 10;
  return slot.duration_min ?? 12;
}

function goalMovements(keys: readonly string[]) {
  return keys.map((key) => ({
    key,
    movement: key,
    amount: sampleAmount(key),
    unit: catalogMovement(key)?.units[0] ?? "reps",
    name_ko: pieceNames().find((row) => row.key === key)?.name_ko ?? catalogMovement(key)?.name_ko ?? key,
    load: prescribedLoad(key),
  }));
}

function goalMondayKeys(): string[] {
  const month = month531();
  const plan = planCoachedWeek({ month, weekIndex: 1 });
  return assembleLegalWeek({ month, weekIndex: 1, plan }).draft.sessions.find((row) => row.day === "mon")?.conditioning?.movements.map((row) => row.key) ?? [];
}

function repsCellFromKeys(keys: readonly string[]): { key: string; value: string } | null {
  for (const key of keys) {
    if (!key || !catalogUnits(key)?.includes("reps")) continue;
    const range = rangeFor(key, "reps");
    const current = Number(sampleAmount(key));
    const candidate = range ? (current === range.min && range.max > range.min ? range.min + 1 : range.min) : current === 10 ? 11 : 10;
    if (range && (candidate < range.min || candidate > range.max)) continue;
    if (String(candidate) === sampleAmount(key)) continue;
    return { key, value: String(candidate) };
  }
  return null;
}

function sessionJson(session: SessionDraft, user?: Record<string, unknown>) {
  const piece = session.conditioning;
  if (!piece) return { day: session.day, notes_ko: "휴식입니다.", conditioning: null };
  const slot = slotFrom(user);
  const movements = slot?.primary_keys?.length
    ? goalMovements(slot.primary_keys)
    : piece.movements.map((row) => ({
        ...row,
        amount: sampleAmount(row.key),
        unit: catalogMovement(row.key)?.units[0] ?? "reps",
        load: row.load ?? prescribedLoad(row.key),
      }));
  const format = slot?.from_goal ? piece.format : (slot?.format ?? piece.format);
  const stimulus = slot?.stimulus ?? piece.stimulus;
  return {
    day: session.day,
    notes_ko: "이 날의 컨디셔닝 목적을 유지합니다.",
    conditioning: {
      format,
      duration_min: slot?.from_goal ? durationForSlot(slot) : (slot?.duration_min ?? piece.duration_min),
      stimulus,
      movements,
      equipment: piece.equipment,
      volume: slot?.volume ?? piece.volume,
      intensity: stimulus === "heavy" && piece.intensity === "light" ? "moderate" : piece.intensity,
      interval_work_sec: format === "intervals" ? 30 : null,
      interval_rest_sec: format === "intervals" ? 30 : null,
    },
  };
}

function repsOnly(session: SessionDraft, user?: Record<string, unknown>) {
  const full = sessionJson(session, user);
  const conditioning = full.conditioning as { movements?: Array<{ amount?: string }> } | null;
  if (conditioning?.movements) {
    conditioning.movements = conditioning.movements.map((movement) => ({ ...movement, amount: "reps" }));
  }
  return full;
}

function illegalAmount(session: SessionDraft, user?: Record<string, unknown>) {
  const full = sessionJson(session, user);
  const conditioning = full.conditioning as { movements?: Array<{ key?: string; amount?: string }> } | null;
  const movements = conditioning?.movements ?? [];
  const cell = repsCellFromKeys(movements.map((row) => row.key ?? ""));
  const target = movements.find((row) => row.key === cell?.key) ?? movements[0];
  if (target) target.amount = "10회/라운드";
  return full;
}

function driftedRecovery(session: SessionDraft, user?: Record<string, unknown>) {
  const full = sessionJson(session, user);
  full.notes_ko = "형식을 바꿉니다.";
  const conditioning = full.conditioning as {
    format?: string;
    interval_work_sec?: number | null;
    interval_rest_sec?: number | null;
  } | null;
  if (!conditioning) return full;
  conditioning.format = conditioning.format === "amrap" ? "for_time" : "amrap";
  conditioning.interval_work_sec = null;
  conditioning.interval_rest_sec = null;
  return full;
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

function headBody(mode: Mode, plan: WeeklyIntentPlan) {
  const training = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day);
  const rest = plan.days.find((day) => day.primary_training === "rest" || day.recovery_role === "rest")?.day ?? "sun";
  if (mode === "block") {
    return { status: "BLOCK", note_ko: "이 주는 채택할 수 없습니다.", revisions: [], adjustments: [] };
  }
  if (mode === "bad_coach") {
    return {
      status: "REVISE",
      note_ko: "담당이 아닌 코치입니다.",
      revisions: [
        {
          day: training[0] ?? "mon",
          reason: "부하 코치는 이 날을 고치지 않습니다.",
          correction_instruction: "컨디셔닝 코치만 고칠 수 있습니다.",
          priority: "high",
          constraints: "주간 뼈대는 유지합니다.",
          target_coach: "load_coach",
          preserve: ["weekly_strength_progression"],
          allowed_changes: ["conditioning"],
          forbidden_changes: ["other_days"],
        },
      ],
      adjustments: [],
    };
  }
  if (mode === "bad_range") {
    return {
      status: "REVISE",
      note_ko: "허용되지 않은 범위입니다.",
      revisions: [
        {
          day: rest,
          reason: "휴식일은 수정 대상이 아닙니다.",
          correction_instruction: "훈련일만 고치세요.",
          priority: "high",
          constraints: "월간 방법은 바꾸지 않습니다.",
          target_coach: "conditioning_coach",
          preserve: ["weekly_strength_progression"],
          allowed_changes: ["monthly_training_method"],
          forbidden_changes: ["other_days"],
        },
      ],
      adjustments: [],
    };
  }
  if (mode === "cell_head") {
    const cell = repsCellFromKeys(goalMondayKeys());
    return {
      status: "REVISE",
      note_ko: "월요일 수량만 바꿉니다.",
      revisions: [
        {
          day: "mon",
          block: "conditioning",
          catalog_key: cell?.key ?? "wall_ball",
          field: "amount",
          value: cell?.value ?? "15",
          reason: "이 동작의 수량만 바꿉니다.",
        },
      ],
      adjustments: [],
    };
  }
  if (mode === "bad_cal") {
    return {
      status: "REVISE",
      note_ko: "더블 언더 단위가 아닙니다.",
      revisions: [
        {
          day: "mon",
          block: "conditioning",
          catalog_key: "double_under",
          field: "amount",
          value: "60cal",
          reason: "칼로리로 바꾸라는 지시는 거절됩니다.",
        },
      ],
      adjustments: [],
    };
  }
  if (mode === "keep_valid") {
    return {
      status: "REVISE",
      note_ko: "월요일 컨디셔닝만 다시 봅니다.",
      revisions: [
        {
          day: "mon",
          target_coach: "conditioning_coach",
          block: "conditioning",
          action: "change_amount",
          target_movement: "box_jump",
          new_movement: null,
          new_amount: "9",
          new_unit: "reps",
          reason: "이 날의 수량만 바꿉니다.",
        },
      ],
      adjustments: [],
    };
  }
  return { status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [], adjustments: [] };
}

function harness(mode: Mode) {
  const month = month531();
  const plan = planCoachedWeek({ month, weekIndex: 1 });
  const built = assembleLegalWeek({ month, weekIndex: 1, plan });
  const calls: Array<{ agent: string; day: string; user: Record<string, unknown> }> = [];
  const transport = { conditioning: 0, warmup: 0 };
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const user = JSON.parse(body.messages?.find((message) => message.role === "user")?.content ?? "{}") as Record<string, unknown>;
    const agent = agentOf(user);
    const day = dayOf(user);
    calls.push({ agent, day, user });
    if (agent === "monthly_coach" || agent === "context:monthly") {
      const monthly = deterministicMonthlyPlan(month);
      return chat({ ...monthly, fatigue_tolerance: "moderate", variety_requirement: "moderate" });
    }
    if (agent === "weekly_coach" || agent === "context:weekly") return chat(weeklyJson(plan));
    if (agent === "strength_coach") return chat({ day, strength_note_ko: `모델 ${day} 스트렝스 목적을 유지합니다.` });
    if (agent === "warmup_coach") {
      if (mode === "timeout_once" && day === "wed") {
        transport.warmup += 1;
        if (transport.warmup === 1) {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          throw error;
        }
      }
      return chat({ day, warmup_ko: `모델 ${day} 준비 동작을 먼저 합니다.` });
    }
    if (agent === "conditioning_coach") {
      if ((mode === "http_once" || mode === "http_twice") && day === "mon") {
        transport.conditioning += 1;
        if (mode === "http_twice" || transport.conditioning === 1) return new Response("no", { status: 500 });
      }
      const session = built.draft.sessions.find((row) => row.day === day);
      if (!session) return chat({ day });
      const context = user.context as { revision_number?: number } | undefined;
      const original = user.original_input as { revision_number?: number; day_recovery?: unknown } | undefined;
      const revision = Number(user.revision_number ?? context?.revision_number ?? original?.revision_number ?? 0);
      const recovery = user.day_recovery ?? original?.day_recovery;
      if (mode === "recover" && day === "mon" && !recovery) return chat(repsOnly(session, user));
      if (mode === "always_bad" && day === "mon") return chat(repsOnly(session, user));
      if (mode === "keep_valid" && day === "mon" && revision > 0 && !recovery) return chat(repsOnly(session, user));
      if ((mode === "field_fix" || mode === "field_drift" || mode === "cell_fix") && day === "mon" && !recovery) return chat(illegalAmount(session, user));
      if (mode === "field_drift" && day === "mon" && recovery) return chat(driftedRecovery(session, user));
      if (mode === "cell_fix" && day === "mon" && recovery) {
        const keys = (sessionJson(session, user).conditioning as { movements?: Array<{ key?: string }> } | null)?.movements?.map((row) => row.key ?? "") ?? [];
        const cell = repsCellFromKeys(keys);
        return chat({ cells: [{ catalog_key: cell?.key ?? "wall_ball", field: "amount", value: cell?.value ?? "15" }] });
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
    if (agent === "head_coach" || agent === "context:head") return chat(headBody(mode, plan));
    return chat({ status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [], adjustments: [] });
  };
  const input: CoachWeekInput = {
    month,
    weekIndex: 1,
    weekStart: WEEK,
    key: KEY,
    fetchImpl,
    timeoutMs: 1000,
  };
  return { fetchImpl, calls, plan, input };
}

async function run(mode: Mode) {
  const built = harness(mode);
  const result = await coachWeek(built.input);
  return { ...built, result };
}

describe("day recovery units", () => {
  it("keeps threshold 4 and rejects a coach, a day, and a range", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    expect(HEAD_COACH_PROMPT_VERSION).toBe("head-coach-v8");
    expect(headStanceOf({ status: "BLOCK" })).toBe("ACCEPT_WITH_NOTE");
    expect(parseHeadReview({ status: "BLOCK", note_ko: "채택하지 않습니다.", revisions: [] })?.status).toBe("BLOCK");
    const rejected = rejectedRevisionSpecs(
      {
        revisions: [
          { day: "sun", target_coach: "load_coach", allowed_changes: ["monthly_training_method"] },
          { day: "mon", target_coach: "conditioning_coach", allowed_changes: ["conditioning"] },
        ],
      },
      ["mon"],
    );
    expect(rejected.map((row) => row.index)).toEqual([0, 0, 0]);
    expect(rejected.some((row) => row.reason.includes("load_coach"))).toBe(true);
    expect(rejected.some((row) => row.reason.includes("monthly_training_method"))).toBe(true);
    const payload = dayRecoveryPayload({
      area: "conditioning",
      monthly: null,
      weeklyGoal: null,
      dayIntent: null,
      existing: null,
      errors: ["push_up amount received reps"],
      invalid: { conditioning: { movements: [{ key: "push_up", amount: "reps" }] } },
      priorAttempts: 1,
      neighbors: [],
    });
    expect(JSON.stringify(payload)).toContain("reps");
    expect(payload.preserve).toEqual(expect.arrayContaining(["warmup_ko"]));
    expect(payload.allowed_changes).toEqual(["conditioning"]);
    const named = dayRecoveryPayload({
      area: "conditioning",
      monthly: null,
      weeklyGoal: null,
      dayIntent: null,
      existing: null,
      errors: ["wed field conditioning.movements.amount: prescription: push_up field conditioning.movements.amount received 10회/라운드; expected unit one of: reps. The prescription is not clear enough."],
      invalid: { conditioning: { movements: [{ key: "push_up", amount: "10회/라운드" }] } },
      priorAttempts: 2,
      neighbors: [],
    });
    const namedEdit = (named.field_edits as Array<{ field: string; current_value: string; required_format: string }>)[0];
    expect(namedEdit?.field).toBe("conditioning.movements.push_up.amount");
    expect(namedEdit?.current_value).toBe("10회/라운드");
    expect(namedEdit?.required_format).toContain("reps");
    const clock = dayRecoveryPayload({
      area: "conditioning",
      monthly: null,
      weeklyGoal: null,
      dayIntent: null,
      existing: null,
      errors: ["interval_work_sec: received 180; allowed: integer 10–90 when format is intervals"],
      invalid: { conditioning: { movements: [{ key: "row", amount: "500m" }] } },
      priorAttempts: 1,
      neighbors: [],
    });
    const clockEdit = (clock.field_edits as Array<{ field: string; current_value: string; required_format: string }>)[0];
    expect(clockEdit?.field).toBe("interval_work_sec");
    expect(clockEdit?.current_value).toBe("180");
    expect(clockEdit?.required_format).toContain("10–90");
    const before = {
      day: "wed",
      notes_ko: "이 날의 컨디셔닝 목적을 유지합니다.",
      conditioning: {
        format: "intervals",
        duration_min: 12,
        stimulus: "mixed",
        movements: [{ key: "push_up", amount: "10회/라운드", name_ko: "푸시업" }],
        equipment: ["bodyweight"],
        volume: "moderate",
        intensity: "moderate",
        interval_work_sec: 180,
        interval_rest_sec: 60,
      },
    };
    const fixed = {
      ...before,
      conditioning: {
        ...before.conditioning,
        movements: [{ key: "push_up", amount: "10", name_ko: "푸시업" }],
        interval_work_sec: 30,
      },
    };
    expect(
      recoveryDrift({
        before,
        after: fixed,
        fields: [
          { field: "conditioning.movements.push_up.amount" },
          { field: "interval_work_sec" },
        ],
      }),
    ).toEqual({ ok: true });
    const drifted = {
      ...fixed,
      notes_ko: "형식을 바꿉니다.",
      conditioning: { ...fixed.conditioning, format: "amrap", interval_work_sec: null, interval_rest_sec: null },
    };
    const drift = recoveryDrift({
      before,
      after: drifted,
      fields: [{ field: "conditioning.movements.push_up.amount" }, { field: "interval_work_sec" }],
    });
    expect(drift.ok).toBe(false);
    if (!drift.ok) {
      expect(drift.changed).toEqual(expect.arrayContaining(["notes_ko", "conditioning.format", "conditioning.interval_rest_sec"]));
      expect(drift.changed).not.toContain("conditioning.movements.push_up.amount");
      expect(drift.changed).not.toContain("conditioning.interval_work_sec");
    }
  });
});

describe("day recovery orchestrator", () => {
  it("retries one http failure after a short wait and keeps the other days", async () => {
    setTransientAreaRetryMs(400);
    const started = Date.now();
    try {
      const { result, calls } = await run("http_once");
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      const monday = calls.filter((row) => row.agent === "conditioning_coach" && row.day === "mon");
      const tuesday = calls.filter((row) => row.agent === "conditioning_coach" && row.day === "tue");
      expect(monday).toHaveLength(2);
      expect(monday.every((row) => row.user.day_recovery == null)).toBe(true);
      expect(tuesday).toHaveLength(1);
      expect(result.day_sources.mon).toBe("model");
      expect(result.day_records?.mon?.day_status).toBe("MODEL_REVISED");
      expect(result.day_sources.tue).toBe("model");
      expect(result.generation_source).toBe("model");
    } finally {
      setTransientAreaRetryMs(0);
    }
  });

  it("leaves only that day unresolved when the transport retry fails", async () => {
    const { result, calls } = await run("http_twice");
    const monday = calls.filter((row) => row.agent === "conditioning_coach" && row.day === "mon");
    const tuesday = calls.filter((row) => row.agent === "conditioning_coach" && row.day === "tue");
    expect(monday).toHaveLength(2);
    expect(tuesday).toHaveLength(1);
    expect(result.day_sources.mon).toBe("fallback");
    expect(result.day_records?.mon?.day_status).toBe("FALLBACK");
    expect(result.day_sources.tue).toBe("model");
    expect(result.day_records?.tue?.day_status).toBe("MODEL");
    expect(result.generation_source).not.toBe("model");
    expect(result.fallback_reason).toContain("fallback_after_model_failure");
    expect(result.fallback_reason).not.toContain("unresolved_day");
  });

  it("retries one timeout for that area only", async () => {
    const { result, calls } = await run("timeout_once");
    const wednesday = calls.filter((row) => row.agent === "warmup_coach" && row.day === "wed");
    const monday = calls.filter((row) => row.agent === "warmup_coach" && row.day === "mon");
    expect(wednesday).toHaveLength(2);
    expect(monday).toHaveLength(1);
    expect(result.day_sources.wed).toBe("model");
    expect(result.generation_source).toBe("model");
  });

  it("keeps the other days when monday stays unresolved", async () => {
    const { result, calls } = await run("always_bad");
    const training = result.plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
    expect(result.day_sources.mon).toBe("fallback");
    expect(result.day_records?.mon?.day_status).toBe("FAILED");
    expect(result.day_records?.mon?.final_prescription).toBeNull();
    expect(result.day_records?.tue?.day_status).toBe("MODEL");
    expect(result.draft.sessions.find((session) => session.day === "tue")?.warmup_ko).toContain("모델");
    expect(result.generation_source).not.toBe("model");
    expect(result.final_validation?.ok).toBe(false);
    expect(result.final_status).not.toBe("APPROVE");
    expect(result.traces.some((trace) => trace.agent_name === "approval_refused")).toBe(true);
    const monday = calls.filter((call) => call.agent === "conditioning_coach" && call.day === "mon");
    expect(monday.length).toBe(4);
    expect(monday.filter((call) => call.user.day_recovery).length).toBe(1);
    expect(calls.filter((call) => call.agent === "conditioning_coach" && call.day === "tue")).toHaveLength(1);
    expect(calls.filter((call) => call.agent === "strength_coach")).toHaveLength(training.length);
    expect(calls.filter((call) => call.agent === "warmup_coach")).toHaveLength(training.length);
    const recovery = monday.find((call) => call.user.day_recovery);
    const fieldEdits = (recovery?.user.day_recovery as { field_edits?: Array<{ field?: string; current_value?: string; required_format?: string }> } | undefined)?.field_edits ?? [];
    expect(fieldEdits.some((row) => row.field?.includes("amount") && row.current_value === "reps" && row.required_format?.includes("10"))).toBe(true);
    expect(JSON.stringify(recovery?.user.day_recovery)).toContain("validation_errors");
  });

  it("replaces only monday after the conditioning coach fixes the missing count", async () => {
    const { result, calls } = await run("recover");
    const recovery = calls.find((call) => call.agent === "conditioning_coach" && call.day === "mon" && call.user.day_recovery);
    expect(JSON.stringify(recovery?.user.day_recovery)).toContain("reps");
    expect(result.day_sources.mon).toBe("model");
    expect(result.day_records?.mon?.final_source).toBe("MODEL_REVISED");
    expect(result.day_records?.mon?.revision_reason).toBe("schema recovery");
    expect(JSON.stringify(result.draft.sessions.find((session) => session.day === "mon")?.conditioning?.movements)).not.toContain('"amount":"reps"');
    expect(result.draft.sessions.find((session) => session.day === "tue")?.warmup_ko).toContain("모델");
    expect(calls.filter((call) => call.agent === "conditioning_coach" && call.day !== "mon" && Number(call.user.revision_number ?? 0) > 0)).toHaveLength(0);
    expect(result.traces.filter((trace) => trace.agent_name === "conditioning_coach" && trace.day === "mon" && trace.revision_number === 1 && trace.validation_result === "pass")).toHaveLength(1);
    expect(result.generation_source).toBe("model");
    expect(result.final_validation?.ok).toBe(true);
    expect(result.final_status).toBe("APPROVE");
    expect(result.traces.filter((trace) => trace.agent_name === "session_coach").every((trace) => trace.token_usage == null)).toBe(true);
    expect(result.token_usage?.total_tokens).toBeGreaterThan(0);
  });

  it("adopts monday when recovery fixes only the named amount", async () => {
    const { result, calls } = await run("field_fix");
    const monday = result.draft.sessions.find((session) => session.day === "mon");
    const slot = result.plan.conditioning_slots?.mon;
    const recovery = calls.find((call) => call.agent === "conditioning_coach" && call.day === "mon" && call.user.day_recovery);
    const fieldEdits = (recovery?.user.day_recovery as { field_edits?: Array<{ field?: string; current_value?: string }> } | undefined)?.field_edits ?? [];
    const amountEdit = fieldEdits.find((row) => row.current_value === "10회/라운드");
    expect(amountEdit?.field).toMatch(/conditioning\.movements\.[A-Za-z0-9_]+\.amount/);
    expect(monday?.conditioning?.movements?.length).toBeGreaterThan(0);
    expect(monday?.conditioning?.movements?.map((row) => row.amount)).toEqual(monday?.conditioning?.movements?.map((row) => sampleAmount(row.key)));
    expect(JSON.stringify(monday?.conditioning)).not.toContain("10회/라운드");
    expect(monday?.conditioning?.stimulus).toBe(slot?.stimulus);
    expect(result.day_sources.mon).toBe("model");
    expect(result.day_records?.mon?.revision_reason).toBe("schema recovery");
    expect(result.generation_source).toBe("model");
    expect(result.draft.sessions.find((session) => session.day === "tue")?.warmup_ko).toContain("모델");
    const mondayCalls = calls.filter((call) => call.agent === "conditioning_coach" && call.day === "mon");
    expect(mondayCalls).toHaveLength(3);
    expect(mondayCalls.filter((call) => call.user.day_recovery)).toHaveLength(1);
  });

  it("writes only the named amount and does not call the conditioning coach again", async () => {
    const { result, calls } = await run("cell_head");
    const monday = result.draft.sessions.find((session) => session.day === "mon");
    const slot = result.plan.conditioning_slots?.mon;
    const cell = repsCellFromKeys(goalMondayKeys());
    const diffs = (monday?.conditioning?.movements ?? []).filter((row) => row.amount !== sampleAmount(row.key));
    expect(cell?.value).toBeTruthy();
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.key).toBe(cell?.key);
    expect(diffs[0]?.amount).toBe(cell?.value);
    expect(diffs[0]?.amount_value).toBe(Number(cell?.value));
    expect(monday?.conditioning?.stimulus).toBe(slot?.stimulus);
    expect(calls.filter((call) => call.agent === "conditioning_coach" && call.day === "mon")).toHaveLength(1);
    expect(result.traces.some((trace) => trace.agent_name === "revision_compliance" && trace.day === "mon" && trace.token_usage == null)).toBe(true);
    expect(result.day_sources.mon).toBe("model");
  });

  it("rejects a double-under calorie edit before another conditioning call", async () => {
    const { result, calls, plan } = await run("bad_cal");
    const training = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
    expect(calls.filter((call) => call.agent === "conditioning_coach")).toHaveLength(training.length);
    expect(calls.filter((call) => call.agent === "head_coach")).toHaveLength(1);
    expect(calls.filter((call) => call.agent === "context:head")).toHaveLength(0);
    expect(JSON.stringify(result.draft)).not.toContain("60cal");
    expect(result.traces.some((trace) => trace.agent_name === "revision_rejected")).toBe(true);
    expect((result.traces.find((trace) => trace.agent_name === "head_cell_apply")?.output as { reverted?: number }).reverted).toBe(1);
  });

  it("patches one recovery cell and leaves the format", async () => {
    const { result, calls } = await run("cell_fix");
    const monday = result.draft.sessions.find((session) => session.day === "mon");
    const slot = result.plan.conditioning_slots?.mon;
    const cell = repsCellFromKeys((monday?.conditioning?.movements ?? []).map((row) => row.key));
    const diffs = (monday?.conditioning?.movements ?? []).filter((row) => row.amount !== sampleAmount(row.key));
    expect(diffs).toHaveLength(1);
    expect(diffs[0]?.key).toBe(cell?.key);
    expect(diffs[0]?.amount).toBe(cell?.value);
    expect(monday?.conditioning?.stimulus).toBe(slot?.stimulus);
    expect(monday?.notes_ko ?? monday?.metcon_purpose).toBeTruthy();
    expect(JSON.stringify(monday?.conditioning)).not.toContain("10회/라운드");
    expect(result.day_sources.mon).toBe("model");
    expect(result.day_records?.mon?.revision_reason).toBe("schema recovery");
    const mondayCalls = calls.filter((call) => call.agent === "conditioning_coach" && call.day === "mon");
    expect(mondayCalls).toHaveLength(3);
    expect(mondayCalls.filter((call) => call.user.day_recovery)).toHaveLength(1);
  });

  it("rejects a recovery that changes the format and the note", async () => {
    const { result, calls } = await run("field_drift");
    const mondayCalls = calls.filter((call) => call.agent === "conditioning_coach" && call.day === "mon");
    expect(mondayCalls).toHaveLength(3);
    expect(mondayCalls.filter((call) => call.user.day_recovery)).toHaveLength(1);
    const sessionTrace = result.traces.find((trace) => trace.agent_name === "session_coach" && trace.day === "mon" && trace.validation_result === "fail");
    const errors = sessionTrace?.validation_errors ?? [];
    expect(errors).toEqual(expect.arrayContaining(["recovery changed conditioning.format", "recovery changed notes_ko"]));
    expect(result.day_sources.mon).toBe("fallback");
    expect(result.day_records?.mon?.day_status).toBe("FAILED");
    expect(result.day_records?.mon?.final_prescription).toBeNull();
    expect(JSON.stringify(result.draft.sessions.find((session) => session.day === "mon"))).not.toContain("형식을 바꿉니다.");
    expect(result.draft.sessions.find((session) => session.day === "tue")?.warmup_ko).toContain("모델");
    expect(result.generation_source).not.toBe("model");
    expect(result.final_validation?.ok).toBe(false);
  });

  it("does not overwrite a valid monday when the later revision is invalid", async () => {
    const { result } = await run("keep_valid");
    const monday = result.draft.sessions.find((session) => session.day === "mon");
    const original = result.day_records?.mon?.original_model_output;
    expect(monday?.warmup_ko).toContain("모델");
    expect(JSON.stringify(monday?.conditioning?.movements)).toBe(JSON.stringify(original?.conditioning?.movements));
    expect(JSON.stringify(monday?.conditioning?.movements)).not.toContain('"amount":"reps"');
    expect(result.day_records?.mon?.day_status).not.toBe("FAILED");
    expect(result.draft.sessions.find((session) => session.day === "tue")?.warmup_ko).toContain("모델 tue");
    expect(result.traces.some((trace) => trace.agent_name === "conditioning_coach" && trace.day === "mon" && (trace.revision_number ?? 0) > 0)).toBe(false);
    expect(result.traces.some((trace) => trace.agent_name === "revision_rejected" && trace.day === "mon")).toBe(true);
  });

  it("rejects a bad coach and a bad range without another specialist call", async () => {
    const coach = await run("bad_coach");
    const training = coach.result.plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
    expect(coach.result.traces.some((trace) => trace.agent_name === "revision_rejected" && JSON.stringify(trace.output).includes("load_coach"))).toBe(true);
    expect(coach.calls.filter((call) => call.agent === "conditioning_coach")).toHaveLength(training.length);
    expect(coach.result.revision_count).toBe(0);
    const range = await run("bad_range");
    expect(range.result.traces.some((trace) => trace.agent_name === "revision_rejected")).toBe(true);
    expect(range.calls.filter((call) => call.agent === "conditioning_coach")).toHaveLength(training.length);
    expect(range.result.revision_count).toBe(0);
  });

  it("refuses BLOCK even when every day is a valid model session", async () => {
    const { result } = await run("block");
    expect(result.day_sources.mon).toBe("model");
    expect(result.generation_source).not.toBe("model");
    expect(result.final_validation?.ok).toBe(false);
    expect(result.final_status).toBe("FINALIZE_WITH_WARNING");
    expect(result.fallback_reason).toContain("head_block");
    expect(result.traces.some((trace) => trace.agent_name === "approval_refused")).toBe(true);
    expect(result.draft.sessions.filter((session) => !session.rest).every((session) => session.warmup_ko.includes("모델"))).toBe(true);
  });
});

describe("day recovery storage", () => {
  beforeEach(() => freshDb());

  it("writes nothing on preview and stores only a validated week", async () => {
    const preview = await dryRunWeek({ nowMs: NOW, weekStart: WEEK, key: null });
    expect(preview.wrote).toBe(false);
    expect(preview.prompt_version).toBe(WEEKLY_PROMPT_VERSION);
    expect(getProgrammingWeek(WEEK)).toBeNull();

    const adopted = harness("recover");
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: KEY, fetchImpl: adopted.fetchImpl });
    expect(saved.promptVersion).toBe(STAGE16_PIPELINE_VERSION);
    expect(saved.generationSource).toBe("fallback");
    expect(saved.status).toBe("failed");
    expect(getProgrammingWeek(WEEK)).toBeNull();
  });

  it("does not store an unresolved week as the active program", async () => {
    const unresolved = harness("always_bad");
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: KEY, fetchImpl: unresolved.fetchImpl });
    expect(saved.status).toBe("failed");
    expect(saved.generationSource).not.toBe("model");
    expect(getProgrammingWeek(WEEK)).toBeNull();
    expect(DAY_ORDER).toHaveLength(7);
  });
});
