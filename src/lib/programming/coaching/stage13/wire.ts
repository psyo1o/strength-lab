import type { SessionDraft, StoredStructure, WeeklyIntentPlan } from "../../types";
import type { WeekActual } from "../../summary";
import { fatigueReport, type FatigueReport } from "../fatigue";
import { variationReport, type VariationReport } from "../variation";
import { finishTrace, inputHash, type AgentTrace } from "../trace";
import {
  analyzeIntensity,
  analyzeMovementHistory,
  analyzeMovementPatterns,
  analyzeProgression,
  analyzeRecentVariation,
  analyzeRecovery,
  analyzeStimulus,
  analyzeStructureSimilarity,
  analyzeTimeDomain,
  analyzeVolume,
  analyzeWeekInteraction,
  analyzeWeekStructure,
} from "./analyzers";
import {
  conditioningReview,
  funReview,
  integrateSpecialists,
  practicalReview,
  recoveryReview,
  strengthReview,
  variationReview,
  type IntegratorDecision,
  type SpecialistReview,
} from "./specialists";
import type { WeekRules } from "./rules";
import { sessionSelfReport } from "./validators";
import type { DayIntent } from "../../types";

function line(input: Omit<AgentTrace, "duration_ms"> & { started?: number }): AgentTrace {
  return finishTrace(input.started ?? Date.now(), input);
}

export function selfValidatorTraces(input: {
  runId: string;
  weekId: string;
  day: string;
  json: unknown;
  intent: DayIntent;
  revision: number;
}): AgentTrace[] {
  const report = sessionSelfReport(input.json, input.intent);
  const rows: Array<[AgentTrace["agent_name"], string[]]> = [
    ["session_schema_validator", report.schema],
    ["session_movement_validator", report.movement],
    ["session_duration_validator", report.duration],
    ["session_format_validator", report.format],
    ["session_volume_validator", report.volume],
    ["session_intensity_validator", report.intensity],
    ["session_equipment_validator", report.equipment],
    ["session_unit_validator", report.unit],
  ];
  return rows.map(([agent, errors]) =>
    line({
      run_id: input.runId,
      week_id: input.weekId,
      day: input.day,
      agent_name: agent,
      agent_type: "validator",
      model: null,
      prompt_version: "session-self-v1",
      input_hash: inputHash({ day: input.day, agent, revision: input.revision }),
      input_summary: { day: input.day },
      output: { errors },
      parsed_output: { errors },
      validation_result: errors.length ? "fail" : "pass",
      validation_errors: errors,
      retry_count: 0,
      failure_reason: errors.length ? "SESSION_SELF_ERROR" : null,
      deterministic: true,
      source: "fallback",
      revision_number: input.revision,
      decision: errors.length ? "REJECT" : "PASS",
      token_usage: null,
    }),
  );
}

