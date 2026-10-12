import { DAY_ORDER, type DayKey } from "../../src/lib/month-plan/types";
import { movementCatalog } from "../../src/lib/programming/coaching/pieces";
import { coachWeek, type CoachWeekInput } from "../../src/lib/programming/coaching/pipeline";
import { catalogMovement, prescribedLoad, sampleAmount } from "../../src/lib/programming/coaching/movement-catalog";
import { deterministicMonthlyPlan } from "../../src/lib/programming/coaching/monthly";
import { assembleLegalWeek } from "../../src/lib/programming/coaching/session";
import { planCoachedWeek } from "../../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../../src/lib/programming/fallback";
import type { MonthDirection, SessionDraft, WeekIndex, WeeklyIntentPlan } from "../../src/lib/programming/types";

export const NOW = Date.parse("2099-07-06T01:00:00.000Z");

export function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

export function weekStart(weekIndex: WeekIndex): string {
  return (["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"] as const)[weekIndex - 1]!;
}

type Script = {
  month: MonthDirection;
  weekIndex: WeekIndex;
  monthly: "valid" | "invalid";
  weekly: "valid" | "seven_days";
  head: "approve" | "revise" | "block" | "swap";
  longitudinal?: CoachWeekInput["longitudinal"];
};

function chat(content: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function monthlyJson(month: MonthDirection) {
  const plan = deterministicMonthlyPlan(month);
  return { ...plan, fatigue_tolerance: "moderate", variety_requirement: "moderate", source: undefined, version: undefined };
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

function goalMovements(keys: readonly string[]) {
  return keys.map((key) => ({
    key,
    movement: key,
    amount: sampleAmount(key),
    unit: catalogMovement(key)?.units[0] ?? "reps",
    name_ko: movementCatalog().find((row) => row.key === key)?.name_ko ?? key,
    load: prescribedLoad(key),
  }));
}

function sessionJson(session: SessionDraft, mark: string, keys?: readonly string[]) {
  const piece = session.conditioning;
  if (!piece) return { day: session.day };
  const movements = keys?.length
    ? goalMovements(keys)
    : piece.movements.map((movement) => ({ ...movement, load: movement.load ?? prescribedLoad(movement.key) }));
  return {
    day: session.day,
    warmup_ko: `${mark} 준비 동작을 먼저 합니다.`,
    notes_ko: `${mark} 조합을 이 날의 목적으로 유지합니다.`,
    conditioning: {
      format: piece.format,
      duration_min: piece.duration_min,
      stimulus: piece.stimulus,
      movements,
      equipment: piece.equipment,
      volume: piece.volume,
      intensity: piece.intensity,
      interval_work_sec: piece.format === "intervals" ? 30 : null,
      interval_rest_sec: piece.format === "intervals" ? 30 : null,
    },
  };
}

function basePlan(script: Script) {
  return planCoachedWeek({ month: script.month, weekIndex: script.weekIndex });
}

function baseSession(script: Script, day: DayKey): SessionDraft | undefined {
  const plan = basePlan(script);
  const built = assembleLegalWeek({ month: script.month, weekIndex: script.weekIndex, plan });
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

function swapTarget(script: Script): { day: DayKey; catalogKey: string; value: string } | null {
  const plan = basePlan(script);
  const day = plan.days.find((row) => row.primary_training !== "rest" && row.recovery_role !== "rest");
  if (!day) return null;
  const session = baseSession(script, day.day);
  const catalogKey = session?.conditioning?.movements[0]?.key;
  if (!catalogKey) return null;
  return { day: day.day, catalogKey, value: catalogKey === "row" ? "burpee" : "row" };
}

function headJson(script: Script, days: DayKey[]) {
  const day = days[0] ?? "mon";
  if (script.head === "block") {
    return { status: "BLOCK", note_ko: "이 주는 채택하지 않습니다.", revisions: [], adjustments: [] };
  }
  if (script.head === "swap") {
    const target = swapTarget(script);
    return {
      status: "REVISE",
      note_ko: "그 칸의 동작만 바꿉니다.",
      revisions: target
        ? [
            {
              day: target.day,
              block: "conditioning",
              catalog_key: target.catalogKey,
              field: "movement",
              value: target.value,
              reason: "이 칸의 동작만 바꿉니다.",
            },
          ]
        : [],
      adjustments: [],
    };
  }
  if (script.head === "revise") {
    return {
      status: "REVISE",
      note_ko: "문제 있는 날의 컨디셔닝 시간만 낮춥니다.",
      revisions: [],
      adjustments: [
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
      ],
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

export function fetchFor(script: Script) {
  const plan = basePlan(script);
  const fetchImpl = async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const raw = body.messages?.find((message) => message.role === "user")?.content ?? "{}";
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return chat("not-json");
    }
    const topAgent = agentOf(parsed);
    const nested = parsed.original_input;
    const user =
      (topAgent === "context:conditioning" || topAgent === "unknown") && nested && typeof nested === "object" && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : parsed;
    const agent = agentOf(user);
    const dayOf = () => String((user.day_intent as { day?: string } | undefined)?.day ?? (user.context as { day?: string } | undefined)?.day ?? "");
    if (agent === "monthly_coach" || agent === "context:monthly") {
      if (script.monthly === "invalid") return chat({});
      return chat(monthlyJson(script.month));
    }
    if (agent === "weekly_coach" || agent === "context:weekly") {
      if (script.weekly === "seven_days") return chat({ seven_days: plan.days, block_phase: "이번 주는 가볍게" });
      return chat(weeklyJson(plan));
    }
    if (agent === "strength_coach") {
      const day = dayOf();
      return chat({ day, strength_note_ko: `모델 ${day} 스트렝스 목적을 유지합니다.` });
    }
    if (agent === "warmup_coach") {
      const day = dayOf();
      return chat({ day, warmup_ko: `모델 ${day} 준비 동작을 먼저 합니다.` });
    }
    if (agent === "conditioning_coach" || agent === "session_coach" || agent === "context:session") {
      const day = dayOf();
      const session = baseSession(script, day as DayKey);
      if (!session) return chat({ day });
      const slot = user.conditioning_slot as { from_goal?: boolean; time_domain?: string; primary_keys?: string[]; stimulus?: string } | undefined;
      const full = sessionJson(session, `모델 ${day}`, slot?.primary_keys);
      if (slot?.from_goal && full.conditioning) {
        full.conditioning.duration_min = slot.time_domain === "long" ? 32 : slot.time_domain === "medium" ? 16 : 10;
        full.conditioning.stimulus = slot.stimulus ?? full.conditioning.stimulus;
        if (full.conditioning.stimulus === "heavy" && full.conditioning.intensity === "light") full.conditioning.intensity = "moderate";
      }
      return chat({ day, notes_ko: full.notes_ko, conditioning: full.conditioning });
    }
    if (agent === "load_coach" || agent === "context:load") return chat(loadJson(plan));
    if (agent === "head_coach" || agent === "context:head") {
      const targets = plan.days.filter((day) => day.primary_training !== "rest").map((day) => day.day);
      return chat(headJson(script, targets));
    }
    return chat("not-json");
  };
  return fetchImpl;
}

export async function runCoach(partial: Partial<Script> = {}) {
  const script: Script = {
    month: partial.month ?? month531(),
    weekIndex: partial.weekIndex ?? 1,
    monthly: partial.monthly ?? "valid",
    weekly: partial.weekly ?? "valid",
    head: partial.head ?? "approve",
    longitudinal: partial.longitudinal,
  };
  const result = await coachWeek({
    month: script.month,
    weekIndex: script.weekIndex,
    weekStart: weekStart(script.weekIndex),
    key: "sk-test",
    fetchImpl: fetchFor(script),
    timeoutMs: 1000,
    longitudinal: script.longitudinal,
    nowMs: NOW,
  });
  return { result, script };
}

export function trainingDaysOf(plan: WeeklyIntentPlan) {
  return plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
}

export { DAY_ORDER };
