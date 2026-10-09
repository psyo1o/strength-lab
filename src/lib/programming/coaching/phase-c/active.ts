import { LIVE_CLASS_WEEK } from "../pipeline";
import { insertCoachTraces } from "../../store";
import { getProgrammingWeek } from "../../store";
import { getSqlite } from "../../../db/client";
import { inputHash } from "../trace";
import { fingerprint, type PhaseCPacket } from "./logic";
import { PHASE_C_REVIEW_VERSION, runPhaseCReview, type PhaseCRun } from "./run";
import type { MonthDirection } from "../../types";

const GAPS = ["회원 1RM, 당일 컨디션, 장기 기록은 이 패킷에 없다. 없는 값은 만들지 않는다."];

export function packetFromWeek(weekStart: string): PhaseCPacket {
  if (weekStart === LIVE_CLASS_WEEK || !weekStart.startsWith("2099-")) {
    throw new Error(`phase C refuses ${weekStart}`);
  }
  const week = getProgrammingWeek(weekStart);
  if (!week) throw new Error(`phase C found no week ${weekStart}`);
  const plan = week.intent.plan;
  const skeleton = plan?.longitudinal?.skeleton;
  const gaps = [...GAPS];
  const monthRow = getSqlite()
    .prepare(`SELECT direction_json FROM programming_months WHERE id = ?`)
    .get(week.monthId) as { direction_json: string } | undefined;
  let month: PhaseCPacket["month"] = null;
  if (!monthRow) gaps.push("월간 방향 행이 없다.");
  else {
    const direction = JSON.parse(monthRow.direction_json) as Partial<MonthDirection>;
    month = {
      scheme: typeof direction.scheme === "string" ? direction.scheme : null,
      strength_method: typeof direction.strength_method === "string" ? direction.strength_method : null,
      focus_ko: typeof direction.focus_ko === "string" ? direction.focus_ko : null,
      why_ko: typeof direction.why_ko === "string" ? direction.why_ko : null,
    };
  }
  if (!skeleton?.skeleton_locked) gaps.push("잠긴 주간 뼈대가 없다.");
  const days = week.draft.sessions.flatMap((session) => {
    if (session.rest || !session.conditioning) return [];
    const intent = plan?.days.find((row) => row.day === session.day) ?? null;
    const lock = skeleton?.days.find((row) => row.day === session.day) ?? null;
    return [{ day: session.day, intent, lock, session }];
  });
  return {
    week_start: weekStart,
    month,
    thesis: plan?.longitudinal?.weekly_thesis.thesis ?? null,
    gaps,
    days,
  };
}

function storedRun(raw: string): PhaseCRun | null {
  const parsed = JSON.parse(raw) as { output?: PhaseCRun; prompt_version?: string };
  const output = parsed.output;
  if (!output || output.decision == null || !output.input_hash) return null;
  return output;
}

export function findPhaseCRun(weekStart: string, hash: string): PhaseCRun | null {
  const rows = getSqlite()
    .prepare(
      `SELECT raw_json FROM programming_generation_logs
       WHERE scope = 'week' AND scope_key = ? AND prompt_version = ?`,
    )
    .all(weekStart, PHASE_C_REVIEW_VERSION) as Array<{ raw_json: string }>;
  for (const row of rows) {
    const run = storedRun(row.raw_json);
    if (run?.input_hash === hash) return { ...run, duplicate: true, calls: 0, tokens: 0, elapsed_ms: 0 };
  }
  return null;
}

export function persistPhaseCRun(input: { weekStart: string; planId: number; run: PhaseCRun }): void {
  insertCoachTraces({
    scopeKey: input.weekStart,
    planId: input.planId,
    createdAt: Date.now(),
    traces: [
      {
        run_id: input.run.input_hash,
        agent_name: "head_coach",
        model: input.run.model,
        prompt_version: PHASE_C_REVIEW_VERSION,
        input_hash: input.run.input_hash,
        output: input.run,
        validation_result: input.run.validation.ok ? "pass" : "fail",
        duration_ms: input.run.elapsed_ms,
        retry_count: input.run.validation.attempts,
        failure_reason: input.run.failure_reason,
        deterministic: false,
      },
    ],
  });
}

/**
 * Reviews one stored 2099 week. Writes a generation log. Does not update the week row.
 * A second call with the same sessions returns the stored review and does not call the model.
 */
export async function reviewActiveWeek(input: {
  weekStart: string;
  key: string;
  fetchImpl?: Parameters<typeof runPhaseCReview>[0]["fetchImpl"];
}): Promise<PhaseCRun> {
  const packet = packetFromWeek(input.weekStart);
  const hash = inputHash(fingerprint(packet));
  const prior = findPhaseCRun(input.weekStart, hash);
  if (prior) return prior;
  const week = getProgrammingWeek(input.weekStart);
  const run = await runPhaseCReview({ packet, key: input.key, fetchImpl: input.fetchImpl });
  persistPhaseCRun({ weekStart: input.weekStart, planId: week?.id ?? 0, run });
  return run;
}

export function sessionsUnchanged(before: string, after: string): boolean {
  return before === after;
}
