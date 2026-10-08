import type { DayKey, WeekIndex } from "../../month-plan/types";
import { fillSessionFields } from "../session-fields";
import type { WeekActual } from "../summary";
import type { MonthDirection, SessionDraft, WeekDraft, WeeklyIntentPlan } from "../types";
import { setsForMethodAction } from "./stage15/method-policy";
import { performanceRead } from "../weekly-intent";
import type { LoadDecisionDraft } from "./contract";

export type LoadDecision = LoadDecisionDraft;

function effortFor(action: LoadDecision["action"]): LoadDecision["target_effort"] {
  if (action === "progress") return "hard";
  if (action === "cut") return "easy";
  return "moderate";
}

function intensityFor(action: LoadDecision["action"]): LoadDecision["relative_intensity"] {
  if (action === "progress") return "up";
  if (action === "cut") return "down";
  return "same";
}

/**
 * Progress, hold, or cut. The sets themselves stay on the method table.
 * High reported fatigue cuts a lower lift. Planned volume does not.
 */
export function deterministicLoadDecisions(input: {
  plan: WeeklyIntentPlan;
  actual?: WeekActual | null;
}): LoadDecision[] {
  const read = performanceRead(input.actual);
  const decisions: LoadDecision[] = [];
  for (const day of input.plan.days) {
    if (day.primary_training === "rest" || day.recovery_role === "rest") continue;
    let action: LoadDecision["action"] = "hold";
    let reason = "이번 세션은 방법 표를 유지합니다.";
    const lower = day.strength_lift === "squat" || day.strength_lift === "deadlift";
    if (lower && read.lower_fatigue === "high") {
      action = "cut";
      reason = "보고된 하체 피로가 높아 이 리프트는 방법 표의 감량 행을 씁니다.";
    } else if (read.many_missed) {
      action = "hold";
      reason = "미완료가 많아 진행하지 않고 유지합니다.";
    } else if (day.progression_required && input.plan.block_phase !== "deload" && read.lower_fatigue !== "high") {
      action = "progress";
      reason = "지난 수행이 안정적이고 이 날은 진행이 필요해 방법 표의 진행 행을 씁니다.";
    } else if (input.plan.block_phase === "deload") {
      action = "hold";
      reason = "딜로드 주입니다. 방법은 유지하고 표의 낮은 볼륨 행을 그대로 둡니다.";
    }
    decisions.push({
      day: day.day,
      action,
      reason_ko: reason,
      target_effort: effortFor(action),
      relative_intensity: intensityFor(action),
    });
  }
  return decisions;
}

export function setsForAction(input: {
  action: LoadDecision["action"];
  month: MonthDirection;
  weekIndex: WeekIndex;
  session: SessionDraft;
}): SessionDraft["strength"] {
  return setsForMethodAction(input).strength;
}

export function applyLoadDecisions(input: {
  draft: WeekDraft;
  decisions: readonly LoadDecision[];
  month: MonthDirection;
  weekIndex: WeekIndex;
}): WeekDraft {
  const byDay = new Map(input.decisions.map((row) => [row.day, row]));
  const sessions = input.draft.sessions.map((session) => {
    const decision = byDay.get(session.day);
    if (!decision || decision.action === "hold" || !session.strength) return session;
    const strength = setsForAction({ action: decision.action, month: input.month, weekIndex: input.weekIndex, session });
    return fillSessionFields(
      {
        day: session.day,
        rest: session.rest,
        optional: session.optional,
        warmup_min: session.warmup_min,
        warmup_ko: session.warmup_ko,
        strength,
        conditioning: session.conditioning,
      },
      decision.action === "cut" ? "low" : session.strength_volume,
    );
  });
  return { ...input.draft, sessions };
}

export function decisionDays(plan: WeeklyIntentPlan): DayKey[] {
  return plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day);
}
