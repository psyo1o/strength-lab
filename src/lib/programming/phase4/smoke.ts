import { assembleLegalWeek } from "../coaching/session";
import { planCoachedWeek } from "../coaching/weekly";
import { areaShapeErrors } from "../coaching/orchestrate";
import { monthlyCoachPayload, withCoachingPlan } from "../coaching/monthly";
import { weeklyCoachPayload } from "../coaching/weekly";
import { askCoach } from "../coaching/llm";
import {
  headReviewErrors,
  headReviewFormat,
  loadDecisionErrors,
  monthlyPlanErrors,
  weeklyIntentErrors,
} from "../coaching/contract";
import { goalTableErrors, goalWeek, parseGoalTable, weekGoalAlignmentErrors } from "../coaching/goal-table";
import { extractWeekRules, monthlyStrategyErrors, weekPlanErrors } from "../coaching/stage13/rules";
import { pieceCells } from "../coaching/head-cells";
import { catalogPromptLinesFor } from "../coaching/movement-catalog";
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

function specialist(area: "strength" | "conditioning" | "warmup", promptVersion: string, day: DayIntent): SmokeCoach["call"] {
  return async (key, index) => {
    const asked = await askCoach({
      agent: area,
      retryTransport: true,
      user: {
        agent_name: `${area}_coach`,
        day_intent: day,
        week_index: 1,
        week_rules: rules,
        movement_catalog: catalogPromptLinesFor({
          movementPattern: day.movement_pattern,
          strengthLift: day.strength_lift,
          primaryTraining: day.primary_training,
          extraKeys: [],
        }),
        smoke_index: index,
      },
      key,
      timeoutMs: 90_000,
      maxTokens: 1800,
      promptVersion,
      runId: `phase4-a-${area}-${index}`,
      validate: (json) => {
        const errors = areaShapeErrors(area, json, day);
        return errors.length ? { ok: false, errors } : { ok: true };
      },
    });
    return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
  };
}

export function smokeCoaches(): SmokeCoach[] {
  const day = training!;
  return [
    {
      coach: "monthly",
      promptVersion: MONTHLY_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const asked = await askCoach({
          agent: "monthly",
          retryTransport: true,
          user: monthlyCoachPayload(month),
          key,
          timeoutMs: 90_000,
          maxTokens: 8000,
          promptVersion: MONTHLY_COACH_PROMPT_VERSION,
          runId: `phase4-a-monthly-${index}`,
          validate: (json) => {
            const table = json && typeof json === "object" ? parseGoalTable((json as { goal_table?: unknown }).goal_table) : null;
            const errors = [...monthlyPlanErrors(json, month), ...monthlyStrategyErrors(json, month), ...goalTableErrors(table, month)];
            return errors.length ? { ok: false, errors } : { ok: true };
          },
        });
        return { ok: asked.ok, first: asked.ok ? "" : firstError(asked.validationErrors, asked.reason) };
      },
    },
    {
      coach: "weekly",
      promptVersion: WEEKLY_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const asked = await askCoach({
          agent: "weekly",
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
    { coach: "strength", promptVersion: STRENGTH_COACH_PROMPT_VERSION, call: specialist("strength", STRENGTH_COACH_PROMPT_VERSION, day) },
    { coach: "conditioning", promptVersion: CONDITIONING_COACH_PROMPT_VERSION, call: specialist("conditioning", CONDITIONING_COACH_PROMPT_VERSION, day) },
    { coach: "warmup", promptVersion: WARMUP_COACH_PROMPT_VERSION, call: specialist("warmup", WARMUP_COACH_PROMPT_VERSION, day) },
    {
      coach: "load",
      promptVersion: LOAD_COACH_PROMPT_VERSION,
      call: async (key, index) => {
        const asked = await askCoach({
          agent: "load",
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
          retryTransport: true,
          user: {
            agent_name: "head_coach",
            smoke_index: index,
            piece_cells: cells,
            constitution:
              "You are called once. If a problem can be fixed by a cell, return that cell. Do not ask for regeneration. BLOCK only for a safety risk, a collapsed week structure, or a training day with no session.",
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
