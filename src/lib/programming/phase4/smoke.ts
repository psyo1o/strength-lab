import { assembleLegalWeek } from "../coaching/session";
import { planCoachedWeek } from "../coaching/weekly";
import { areaShapeErrors } from "../coaching/orchestrate";
import { slotFitErrors } from "../coaching/conditioning-board";
import { buildSessionFrame, expandSlotPayload, isSlotPayload, sessionSlotFormat } from "../coaching/slot-choices";
import { coachMonthly, withCoachingPlan } from "../coaching/monthly";
import { weeklyCoachPayload } from "../coaching/weekly";
import { askCoach } from "../coaching/llm";
import type { FetchLike } from "../model";
import { headReviewErrors, headReviewFormat, loadDecisionErrors, weeklyIntentErrors } from "../coaching/contract";
import { goalWeek, weekGoalAlignmentErrors } from "../coaching/goal-table";
import { extractWeekRules, weekPlanErrors } from "../coaching/stage13/rules";
import { pieceCells } from "../coaching/head-cells";
import { parseHeadReview } from "../coaching/review";
import {
  CONDITIONING_COACH_PROMPT_VERSION,
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  MONTHLY_COACH_PROMPT_VERSION,
  STRENGTH_COACH_PROMPT_VERSION,
  WARMUP_COACH_PROMPT_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "../coaching/prompts";
import { parseWeeklyIntent } from "../weekly-intent";
import { fallbackMonth } from "../fallback";
import type { DayIntent } from "../types";

const month = withCoachingPlan(
  fallbackMonth({ summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531", strength_method: "531" }),
);
const plan = planCoachedWeek({ month, weekIndex: 1 });
const rules = extractWeekRules({ month, weekIndex: 1, actual: null });
const training = plan.days.find((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
if (!training) throw new Error("smoke week has no training day");
const draft = assembleLegalWeek({ month, weekIndex: 1, plan }).draft;
const loadDays = plan.days.filter((day) => day.strength_lift !== "none").map((day) => day.day);

function firstError(errors: string[], reason: string | null): string {
  return errors[0] ?? reason ?? "schema";
}

export type SmokeCoach = {
  coach: string;
  promptVersion: string;
  call: (key: string, index: number) => Promise<{ ok: boolean; first: string }>;
};

function specialist(area: "strength" | "conditioning" | "warmup", promptVersion: string, day: DayIntent, fetchImpl?: FetchLike): SmokeCoach["call"] {
  const slot = plan.conditioning_slots?.[day.day] ?? null;
  const frame = buildSessionFrame({ area, day, slot });
  if (!frame) throw new Error(`${area} slot frame is empty`);
  return async (key, index) => {
    const asked = await askCoach({
      agent: area,
      fetchImpl,
      retryTransport: true,
      user: {
        agent_name: `${area}_coach`,
        day_intent: day,
        week_index: 1,
        week_rules: rules,
        slot_choices: frame.slots.map((row) => ({
          slot: row.id,
          movements: row.movements.map((movement) => ({
            movement_id: movement.key,
            quantity_option: movement.options.map((option) => option.id),
          })),
        })),
        smoke_index: index,
      },
      key,
      timeoutMs: 90_000,
      maxTokens: 1800,
      promptVersion,
      runId: `phase4-a-${area}-${index}`,
      format: sessionSlotFormat(frame),
      validate: (json) => {
        if (!isSlotPayload(json)) return { ok: false, errors: ["expected slot picks"] };
        const built = expandSlotPayload(frame, json);
        if (!built.ok) return { ok: false, errors: built.errors };
        const errors = areaShapeErrors(area, built.json, day);
        if (errors.length) return { ok: false, errors };
        if (area === "conditioning" && slot) {
          const fit = slotFitErrors(built.json, slot, day.strength_lift);
          if (fit.length) return { ok: false, errors: fit, retry: false };
        }
        return { ok: true };
      },
    });
    return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
  };
}

export function smokeCoaches(fetchImpl?: FetchLike): SmokeCoach[] {
  const day = training!;
  return [
    {
      coach: "monthly",
      promptVersion: MONTHLY_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const result = await coachMonthly({
          month,
          key,
          fetchImpl,
          timeoutMs: 90_000,
          runId: `phase4-a-monthly-${index}`,
          weekId: "2099-07-06",
          monthId: "2099-07",
          profileId: `phase4-a-${index}`,
        });
        const errors = result.trace.validation_errors ?? [];
        const ok = result.direction.source === "coach" && result.direction.degraded !== true;
        return { ok, first: ok ? "" : errors[0] || result.direction.reason || "schema" };
      },
    },
    {
      coach: "weekly",
      promptVersion: WEEKLY_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const asked = await askCoach({
          agent: "weekly",
          fetchImpl,
          retryTransport: true,
          user: weeklyCoachPayload({ month, weekIndex: 1 }),
          key,
          timeoutMs: 90_000,
          maxTokens: 6000,
          promptVersion: WEEKLY_COACH_PROMPT_VERSION,
          runId: `phase4-a-weekly-${index}`,
          validate: (json) => {
            const shape = weeklyIntentErrors(json);
            if (shape.length) return { ok: false, errors: shape };
            const parsed = parseWeeklyIntent(json, plan);
            if (!parsed) return { ok: false, errors: ["weekly intent parser rejected the payload"] };
            const goal = goalWeek(month.coaching_plan?.goal_table, 1);
            const errors = goal
              ? [...weekPlanErrors(parsed, rules), ...weekGoalAlignmentErrors(parsed, goal)]
              : ["week goal missing"];
            return errors.length ? { ok: false, errors } : { ok: true };
          },
        });
        return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
      },
    },
    { coach: "strength", promptVersion: STRENGTH_COACH_PROMPT_VERSION, call: specialist("strength", STRENGTH_COACH_PROMPT_VERSION, day, fetchImpl) },
    { coach: "conditioning", promptVersion: CONDITIONING_COACH_PROMPT_VERSION, call: specialist("conditioning", CONDITIONING_COACH_PROMPT_VERSION, day, fetchImpl) },
    { coach: "warmup", promptVersion: WARMUP_COACH_PROMPT_VERSION, call: specialist("warmup", WARMUP_COACH_PROMPT_VERSION, day, fetchImpl) },
    {
      coach: "load",
      promptVersion: LOAD_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const asked = await askCoach({
          agent: "load",
          fetchImpl,
          retryTransport: true,
          user: {
            agent_name: "load_coach",
            strength_method: month.strength_method,
            week_index: 1,
            days: plan.days
              .filter((row) => loadDays.includes(row.day))
              .map((row) => ({ day: row.day, strength_lift: row.strength_lift, progression_required: row.progression_required, volume_profile: row.volume_profile })),
            smoke_index: index,
          },
          key,
          timeoutMs: 90_000,
          maxTokens: 1600,
          promptVersion: LOAD_COACH_PROMPT_VERSION,
          runId: `phase4-a-load-${index}`,
          validate: (json) => {
            const errors = loadDecisionErrors(json, loadDays);
            return errors.length ? { ok: false, errors } : { ok: true };
          },
        });
        return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
      },
    },
    {
      coach: "head",
      promptVersion: HEAD_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const cells = pieceCells(draft.sessions);
        const asked = await askCoach({
          agent: "head",
          fetchImpl,
          retryTransport: true,
          user: {
            agent_name: "head_coach",
            smoke_index: index,
            piece_cells: cells,
            constitution:
              "You are called once. REVISE only with a different movement_id or quantity_option from that cell's enum. If there is no different id, return APPROVE_WITH_NOTE and leave revisions and adjustments empty. Do not ask for regeneration. BLOCK only for a safety risk, a collapsed week structure, or a training day with no session.",
          },
          key,
          timeoutMs: 90_000,
          maxTokens: 1800,
          promptVersion: HEAD_COACH_PROMPT_VERSION,
          runId: `phase4-a-head-${index}`,
          format: headReviewFormat(cells.map((cell) => cell.catalog_key), cells),
          validate: (json) => {
            const errors = headReviewErrors(json);
            if (errors.length) return { ok: false, errors };
            if (!parseHeadReview(json)) return { ok: false, errors: ["head review parser rejected the payload"] };
            return { ok: true };
          },
        });
        return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
      },
    },
  ];
}
