import { MONTH_PLAN_OPENAI_MODEL } from "../../month-plan/week-model";

/** One model id per coach. Unset variables fall back to the current class model, never to a hardcoded upgrade. */
export type CoachAgentName = "monthly" | "weekly" | "session" | "load" | "head" | "variation_judge" | "recovery_judge";

const ENV_BY_AGENT: Record<CoachAgentName, readonly string[]> = {
  monthly: ["MONTHLY_MODEL", "MONTHLY_COACH_MODEL"],
  weekly: ["WEEKLY_MODEL", "WEEKLY_COACH_MODEL"],
  session: ["SESSION_MODEL", "SESSION_COACH_MODEL"],
  load: ["LOAD_MODEL", "LOAD_COACH_MODEL"],
  head: ["HEAD_FINAL_MODEL", "HEAD_COACH_MODEL"],
  variation_judge: ["VARIATION_JUDGE_MODEL"],
  recovery_judge: ["RECOVERY_JUDGE_MODEL"],
};

/** Judgment agents that stay on nano until a later stage promotes one of them. */
export const STAGE13_MODEL_ENV = {
  variation_judge: "VARIATION_JUDGE_MODEL",
  strength_review: "STRENGTH_REVIEW_MODEL",
  conditioning_review: "CONDITIONING_REVIEW_MODEL",
  recovery_review: "RECOVERY_REVIEW_MODEL",
  practical_review: "PRACTICAL_REVIEW_MODEL",
  fun_review: "FUN_REVIEW_MODEL",
  head_integrator: "HEAD_INTEGRATOR_MODEL",
  head_final: "HEAD_FINAL_MODEL",
} as const;

export function stage13Model(agent: keyof typeof STAGE13_MODEL_ENV, env: NodeJS.ProcessEnv = process.env): string {
  const specific = env[STAGE13_MODEL_ENV[agent]]?.trim();
  if (specific) return specific;
  const shared = env.COACHING_MODEL?.trim();
  if (shared) return shared;
  return MONTH_PLAN_OPENAI_MODEL;
}

export function coachModel(agent: CoachAgentName, env: NodeJS.ProcessEnv = process.env): string {
  const specific = ENV_BY_AGENT[agent].map((name) => env[name]?.trim()).find((value) => Boolean(value));
  if (specific) return specific;
  const shared = env.COACHING_MODEL?.trim();
  if (shared) return shared;
  return MONTH_PLAN_OPENAI_MODEL;
}

export function coachingPipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COACHING_PIPELINE === "1";
}