export function analyzeBundle(input: {
  runId: string;
  weekId: string;
  revision: number;
  sessions: readonly SessionDraft[];
  plan: WeeklyIntentPlan;
  rules: WeekRules;
  recent: readonly StoredStructure[];
  actual?: WeekActual | null;
}): {
  fatigue: FatigueReport;
  variation: VariationReport;
  specialists: SpecialistReview[];
  integrator: IntegratorDecision;
  traces: AgentTrace[];
} {
  const fatigue = fatigueReport({ sessions: input.sessions, actual: input.actual });
  const variation = variationReport({
    sessions: input.sessions,
    recent: input.recent,
    progressingLifts: input.plan.days.filter((day) => day.progression_required).map((day) => day.strength_lift),
  });
  const history = analyzeMovementHistory({ sessions: input.sessions, recent: input.recent });
  const patterns = analyzeMovementPatterns({ sessions: input.sessions, recent: input.recent });
  const structures = analyzeStructureSimilarity({ sessions: input.sessions, recent: input.recent });
  const stimulus = analyzeStimulus(input.sessions, input.recent);
  const timeDomain = analyzeTimeDomain(input.sessions, input.recent);
  const volume = analyzeVolume(input.sessions);
  const intensity = analyzeIntensity(input.sessions, input.recent);
  const progression = analyzeProgression({ sessions: input.sessions, plan: input.plan });
  const interaction = analyzeWeekInteraction(input.sessions);
  const recentVariation = analyzeRecentVariation({ sessions: input.sessions, recent: input.recent });
  const recovery = analyzeRecovery(input.sessions);
  const specialists: SpecialistReview[] = [
    strengthReview({ sessions: input.sessions, plan: input.plan, rules: input.rules, fatigue }),
    conditioningReview({ sessions: input.sessions, rules: input.rules }),
    recoveryReview(input.sessions),
    variationReview({ sessions: input.sessions, plan: input.plan, structures }),
    practicalReview(input.sessions),
    funReview(input.sessions),
  ];
  const integrator = integrateSpecialists(specialists);
  const base = {
    run_id: input.runId,
    week_id: input.weekId,
    revision_number: input.revision,
    model: null as string | null,
    retry_count: 0,
    deterministic: true,
    source: "fallback" as const,
    token_usage: null,
  };
  const fact = (agent: AgentTrace["agent_name"], output: unknown, fail = false): AgentTrace =>
    line({
      ...base,
      agent_name: agent,
      agent_type: "analyzer",
      prompt_version: "stage13-analyzer-v1",
      input_hash: inputHash({ agent, revision: input.revision }),
      input_summary: { revision: input.revision },
      output,
      parsed_output: output,
      validation_result: fail ? "fail" : "pass",
      failure_reason: fail ? "concern" : null,
      decision: fail ? "CONCERN" : "PASS",
    });
  const traces: AgentTrace[] = [
    fact("movement_history_analyzer", history),
    fact("movement_pattern_analyzer", patterns),
    fact("structure_similarity_analyzer", structures),
    fact("stimulus_analyzer", stimulus),
    fact("time_domain_analyzer", timeDomain),
    fact("volume_analyzer", volume),
    fact("intensity_analyzer", intensity),
    fact("progression_analyzer", progression),
    fact("week_interaction_analyzer", interaction),
    fact("recent_variation_analyzer", recentVariation),
    line({
      ...base,
      agent_name: "fatigue_engine",
      agent_type: "analyzer",
      prompt_version: fatigue.version,
      input_hash: inputHash({ reported: fatigue.reported_fatigue, planned: fatigue.planned_volume, revision: input.revision }),
      input_summary: { reported_fatigue: fatigue.reported_fatigue, planned_volume: fatigue.planned_volume },
      output: fatigue,
      parsed_output: fatigue,
      validation_result: "pass",
      failure_reason: null,
      decision: fatigue.recovery_need,
    }),
    line({
      ...base,
      agent_name: "variation_engine",
      agent_type: "analyzer",
      prompt_version: variation.version,
      input_hash: inputHash({ same: variation.same_week_similarity, accidental: variation.accidental_repetition, revision: input.revision }),
      input_summary: { same_week_similarity: variation.same_week_similarity, accidental: variation.accidental_repetition },
      output: variation,
      parsed_output: variation,
      validation_result: "pass",
      failure_reason: null,
      decision: variation.progression_justified ? "INTENTIONAL_PROGRESSION" : "OBSERVED",
    }),
    line({
      ...base,
      agent_name: "recovery_analyzer",
      agent_type: "analyzer",
      prompt_version: "recovery-analyzer-v1",
      input_hash: inputHash({ status: recovery.status, revision: input.revision }),
      output: recovery,
      parsed_output: recovery,
      validation_result: "pass",
      failure_reason: null,
      decision: recovery.status,
    }),
    ...specialists.map((review) =>
      line({
        ...base,
        agent_name: `${review.name}_coach` as AgentTrace["agent_name"],
        agent_type: "coach",
        prompt_version: `${review.name}-coach-v1`,
        input_hash: inputHash({ name: review.name, revision: input.revision }),
        output: review,
        parsed_output: review,
        validation_result: "pass",
        failure_reason: null,
        decision: review.status,
      }),
    ),
    line({
      ...base,
      agent_name: "head_integrator",
      agent_type: "coach",
      prompt_version: "head-integrator-v1",
      input_hash: inputHash({ must: integrator.must_revise, minor: integrator.only_minor, revision: input.revision }),
      output: integrator,
      parsed_output: integrator,
      validation_result: "pass",
      failure_reason: null,
      decision: integrator.must_revise ? "REVISE" : integrator.only_minor ? "MINOR" : "CLEAR",
    }),
  ];
  return { fatigue, variation, specialists, integrator, traces };
}
