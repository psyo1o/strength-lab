import { createHash } from "node:crypto";
import { MONTHLY_DIRECTION_SCHEMA_VERSION } from "../direction/contract";
import { MONTH_PLAN_OPENAI_MODEL } from "../../month-plan/week-model";
import {
  CONDITIONING_COACH_PROMPT_VERSION,
  HEAD_COACH_PROMPT_VERSION,
  LOAD_COACH_PROMPT_VERSION,
  MONTHLY_COACH_PROMPT_VERSION,
  SESSION_COACH_PROMPT_VERSION,
  STRENGTH_COACH_PROMPT_VERSION,
  WARMUP_COACH_PROMPT_VERSION,
  WEEKLY_COACH_PROMPT_VERSION,
} from "./prompts";

/** 평주 고강도 상한. extractWeekRules가 이 값을 쓰고, 재요청이 올리지 않는다. */
export const NORMAL_HEAVY_DAY_CAP = 3;

export function coachingConfigMaterial(): {
  model: string;
  schema: string;
  heavy_day_cap: number;
  prompts: Record<string, string>;
} {
  return {
    model: MONTH_PLAN_OPENAI_MODEL,
    schema: MONTHLY_DIRECTION_SCHEMA_VERSION,
    heavy_day_cap: NORMAL_HEAVY_DAY_CAP,
    prompts: {
      monthly: MONTHLY_COACH_PROMPT_VERSION,
      weekly: WEEKLY_COACH_PROMPT_VERSION,
      session: SESSION_COACH_PROMPT_VERSION,
      strength: STRENGTH_COACH_PROMPT_VERSION,
      conditioning: CONDITIONING_COACH_PROMPT_VERSION,
      warmup: WARMUP_COACH_PROMPT_VERSION,
      load: LOAD_COACH_PROMPT_VERSION,
      head: HEAD_COACH_PROMPT_VERSION,
    },
  };
}

export function coachingConfigHash(): string {
  return createHash("sha256").update(JSON.stringify(coachingConfigMaterial())).digest("hex");
}
