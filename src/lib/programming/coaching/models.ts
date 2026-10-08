import { MONTH_PLAN_OPENAI_MODEL } from "../../month-plan/week-model";

/** One model id per coach. Unset variables fall back to the current class model, never to a hardcoded upgrade. */
export type CoachAgentName = "monthly" | "weekly" | "session" | "load" | "head";

const ENV_BY_AGENT: Record<CoachAgentName, string> = {
  monthly: "MONTHLY_COACH_MODEL",
  weekly: "WEEKLY_COACH_MODEL",
  session: "SESSION_COACH_MODEL",
  load: "LOAD_COACH_MODEL",
  head: "HEAD_COACH_MODEL",
};

export function coachModel(agent: CoachAgentName, env: NodeJS.ProcessEnv = process.env): string {
  const specific = env[ENV_BY_AGENT[agent]]?.trim();
  if (specific) return specific;
  const shared = env.COACHING_MODEL?.trim();
  if (shared) return shared;
  return MONTH_PLAN_OPENAI_MODEL;
}

export function coachingPipelineEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COACHING_PIPELINE === "1";
}
