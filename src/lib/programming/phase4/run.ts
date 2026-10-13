import { mkdirSync, writeFileSync } from "node:fs";
import { coachMonthly } from "../coaching/monthly";
import { coachWeek } from "../coaching/pipeline";
import { DAY_ORDER } from "../../month-plan/types";
import {
  generateWeekSkeleton,
  lockWeekSkeleton,
  lockedSkeletonDrift,
  MONTHLY_DIRECTION_SCHEMA_VERSION,
  validateMonthlyDirection,
  type MonthlyDirection,
} from "../direction";
import { fallbackMonth } from "../fallback";
import { withCoachingPlan } from "../coaching/monthly";
import { getSqlite } from "../../db/client";
import type { FetchLike } from "../model";
import type { DayKey, MonthDirection, MonthGoalTable } from "../types";
import { weekIndexFromStart } from "../types";
import { assertPhase4Budget, configurePhase4Run, phase4TokensSpent, Phase4Stop } from "./budget";
import { assertIsolated2099Database } from "./isolation";
import { smokeCoaches } from "./smoke";

const DB_PATH = "/tmp/strength-lab-phase4-2099.db";

const PROFILES = [
  { id: "531", prior: { summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531" as const, strength_method: "531" } },
  { id: "volume", prior: { summary_ko: "지난 달은 볼륨이었습니다.", next_scheme: "volume" as const, strength_method: "VOLUME_ACCUMULATION" } },
  { id: "intensity", prior: { summary_ko: "지난 달은 고강도였습니다.", next_scheme: "intensity" as const, strength_method: "INTENSITY_BLOCK" } },
] as const;

const WEEKS: Record<(typeof PROFILES)[number]["id"], readonly string[]> = {
  "531": ["2099-01-05", "2099-04-06", "2099-07-06"],
  volume: ["2099-02-02", "2099-05-04", "2099-08-03"],
  intensity: ["2099-03-02", "2099-06-02", "2099-09-07"],
};

export type StageRow = { stage: string; pass: boolean; detail: string };
export type FailureRow = { stage: string; coach: string; point: string; count: number };

function readDates(): { months: string[]; weeks: string[] } {
  const db = getSqlite();
  const names = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((row) => row.name),
  );
  const months = names.has("programming_months")
    ? (db.prepare("SELECT month_start FROM programming_months").all() as Array<{ month_start: string }>).map((row) => row.month_start)
    : [];
  const weeks = names.has("programming_weeks")
    ? (db.prepare("SELECT week_start FROM programming_weeks").all() as Array<{ week_start: string }>).map((row) => row.week_start)
    : [];
  return { months, weeks };
}

function guardedFetch(base: typeof fetch): FetchLike {
  return async (url, init) => {
    assertPhase4Budget();
    const response = await base(url, init);
    if (response.status === 429) throw new Phase4Stop("model returned 429");
    const text = await response.text();
    return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export async function runPhase4(input: { key: string; dbPath?: string; logPath: string }): Promise<{
  stages: StageRow[];
  failures: FailureRow[];
  adopted: number;
  weeks: number;
  tokens: number;
  stopped: string | null;
}> {
  const dbPath = input.dbPath ?? DB_PATH;
  if (dbPath !== DB_PATH && !dbPath.startsWith("/tmp/")) throw new Phase4Stop("refusing database outside /tmp");
  const dates = readDates();
  assertIsolated2099Database(dbPath, dates);
  for (const week of Object.values(WEEKS).flat()) {
    if (!week.startsWith("2099-") || week === "2026-10-05" || week === "2026-10-12") throw new Phase4Stop(`refusing week ${week}`);
  }
  configurePhase4Run({ tokenCap: 1_500_000, logPath: input.logPath });
  const fetchImpl = guardedFetch(fetch);
  const stages: StageRow[] = [];
  const counts = new Map<string, number>();
  let adopted = 0;
  let weeks = 0;
  let stopped: string | null = null;

  const fail = (stage: string, coach: string, point: string) => bump(counts, `${stage}|${coach}|${point}`);

  const wanted = new Set((process.env.PHASE4_STAGES ?? "A,B,C").split(",").map((item) => item.trim()).filter(Boolean));
  try {
    if (!wanted.has("A")) throw new Phase4Stop("stage A skipped");
    process.env.PHASE4_STAGE = "A";
    const only = (process.env.PHASE4_COACHES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const smoke = smokeCoaches().filter((coach) => only.length === 0 || only.includes(coach.coach));
    let calls = 0;
    let passed = 0;
    const perCoach: string[] = [];
    for (const coach of smoke) {
      let ok = 0;
      for (let index = 1; index <= 5; index += 1) {
        calls += 1;
        const result = await coach.call(input.key, index);
        if (result.ok) {
          ok += 1;
          passed += 1;
        } else fail("A", coach.coach, result.first || "schema");
      }
      perCoach.push(`${coach.coach} ${ok}/5`);
      console.log(`A ${coach.coach} ${ok}/5`);
    }
    const rate = calls === 0 ? 0 : passed / calls;
    const aPass = rate >= 0.95;
    stages.push({ stage: "A", pass: aPass, detail: `${passed}/${calls} (${perCoach.join(", ")})` });
    if (!aPass) throw new Phase4Stop("stage A below 95%");
    if (!wanted.has("B")) return { stages, failures: [], adopted, weeks, tokens: phase4TokensSpent(), stopped: null };

    process.env.PHASE4_STAGE = "B";
    let bOk = 0;
    for (let index = 1; index <= 3; index += 1) {
      const monthId = `2099-0${index + 6}`;
      const base = withCoachingPlan(fallbackMonth(PROFILES[0].prior));
      const coached = await coachMonthly({
        month: base,
        key: input.key,
        fetchImpl,
        timeoutMs: 90_000,
        runId: `phase4-b-${index}`,
        weekId: `${monthId}-06`,
        monthId,
        profileId: "531",
      });
      if (coached.direction.degraded || coached.direction.source !== "coach" || !coached.plan.goal_table) {
        fail("B", "monthly", coached.direction.reason ?? coached.trace.failure_reason ?? "monthly_degraded");
        console.log(`B ${index} degraded ${coached.direction.reason ?? ""}`);
        continue;
      }
      const month: MonthDirection = { ...base, coaching_plan: coached.plan };
      const direction = directionFromCoach(coached.plan.goal_table, month, monthId);
      const monthIssues = validateMonthlyDirection(direction, month);
      if (monthIssues.length) {
        fail("B", "monthly", monthIssues[0] ?? "direction");
        console.log(`B ${index} direction ${monthIssues[0]}`);
        continue;
      }
      const generated = generateWeekSkeleton(direction, 1);
      const locked = lockWeekSkeleton({ skeleton: generated, direction, month });
      if (!locked.ok) {
        fail("B", "skeleton", locked.errors[0]?.message ?? "lock");
        console.log(`B ${index} lock ${locked.errors[0]?.message ?? "lock"}`);
        continue;
      }
      const drift = lockedSkeletonDrift(locked.skeleton);
      if (drift) {
        fail("B", "skeleton", drift);
        console.log(`B ${index} drift`);
        continue;
      }
      bOk += 1;
      console.log(`B ${index} locked ${(locked.skeleton.lock.skeletonHash ?? "").slice(0, 8)}`);
    }
    const bPass = bOk === 3;
    stages.push({ stage: "B", pass: bPass, detail: `${bOk}/3` });
    if (!bPass) throw new Phase4Stop("stage B failed");
    if (!wanted.has("C")) return { stages, failures: [], adopted, weeks, tokens: phase4TokensSpent(), stopped: null };

    process.env.PHASE4_STAGE = "C";
    for (const profile of PROFILES) {
      for (const weekStart of WEEKS[profile.id]) {
        weeks += 1;
        const month = withCoachingPlan(fallbackMonth(profile.prior));
        const result = await coachWeek({
          month,
          weekIndex: weekIndexFromStart(weekStart),
          weekStart,
          key: input.key,
          fetchImpl,
          timeoutMs: 90_000,
        });
        const ok = result.adoption?.persistActive === true && result.generation_source === "model" && result.week_status === "VALIDATED";
        if (ok) adopted += 1;
        else {
          const point = firstPoint(result);
          fail("C", point.coach, point.point);
        }
        console.log(`C ${profile.id} ${weekStart} ${ok ? "adopted" : "failed"} tokens=${phase4TokensSpent()}`);
      }
    }
    const cPass = adopted >= 7;
    stages.push({ stage: "C", pass: cPass, detail: `${adopted}/${weeks}` });
  } catch (error) {
    if (error instanceof Phase4Stop) stopped = error.message;
    else throw error;
  }

  const failures = [...counts.entries()].map(([key, count]) => {
    const [stage, coach, point] = key.split("|");
    return { stage: stage ?? "", coach: coach ?? "", point: point ?? "", count };
  });
  return { stages, failures, adopted, weeks, tokens: phase4TokensSpent(), stopped };
}

const WEEK_STARTS = ["2099-07-06", "2099-07-13", "2099-07-20", "2099-07-27"] as const;

function directionFromCoach(table: MonthGoalTable, month: MonthDirection, monthId: string): MonthlyDirection {
  const days: MonthlyDirection["days"] = [];
  for (const week of table.weeks) {
    for (const day of week.days) {
      const rest = day.rest;
      const start = Date.parse(`${WEEK_STARTS[week.week_index - 1]}T00:00:00.000Z`);
      const date = new Date(start + DAY_ORDER.indexOf(day.day) * 86400000).toISOString().slice(0, 10);
      days.push({
        date,
        day: day.day,
        weekIndex: week.week_index,
        dayType: rest ? "rest" : "train",
        focus: rest ? null : day.focus,
        intensity: rest ? null : day.intensity,
        targets:
          rest || !day.target
            ? { bodyParts: [], movementPatterns: [], energySystems: [] }
            : {
                bodyParts: [day.target.body_region],
                movementPatterns: [day.target.movement_pattern],
                energySystems: [day.target.energy_system],
              },
        stimulus: {
          type: rest ? null : day.stimulus,
          timeDomain: rest || !day.time_domain ? "n/a" : day.time_domain,
        },
        purpose: day.purpose,
      });
    }
  }
  const weeks = ([1, 2, 3, 4] as const).map((weekIndex) => {
    const training = days.filter((day) => day.weekIndex === weekIndex && day.dayType === "train" && day.intensity != null);
    const load = training.length ? Math.round((training.reduce((sum, day) => sum + (day.intensity ?? 0), 0) / training.length) * 10) / 10 : 0;
    return { weekIndex, load };
  });
  return {
    schemaVersion: MONTHLY_DIRECTION_SCHEMA_VERSION,
    monthId,
    profileId: "531",
    goal: { kind: "directional", statement: table.month_goal || month.monthly_goal },
    weeks,
    days,
    generatedBy: { source: "coach", degraded: false, reason: null },
  };
}

function firstPoint(result: {
  monthly_degraded?: boolean;
  fallback_reason?: string | null;
  traces?: Array<{ agent_name?: string; validation_result?: string; failure_reason?: string | null; validation_errors?: string[] }>;
}): { coach: string; point: string } {
  if (result.monthly_degraded) return { coach: "monthly", point: "monthly_degraded" };
  const traces = result.traces ?? [];
  const hit = traces.find((trace) => trace.validation_result === "fail" || (trace.failure_reason && trace.failure_reason !== "rest"));
  if (hit) {
    const text = hit.validation_errors?.[0] ?? hit.failure_reason ?? "fail";
    return { coach: hit.agent_name ?? "week", point: text.slice(0, 180) };
  }
  return { coach: "week", point: (result.fallback_reason ?? "not_adopted").slice(0, 180) };
}

export function writePhase4Report(input: {
  stages: StageRow[];
  failures: FailureRow[];
  adopted: number;
  weeks: number;
  tokens: number;
  stopped: string | null;
  tests: string;
  tsc: string;
}): void {
  mkdirSync("docs", { recursive: true });
  const stageTable = ["| 단계 | 결과 | 내용 |", "| --- | --- | --- |", ...input.stages.map((row) => `| ${row.stage} | ${row.pass ? "통과" : "실패"} | ${row.detail} |`)].join("\n");
  const failTable = input.failures.length
    ? ["| 단계 | 코치 | 첫 실패 | 횟수 |", "| --- | --- | --- | --- |", ...input.failures.map((row) => `| ${row.stage} | ${row.coach} | ${row.point} | ${row.count} |`)].join("\n")
    : "실패 없음";
  const body = [
    "# Phase 4-1 결과",
    "",
    "실제 모델 프로브다. 모킹 테스트와 구분한다. 운영 DB와 운영 주 `2026-10-05`, `2026-10-12`는 쓰지 않았다. DB는 `/tmp/strength-lab-phase4-2099.db`다.",
    "",
    stageTable,
    "",
    `채택 ${input.adopted}/${input.weeks || 0}.`,
    "",
    failTable,
    "",
    input.stopped ? `중단: ${input.stopped}` : "중단 없음.",
    "",
    "고친 것: 호출 단위로 HTTP 오류와 시간 초과를 한 번만 다시 부르고, 재시도 본문에 오류를 넣었다. HTTP 429는 다시 부르지 않는다. 헤드 뒤에는 전문 코치 재생성 루프를 두지 않는다.",
    "",
    `사용 토큰 ${input.tokens}. 상한 1500000.`,
    "",
    input.tests,
    "",
    input.tsc,
    "",
    "남은 위험: 언어 검사 본문은 기존 테스트가 영어 문장을 통과로 잠가 두어 이번 단계에서 채우지 않았다. D와 E는 돌리지 않았다. 유사도 임계값은 4다.",
    "",
  ].join("\n");
  writeFileSync("docs/phase4-1-results.md", body);
  writeFileSync(
    "docs/phase4-1-probe.json",
    JSON.stringify(
      {
        live_model: true,
        db: "/tmp/strength-lab-phase4-2099.db",
        stages: input.stages,
        adopted: input.adopted,
        weeks: input.weeks,
        failures: input.failures,
        tokens: input.tokens,
        stopped: input.stopped,
        token_cap: 1500000,
      },
      null,
      2,
    ),
  );
}
