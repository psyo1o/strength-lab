import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import { DAY_ORDER, type DayKey } from "../src/lib/month-plan/types";
import { movementCatalog } from "../src/lib/programming/coaching/pieces";
import { assertProbeWeek, coachWeek, type CoachWeekInput } from "../src/lib/programming/coaching/pipeline";
import { schemaBrief, sessionCoachErrors, weeklyIntentErrors } from "../src/lib/programming/coaching/contract";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { coachSystemPrompt } from "../src/lib/programming/coaching/prompts";
import { qualityOf } from "../src/lib/programming/coaching/score";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { variationReport } from "../src/lib/programming/coaching/variation";
import { planCoachedWeek, weeklyCoachPayload } from "../src/lib/programming/coaching/weekly";
import { coachingPipelineEnabled } from "../src/lib/programming/coaching/models";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { WeekActual } from "../src/lib/programming/summary";
import type { MonthDirection, SessionDraft, WeekIndex, WeeklyIntentPlan } from "../src/lib/programming/types";
import { WEEKLY_PROMPT_VERSION } from "../src/lib/programming/types";
import { COACHING_PIPELINE_VERSION } from "../src/lib/programming/coaching/prompts";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-active-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  resetDbConnection();
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function reported(input: { fatigue: "low" | "moderate" | "high"; volume: "low" | "moderate" | "high"; completed: number; missed: number }): WeekActual {
  return {
    note_ko: "수행",
    days: DAY_ORDER.map((day, index) => ({
      day,
      rest: day === "sun",
      completed: day !== "sun" && index < input.completed,
      result_ko: day === "sun" ? "휴식" : index < input.completed ? "완료" : "결석",
      fatigue: input.fatigue,
      actual_volume: input.volume,
    })),
    class_summary: {
      completed_days: input.completed,
      missed_days: input.missed,
      scaling_mix: { rx: input.completed, scaled: 0, beginner: 0 },
      actual_volume: input.volume,
      actual_intensity: input.fatigue === "high" ? "heavy" : "moderate",
      fatigue_signal: input.fatigue,
      plan_vs_actual: input.missed >= 3 ? "미완료가 많습니다." : "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

type Script = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  actual?: WeekActual | null;
  weekly?: "valid" | "bad_json" | "seven_days";
  session?: "valid" | "bad_json";
  badDay?: DayKey | null;
  httpDay?: DayKey | null;
  head?: "approve" | "revise" | "always_revise";
  load?: "valid" | "bad_json";
  monthly?: "valid" | "bad_json";
};

function chat(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function monthlyJson(month: MonthDirection) {
  const plan = deterministicMonthlyPlan(month);
  return {
    ...plan,
    fatigue_tolerance: "moderate",
    variety_requirement: "moderate",
    source: undefined,
    version: undefined,
  };
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

function sessionJson(session: SessionDraft, mark: string) {
  const piece = session.conditioning;
  if (!piece) return { day: session.day };
  return {
    day: session.day,
    warmup_ko: `${mark} 준비 동작을 먼저 합니다.`,
    notes_ko: `${mark} 조합을 이 날의 목적으로 유지합니다.`,
    conditioning: {
      format: piece.format,
      duration_min: piece.duration_min,
      stimulus: piece.stimulus,
      movements: piece.movements,
      equipment: piece.equipment,
      volume: piece.volume,
      intensity: piece.intensity,
    },
  };
}

function basePlan(script: Script) {
  return planCoachedWeek({ month: script.month, weekIndex: script.weekIndex, previousActual: script.actual });
}

function baseSession(script: Script, day: DayKey): SessionDraft | undefined {
  const plan = basePlan(script);
  const built = assembleLegalWeek({ month: script.month, weekIndex: script.weekIndex, plan, actual: script.actual });
  return built.draft.sessions.find((session) => session.day === day);
}

function loadJson(plan: WeeklyIntentPlan) {
  return {
    decisions: plan.days
      .filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest")
      .map((day) => ({
        day: day.day,
        action: "hold",
        reason_ko: "방법 표를 유지합니다.",
        target_effort: "moderate",
        relative_intensity: "same",
      })),
  };
}

function headJson(script: Script, revision: number, day: DayKey) {
  if (script.head === "always_revise" || (script.head === "revise" && revision === 0)) {
    return {
      status: "REVISE",
      note_ko: "문제 있는 날의 컨디셔닝 강도만 낮춥니다.",
      revisions: [
        {
          day,
          reason: "이 날의 자극이 다음 날 회복과 겹칩니다.",
          correction_instruction: "같은 목적을 유지하고 자극을 한 단계 낮추세요.",
          priority: "high",
          constraints: "동작은 카탈로그 안에서만 고르고 하체 리프트는 유지합니다.",
        },
      ],
      adjustments:
        script.head === "revise"
          ? [
              {
                target: `${day}.conditioning.duration_min`,
                reason: "회복과 겹칩니다.",
                priority: "P1",
                current_value: "15",
                proposed_value: "9",
                preserve: ["weekly_strength_progression"],
                rationale: "컨디셔닝 시간만 줄이고 스트렝스 진행은 유지합니다.",
                confidence: 0.9,
              },
            ]
          : [],
    };
  }
  return { status: "APPROVE", note_ko: "이번 주는 회원에게 내도 됩니다.", revisions: [], adjustments: [] };
}

function agentOf(user: Record<string, unknown>): string {
  if (typeof user.agent_name === "string") return user.agent_name;
  const context = user.context;
  if (context && typeof context === "object" && "agent" in context) return `context:${String((context as { agent?: unknown }).agent)}`;
  return "unknown";
}

function fetchFor(script: Script) {
  const plan = basePlan(script);
  const calls: string[] = [];
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const user = JSON.parse(body.messages?.find((message) => message.role === "user")?.content ?? "{}") as Record<string, unknown>;
    const agent = agentOf(user);
    calls.push(agent);
    const revision = Number(user.revision_number ?? (user.context as { revision_number?: number } | undefined)?.revision_number ?? 0);
    if (agent === "monthly_coach" || agent === "context:monthly") {
      if (script.monthly === "bad_json") return chat("not-json");
      return chat(monthlyJson(script.month));
    }
    if (agent === "weekly_coach" || agent === "context:weekly") {
      if (script.weekly === "bad_json") return chat("not-json");
      if (script.weekly === "seven_days") return chat({ seven_days: plan.days, block_phase: "이번 주는 가볍게" });
      return chat(weeklyJson(plan));
    }
    if (agent === "session_coach" || agent === "context:session") {
      const day = String((user.day_intent as { day?: string } | undefined)?.day ?? (user.context as { day?: string } | undefined)?.day ?? "");
      if (script.session === "bad_json") return chat("not-json");
      if (script.httpDay && day === script.httpDay) return new Response("down", { status: 503 });
      if (script.badDay && day === script.badDay) {
        return chat({
          day,
          warmup_ko: "준비합니다.",
          notes_ko: "잘못된 형식입니다.",
          conditioning: { format: "고강도 인터벌", duration_min: 14, stimulus: "고강도 전신", movements: ["버피"], equipment: ["맨몸"], volume: "많음", intensity: "세게" },
        });
      }
      const session = baseSession(script, day as DayKey);
      if (!session) return chat({ day });
      const mark = revision > 0 ? `수정${revision} ${day}` : `모델 ${day}`;
      return chat(sessionJson(session, mark));
    }
    if (agent === "load_coach" || agent === "context:load") {
      if (script.load === "bad_json") return chat("not-json");
      return chat(loadJson(plan));
    }
    if (agent === "head_coach" || agent === "context:head") {
      const target = plan.days.find((day) => day.primary_training !== "rest")?.day ?? "mon";
      return chat(headJson(script, revision, target));
    }
    return chat("not-json");
  };
  return { fetchImpl, calls };
}

function inputFor(script: Script, fetchImpl: Script extends never ? never : Awaited<ReturnType<typeof fetchFor>>["fetchImpl"]): CoachWeekInput {
  return {
    month: script.month,
    weekIndex: script.weekIndex,
    weekStart: "2099-07-06",
    previousActual: script.actual,
    key: "sk-test",
    fetchImpl,
    timeoutMs: 1000,
  };
}

async function run(script: Partial<Script> & { weekIndex?: WeekIndex } = {}) {
  const full: Script = {
    month: month531(),
    weekIndex: script.weekIndex ?? 1,
    actual: script.actual,
    weekly: script.weekly ?? "valid",
    session: script.session ?? "valid",
    badDay: script.badDay,
    httpDay: script.httpDay,
    head: script.head ?? "approve",
    load: script.load ?? "valid",
    monthly: script.monthly ?? "valid",
  };
  const { fetchImpl, calls } = fetchFor(full);
  const result = await coachWeek({ ...inputFor(full, fetchImpl), weekIndex: full.weekIndex, weekStart: weekStart(full.weekIndex) });
  return { result, calls };
}

function weekStart(weekIndex: WeekIndex): string {
  return (["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"] as const)[weekIndex - 1]!;
}

describe("active coaching contracts", () => {
  beforeEach(() => {
    delete process.env.COACHING_PIPELINE;
  });

  it("puts the same enums in the prompt, the schema, and the parser", () => {
    const weekly = schemaBrief("weekly");
    const session = schemaBrief("session");
    expect(weekly).toContain('"days"');
    expect(weekly).toContain("Do not use \"seven_days\"");
    expect(weekly).toContain("lower_strength | upper_strength");
    expect(session).toContain("amrap | for_time | emom | intervals");
    expect(session).toContain("heavy | high_rep | technical");
    expect(session).toContain("8 to 20");
    expect(session).toContain("30 to 40");
    for (const movement of movementCatalog()) expect(session).toContain(movement.key);
    const prompt = coachSystemPrompt("weekly");
    expect(prompt).toContain("OUTPUT SCHEMA");
    expect(prompt).toContain('"days"');
    expect(prompt).not.toContain("and seven days");
    const plan = planCoachedWeek({ month: month531(), weekIndex: 1 });
    expect(weeklyIntentErrors(weeklyJson(plan))).toEqual([]);
    expect(weeklyIntentErrors({ seven_days: plan.days })[0]).toContain('"days"');
    const day = plan.days.find((row) => row.primary_training !== "rest")!;
    const formatError = sessionCoachErrors(
      {
        day: day.day,
        warmup_ko: "준비합니다.",
        notes_ko: "형식만 고칩니다.",
        conditioning: {
          format: "고강도 인터벌",
          duration_min: 21,
          stimulus: "고강도 전신",
          movements: [{ key: "not_a_move", amount: "8", name_ko: "없는동작" }],
          equipment: ["맨몸"],
          volume: "많음",
          intensity: "세게",
        },
      },
      day,
    ).join("\n");
    expect(formatError).toContain("amrap, for_time, emom, intervals");
    expect(formatError).toContain("8–20");
    expect(formatError).toContain("heavy, high_rep, technical");
  });

  it("case 1 keeps a valid model week instead of covering it with fallback", async () => {
    const { result } = await run();
    const training = result.plan.days.filter((day) => day.primary_training !== "rest");
    expect(result.plan.intent_source).toBe("model");
    expect(result.plan.original_intent_source).toBe("model");
    expect(result.plan.fallback_used).toBe(false);
    expect(result.monthly_plan.source).toBe("model");
    expect(result.generation_source).toBe("model");
    expect(result.fallback_reason).toBeNull();
    expect(result.final_status).toBe("APPROVE");
    expect(result.review.status).toBe("APPROVE");
    for (const day of training) {
      expect(result.day_sources[day.day]).toBe("model");
      expect(result.draft.sessions.find((session) => session.day === day.day)?.warmup_ko).toContain("모델");
    }
    expect(result.traces.some((trace) => trace.agent_name === "weekly_coach" && trace.raw_output)).toBe(true);
    expect(result.traces.some((trace) => trace.agent_name === "session_coach" && trace.day && trace.source === "model")).toBe(true);
    expect(result.token_usage.total_tokens).toBeGreaterThan(0);
  });

  it("case 2 and 3 keep reported fatigue apart from planned volume", async () => {
    const tired = reported({ fatigue: "high", volume: "moderate", completed: 6, missed: 0 });
    const payload = weeklyCoachPayload({ month: month531(), weekIndex: 3, previousActual: tired });
    expect(payload).toMatchObject({ reported_fatigue: "high", planned_volume: "moderate" });
    const quiet = reported({ fatigue: "low", volume: "high", completed: 6, missed: 0 });
    const separated = weeklyCoachPayload({ month: month531(), weekIndex: 2, previousActual: quiet });
    expect(separated).toMatchObject({ reported_fatigue: "low", planned_volume: "high" });
    const deterministic = planCoachedWeek({ month: month531(), weekIndex: 3, previousActual: tired });
    expect(deterministic.adjustment_ko).toContain("피로");
    expect(deterministic.days.filter((day) => day.strength_lift === "squat" || day.strength_lift === "deadlift")).toHaveLength(1);
  });

  it("case 4 and 13 show absence and a half-complete week in the weekly input", () => {
    const absent = reported({ fatigue: "moderate", volume: "moderate", completed: 3, missed: 3 });
    const payload = weeklyCoachPayload({ month: month531(), weekIndex: 2, previousActual: absent });
    expect(payload).toMatchObject({ completion: { completed_days: 3, missed_days: 3 } });
    const plan = planCoachedWeek({ month: month531(), weekIndex: 2, previousActual: absent });
    expect(plan.adjustment_ko).toContain("미완료");
    expect(plan.days.some((day) => day.progression_required)).toBe(false);
  });

  it("case 5 and 6 mark benchmark and deload weeks", () => {
    const month = month531();
    const benchmark = weeklyCoachPayload({ month, weekIndex: month.benchmark_week });
    expect(benchmark).toMatchObject({ benchmark_week: true, week_index: month.benchmark_week });
    const deload = planCoachedWeek({ month, weekIndex: 4 });
    expect(deload.block_phase).toBe("deload");
    expect(weeklyCoachPayload({ month, weekIndex: 4 })).toMatchObject({ week_index: 4, long_required_this_week: month.long_conditioning_weeks.includes(4) });
  });

  it("case 7 keeps the raw invalid JSON and does not call the week a model success", async () => {
    const { result } = await run({ weekly: "bad_json", session: "bad_json", load: "bad_json", monthly: "bad_json" });
    expect(result.generation_source).toBe("fallback");
    expect(result.plan.intent_source).toBe("fallback");
    const weekly = result.traces.find((trace) => trace.agent_name === "weekly_coach");
    expect(weekly?.validation_result).toBe("fail");
    expect(weekly?.retry_count).toBe(1);
    expect(weekly?.raw_output).toBeTruthy();
    expect(result.day_sources.mon).toBe("fallback");
    expect(result.draft.sessions).toHaveLength(7);
  });

  it("case 8 rejects seven_days and still saves the other stages", async () => {
    const { result } = await run({ weekly: "seven_days" });
    const weekly = result.traces.find((trace) => trace.agent_name === "weekly_coach");
    expect(weekly?.validation_errors?.join(" ")).toContain('"days"');
    expect(weekly?.retry_count).toBe(1);
    expect(result.plan.intent_source).toBe("fallback");
    expect(result.plan.fallback_used).toBe(true);
    const training = result.plan.days.filter((day) => day.primary_training !== "rest");
    expect(training.every((day) => result.day_sources[day.day] === "model")).toBe(true);
    expect(result.generation_source).toBe("model");
    expect(result.fallback_reason).toBe("schema");
  });

  it("case 9 and 10 fall back only the broken day", async () => {
    const enumFail = await run({ badDay: "wed" });
    expect(enumFail.result.day_sources.wed).toBe("fallback");
    expect(enumFail.result.day_sources.mon).toBe("model");
    expect(enumFail.result.prescription_source).toBe("fallback_after_model_failure");
    expect(enumFail.result.generation_source).toBe("fallback");
    expect(enumFail.result.fallback_reason).toContain("fallback_after_model_failure");
    expect(enumFail.result.plan.intent_source).toBe("model");
    expect(enumFail.result.plan.fallback_used).toBe(false);
    const wed = enumFail.result.traces.find((trace) => trace.agent_name === "session_coach" && trace.day === "wed" && trace.revision_number === 0);
    expect(wed?.retry_count).toBe(1);
    expect(wed?.validation_errors?.join(" ")).toContain("amrap, for_time, emom, intervals");
    expect(enumFail.result.draft.sessions.find((session) => session.day === "mon")?.warmup_ko).toContain("모델");
    const httpFail = await run({ httpDay: "thu" });
    expect(httpFail.result.day_sources.thu).toBe("fallback");
    expect(httpFail.result.day_sources.mon).toBe("model");
    expect(httpFail.result.draft.sessions.find((session) => session.day === "fri")?.warmup_ko).toContain("모델");
  });

  it("case 11 adjusts only the field the head coach names", async () => {
    const { result, calls } = await run({ head: "revise" });
    expect(result.revision_count).toBe(0);
    expect(result.final_status).toBe("ADJUST");
    expect(result.pipeline).toBe("stage16");
    const sessionCalls = calls.filter((call) => call === "session_coach");
    const training = result.plan.days.filter((day) => day.primary_training !== "rest");
    expect(sessionCalls).toHaveLength(training.length);
    const adjusted = result.draft.sessions.find((session) => session.conditioning?.duration_min === 9 && !session.rest);
    expect(adjusted).toBeTruthy();
    const day = adjusted!.day;
    expect(result.day_records?.[day]?.final_source).toBe("HEAD_ADJUSTED");
    expect(result.day_records?.[day]?.original_model_output?.conditioning?.duration_min).not.toBe(9);
    expect(JSON.stringify(adjusted?.strength)).toBe(JSON.stringify(result.day_records?.[day]?.original_model_output?.strength));
    expect(result.draft.sessions.find((session) => session.day === day)?.warmup_ko).toContain("모델");
    const held = result.draft.sessions.filter((session) => session.day !== day && !session.rest);
    expect(held.every((session) => session.warmup_ko.includes("모델"))).toBe(true);
    expect(
      held.every(
        (session) =>
          session.conditioning?.duration_min === result.day_records?.[session.day]?.original_model_output?.conditioning?.duration_min &&
          JSON.stringify(session.strength) === JSON.stringify(result.day_records?.[session.day]?.original_model_output?.strength),
      ),
    ).toBe(true);
    expect(calls.filter((call) => call === "weekly_coach")).toHaveLength(1);
    expect(calls.filter((call) => call === "head_coach")).toHaveLength(1);
    expect(result.traces.filter((trace) => trace.agent_name === "session_coach" && trace.revision_number === 1)).toHaveLength(0);
  });

  it("case 12 does not call the head again when the revise has no field patch", async () => {
    const { result, calls } = await run({ head: "always_revise" });
    expect(result.revision_count).toBe(0);
    expect(result.final_status).toBe("APPROVE_WITH_NOTE");
    expect(result.generation_source).toBe("model");
    expect(result.draft.sessions).toHaveLength(7);
    expect(result.judge_ok).toBe(true);
    expect(result.traces.filter((trace) => trace.agent_name === "head_coach")).toHaveLength(1);
    expect(calls.filter((call) => call === "head_coach")).toHaveLength(1);
    expect(result.draft.sessions.filter((session) => !session.rest).every((session) => session.warmup_ko.includes("모델"))).toBe(true);
  });

  it("case 14 treats a repeated lift with a different structure as progression", () => {
    const shared = {
      rest: false,
      optional: false,
      warmup_min: 10,
      warmup_ko: "준비합니다.",
      strength_purpose: "데드리프트를 이어 갑니다.",
      strength_volume: "moderate" as const,
      strength_intensity: "moderate" as const,
      metcon_purpose: "목적",
      time_domain: "medium" as const,
      stimulus: "high_rep" as const,
      movement_combination: "row",
      equipment: ["bodyweight" as const],
      volume: "moderate" as const,
      intensity: "moderate" as const,
      expected_duration: 14,
    };
    const report = variationReport({
      sessions: [
        {
          ...shared,
          day: "mon",
          strength: { lift: "deadlift", sets: [{ percent_of_tm: 75, reps: 5, amrap: false }] },
          conditioning: conditioning("amrap", [{ key: "kb_swing", amount: "10", name_ko: "케틀벨 스윙" }], ["kettlebell"], "hinge"),
          metcon_format: "amrap",
        },
        {
          ...shared,
          day: "fri",
          strength: { lift: "deadlift", sets: [{ percent_of_tm: 80, reps: 3, amrap: false }] },
          conditioning: conditioning("emom", [{ key: "row", amount: "12/10cal", name_ko: "로잉" }], ["rower"], "engine"),
          metcon_format: "emom",
          equipment: ["rower"],
        },
      ],
      progressingLifts: ["deadlift"],
    });
    expect(report.intentional_progression).toEqual(expect.arrayContaining(["mon", "fri"]));
    expect(report.accidental_repetition).not.toEqual(expect.arrayContaining(["mon", "fri"]));
    expect(report.progression_justified).toBe(true);
  });

  it("case 15 flags the same structure when only the movement names differ", () => {
    const report = variationReport({
      sessions: [
        {
          day: "mon",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "준비",
          strength: null,
          conditioning: conditioning("amrap", [{ key: "burpee", amount: "8", name_ko: "버피" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], ["bodyweight"], "engine"),
          strength_purpose: null,
          strength_volume: null,
          strength_intensity: null,
          metcon_purpose: "목적",
          metcon_format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_combination: "a",
          equipment: ["bodyweight"],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 14,
        },
        {
          day: "wed",
          rest: false,
          optional: false,
          warmup_min: 10,
          warmup_ko: "준비",
          strength: null,
          conditioning: conditioning("amrap", [{ key: "push_up", amount: "8", name_ko: "푸시업" }, { key: "pull_up", amount: "6", name_ko: "풀업" }], ["bodyweight"], "engine"),
          strength_purpose: null,
          strength_volume: null,
          strength_intensity: null,
          metcon_purpose: "목적",
          metcon_format: "amrap",
          time_domain: "medium",
          stimulus: "high_rep",
          movement_combination: "b",
          equipment: ["bodyweight"],
          volume: "moderate",
          intensity: "moderate",
          expected_duration: 14,
        },
      ],
    });
    expect(report.same_week_similarity).toBeGreaterThanOrEqual(4);
    expect(report.accidental_repetition).toEqual(expect.arrayContaining(["mon", "wed"]));
    expect(report.intentional_progression).toEqual([]);
    expect(report.movement_similarity).toBeLessThan(0.5);
  });

  it("runs a mocked 2099 four-week loop and counts adopted model days", async () => {
    const actuals = [
      null,
      reported({ fatigue: "low", volume: "high", completed: 6, missed: 0 }),
      reported({ fatigue: "high", volume: "moderate", completed: 3, missed: 3 }),
      reported({ fatigue: "moderate", volume: "moderate", completed: 6, missed: 0 }),
    ];
    let modelDays = 0;
    let fallbackDays = 0;
    const weeks = [];
    for (let index = 0; index < 4; index += 1) {
      const weekIndex = (index + 1) as WeekIndex;
      const { result } = await run({ weekIndex, actual: actuals[index], head: weekIndex === 3 ? "revise" : "approve" });
      assertProbeWeek(result.draft.sessions.length === 7 ? weekStart(weekIndex) : weekStart(weekIndex));
      for (const day of DAY_ORDER) {
        if (result.day_sources[day] === "model") modelDays += 1;
        else fallbackDays += 1;
      }
      const quality = qualityOf({ result, month: month531(), weekIndex });
      weeks.push({
        week: weekIndex,
        phase: result.plan.block_phase,
        source: result.generation_source,
        head: result.final_status,
        revisions: result.revision_count,
        model_days: DAY_ORDER.filter((day) => result.day_sources[day] === "model").length,
        quality: quality.average,
        critical: quality.critical,
        tokens: result.token_usage.total_tokens,
      });
      expect(result.monthly_plan.source).toBe("model");
      expect(result.plan.intent_source).toBe("model");
      expect(quality.critical).not.toContain("unsafe");
      expect(result.traces.map((trace) => trace.agent_name)).toEqual(
        expect.arrayContaining(["monthly_coach", "weekly_coach", "session_coach", "load_coach", "fatigue_engine", "variation_engine", "head_coach"]),
      );
    }
    expect(modelDays).toBeGreaterThanOrEqual(20);
    expect(modelDays + fallbackDays).toBe(28);
    expect(weeks[3]?.phase).toBe("deload");
    expect(weeks[2]?.revisions).toBe(0);
    expect(weeks[2]?.head).toBe("ADJUST");
    expect(weeks.map((week) => week.model_days).reduce((sum, value) => sum + value, 0)).toBe(modelDays);
  });
});

function conditioning(
  format: "amrap" | "emom" | "for_time" | "intervals",
  movements: Array<{ key: string; amount: string; name_ko: string }>,
  equipment: Array<"bodyweight" | "rower" | "kettlebell">,
  pattern: "engine" | "hinge",
) {
  return {
    benchmark: false,
    format,
    time_domain: "medium" as const,
    stimulus: "high_rep" as const,
    movement_patterns: [pattern],
    movements,
    equipment,
    rep_structure: "반복",
    work_rest_structure: "쉼",
    duration_min: 14,
    volume: "moderate" as const,
    intensity: "moderate" as const,
    long_conditioning: false,
    purpose: "서로 다른 구조로 비교합니다.",
  };
}

describe("coaching pipeline production guard", () => {
  beforeEach(() => {
    freshDb();
  });

  it("keeps the stage10 route when the flag is off and refuses the live week when it is on", async () => {
    expect(coachingPipelineEnabled()).toBe(false);
    const week = await ensureProgrammingWeek("2099-08-03", { nowMs: NOW, key: null });
    expect(week.weekStart).not.toBe("2026-10-05");
    expect(week.promptVersion).toBe(WEEKLY_PROMPT_VERSION);
    expect(week.promptVersion).not.toBe(COACHING_PIPELINE_VERSION);
    process.env.COACHING_PIPELINE = "1";
    await expect(ensureProgrammingWeek("2026-10-05", { nowMs: NOW, key: null })).rejects.toThrow(/2026-10-05/);
    const live = (await import("../src/lib/db/client")).getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM programming_weeks WHERE week_start = '2026-10-05'")
      .get() as { c: number };
    expect(live.c).toBe(0);
    delete process.env.COACHING_PIPELINE;
  });
});
