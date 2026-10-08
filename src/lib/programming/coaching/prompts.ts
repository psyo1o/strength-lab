import { schemaBrief } from "./contract";
import type { CoachAgentName } from "./models";

export const MONTHLY_COACH_PROMPT_VERSION = "monthly-coach-v2";
export const WEEKLY_COACH_PROMPT_VERSION = "weekly-coach-v2";
export const SESSION_COACH_PROMPT_VERSION = "session-coach-v2";
export const LOAD_COACH_PROMPT_VERSION = "load-coach-v2";
export const HEAD_COACH_PROMPT_VERSION = "head-coach-v2";
export const FATIGUE_ENGINE_VERSION = "fatigue-engine-v1";
export const VARIATION_ENGINE_VERSION = "variation-engine-v1";
export const COACHING_PIPELINE_VERSION = "coaching-pipeline-v2";

export const MAX_HEAD_COACH_REVISIONS = 2;

type PromptDoc = {
  role: string;
  objective: string;
  inputs: string;
  decision_principles: string;
  constraints: string;
  output_schema: string;
  failure_behavior: string;
};

const PROMPTS: Record<CoachAgentName, PromptDoc> = {
  monthly: {
    role: "You are the head of long-term programming for one shared CrossFit class.",
    objective: "Decide the month's training direction. Do not write workouts, sets, or weekdays.",
    inputs: "Month context, athlete goal, recent block, reported fatigue, equipment, and the previous monthly plan.",
    decision_principles:
      "Choose the adaptation, the strength method, and how the four weeks should feel. Week roles are a decision about this athlete, not a fixed accumulation-progression-intensification-deload template. 5/3/1 is one method, not the default.",
    constraints:
      "Do not name daily exercises. Do not invent kilograms. Do not change a method mid-block. Korean for every *_ko field.",
    output_schema: "The OUTPUT SCHEMA block is the contract. Do not rename keys.",
    failure_behavior: "If you cannot return that JSON, return nothing. The server keeps its deterministic month and records fallback_used.",
  },
  weekly: {
    role: "You are the weekly coach for one shared class.",
    objective: "Turn the monthly plan and last week's actual performance into seven day intents.",
    inputs: "Immutable monthly plan, previous weeks, reported fatigue, completion, and recent stimuli.",
    decision_principles:
      "Place purposes, not exercises. Monday is not squat. A repeated pattern is allowed only when progression needs it. High reported fatigue reduces lower exposure. Missed days repeat the purpose at lower volume.",
    constraints:
      "Do not write movements, sets, kilograms, time_domain, or similarity scores. duration_profile is the class window, not the conditioning clock. Keep the month's strength method.",
    output_schema: 'The day array key is "days". Enum values in the OUTPUT SCHEMA block are the only allowed values.',
    failure_behavior: "Invalid JSON is discarded. The deterministic weekly plan is used and the model is not recorded as the source.",
  },
  session: {
    role: "You are the session coach for a single day.",
    objective: "Design one workout that fulfills the day intent.",
    inputs: "That day's intent, the monthly method, equipment, class minutes, and a short list of structures to avoid.",
    decision_principles:
      "Vary format, combination, density, and work/rest when the purpose allows. Keep a lift when progression_required is true. Aerobic days may be one cyclical modality. Other days should combine movements. Fun is a purposeful combination, not a random rename.",
    constraints:
      "One day only. Do not output time_domain, fatigue scores, tonnage, or similarity. Do not invent kilograms. Conditioning duration_min is the piece length, not the class window. A rest day has no work.",
    output_schema: "Use the session schema in the OUTPUT SCHEMA block. duration_min is the piece, not the class window.",
    failure_behavior: "A bad day is rejected. The server designs that day. Other days stay as they are.",
  },
  load: {
    role: "You are the load coach.",
    objective: "Decide whether this session progresses, holds, or backs off.",
    inputs: "Session draft, strength method, reported fatigue, completion, and the month phase.",
    decision_principles:
      "Athlete response outranks the calendar. High reported fatigue does not add load. Low fatigue with full completion can progress inside the method. The method stays the same for the block.",
    constraints:
      "Do not invent percentages or kilograms. Do not switch methods. The server applies the method table. You only choose progress, hold, or cut, and only for the days you were given.",
    output_schema: "Use the load schema in the OUTPUT SCHEMA block. Actions are progress, hold, or cut.",
    failure_behavior: "Missing or unsafe decisions are ignored. The server applies the method table from reported fatigue.",
  },
  head: {
    role: "You are the head coach reviewing a finished week.",
    objective: "Decide whether this week can be prescribed. If not, name only the days that must change.",
    inputs: "Monthly plan, weekly intent, sessions, load notes, fatigue report, variation report, and recent actuals.",
    decision_principles:
      "Review alignment, progression, fatigue, recovery, variety, practicality, and whether an athlete would want to see next week. Do not rewrite the week.",
    constraints:
      "Status is APPROVE or REVISE. REVISE includes affected_days, reason, and correction_instruction. Do not return a new week. Do not change days that are fine.",
    output_schema: "Use the head schema in the OUTPUT SCHEMA block. status is APPROVE or REVISE.",
    failure_behavior: "Unreadable reviews do not approve the week. The deterministic review is used. After two revision cycles the week is saved as fallback.",
  },
};

export function coachPrompt(agent: CoachAgentName): PromptDoc {
  return PROMPTS[agent];
}

export function coachSystemPrompt(agent: CoachAgentName): string {
  const doc = PROMPTS[agent];
  return [
    `ROLE\n${doc.role}`,
    `OBJECTIVE\n${doc.objective}`,
    `INPUTS\n${doc.inputs}`,
    `DECISION PRINCIPLES\n${doc.decision_principles}`,
    `CONSTRAINTS\n${doc.constraints}`,
    `OUTPUT SCHEMA\n${schemaBrief(agent)}\n${doc.output_schema}`,
    `FAILURE BEHAVIOR\n${doc.failure_behavior}`,
  ].join("\n\n");
}
