import { describe, expect, it } from "vitest";
import { headReviewErrors, headReviewFormat } from "../src/lib/programming/coaching/contract";
import {
  buildMonthFrame,
  legalMonthlyCellJson,
  mergeRepair,
  monthCellFormat,
  repairSpec,
  slotKey,
  tableByChoiceIndex,
  tableFromCells,
} from "../src/lib/programming/coaching/goal-candidates";
import { goalTableErrors } from "../src/lib/programming/coaching/goal-table";
import { coachMonthly } from "../src/lib/programming/coaching/monthly";
import { HEAD_COACH_PROMPT_VERSION, MONTHLY_COACH_PROMPT_VERSION, coachSystemPrompt } from "../src/lib/programming/coaching/prompts";
import { parseHeadReview } from "../src/lib/programming/coaching/review";
import { runAdjustmentPass } from "../src/lib/programming/coaching/stage16/pass";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { DaySessionGoal, MonthDirection } from "../src/lib/programming/types";

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
}

function chat(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("월간 후보 틀", () => {
  it("1주는 긴 컨디셔닝 주가 아니고 후보 서명은 서로 겹치지 않는다", () => {
    const month = month531();
    const framed = buildMonthFrame(month);
    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    const week1 = framed.frame.weeks.find((week) => week.week_index === 1)!;
    expect(week1.role).toBe("accumulation");
    expect(week1.long_conditioning).toBe(false);
    expect(week1.days.filter((day) => day.time_domain === "long")).toHaveLength(0);
    const longs = framed.frame.weeks.filter((week) => week.long_conditioning);
    expect(longs.map((week) => week.week_index)).toEqual([2, 4]);
    for (const week of longs) {
      expect(week.days.filter((day) => day.time_domain === "long")).toHaveLength(1);
    }
    const seen = new Set<string>();
    for (const week of framed.frame.weeks) {
      for (const day of week.days) {
        if (day.rest) expect(day.choices).toEqual([]);
        else expect(day.choices.length).toBeGreaterThan(0);
        for (const choice of day.choices) {
          const signature = [choice.focus, choice.target.movement_pattern, choice.target.body_region, choice.target.energy_system, choice.stimulus].join("|");
          expect(seen.has(signature)).toBe(false);
          seen.add(signature);
        }
      }
    }
    for (const index of [0, 3]) {
      expect(goalTableErrors(tableByChoiceIndex(framed.frame, index), month)).toEqual([]);
    }
  });

  it("출력 스키마는 날짜별 enum이고 프롬프트에 예시는 없다", () => {
    const framed = buildMonthFrame(month531());
    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    const format = monthCellFormat(framed.frame) as {
      json_schema: { schema: { properties: { days: { properties: Record<string, { properties?: { choice?: { enum?: string[] } } }> } } } };
    };
    const monday = framed.frame.weeks[0]!.days.find((day) => day.day === "mon" && !day.rest)!;
    const other = framed.frame.weeks[1]!.days.find((day) => !day.rest)!;
    const mondayEnum = format.json_schema.schema.properties.days.properties[slotKey(1, monday.day)]?.properties?.choice?.enum ?? [];
    const otherEnum = format.json_schema.schema.properties.days.properties[slotKey(other.week_index, other.day)]?.properties?.choice?.enum ?? [];
    expect(mondayEnum).toEqual(monday.choices.map((choice) => choice.id));
    expect(mondayEnum.some((id) => otherEnum.includes(id))).toBe(false);
    expect(MONTHLY_COACH_PROMPT_VERSION).toBe("monthly-coach-v10");
    expect(coachSystemPrompt("monthly")).not.toContain("Recovery day with no training");
    expect(coachSystemPrompt("monthly")).not.toContain("for example");
  });

  it("위반한 날만 합치면 다시 검증을 통과하고, 빈 후보면 막힌다", () => {
    const month = month531();
    const framed = buildMonthFrame(month);
    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    const table = tableByChoiceIndex(framed.frame, 0);
    const first = table.weeks[0]!.days.find((day) => !day.rest)!;
    const laterWeek = table.weeks[1]!;
    const later = laterWeek.days.find((day) => day.day === first.day)!;
    const copied: DaySessionGoal = {
      ...later,
      focus: first.focus,
      intensity: first.intensity,
      target: first.target ? { ...first.target } : null,
      stimulus: first.stimulus,
    };
    laterWeek.days = laterWeek.days.map((day) => (day.day === later.day ? copied : day));
    expect(goalTableErrors(table, month).length).toBeGreaterThan(0);
    const spec = repairSpec(framed.frame, table, month);
    const hit = spec.days.find((day) => day.key === slotKey(2, later.day));
    expect(hit).toBeTruthy();
    expect(hit?.allowed.length).toBeGreaterThan(0);
    expect(spec.blocked).toBe(false);
    const merged = mergeRepair(framed.frame, table, spec, {
      days: Object.fromEntries(
        spec.days.map((day) => [day.key, day.rest ? { purpose: "Rest day with no training session." } : { choice: day.allowed[0], purpose: "Train the selected target for this date." }]),
      ),
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    expect(goalTableErrors(merged.table, month)).toEqual([]);
    const stripped = structuredClone(framed.frame);
    const slot = stripped.weeks[1]!.days.find((day) => day.day === later.day)!;
    slot.choices = [];
    expect(repairSpec(stripped, table, month).blocked).toBe(true);
  });

  it("셀 응답은 코치 출처이고 빈 객체는 degraded다", async () => {
    const month = month531();
    const legal = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl: async () => chat(legalMonthlyCellJson(month)),
      timeoutMs: 1000,
      runId: "frame-legal",
      weekId: "2099-07-06",
    });
    expect(legal.direction).toEqual({ source: "coach", degraded: false, reason: null });
    expect(goalTableErrors(legal.plan.goal_table ?? null, month)).toEqual([]);
    const framed = buildMonthFrame(month);
    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    expect(tableFromCells(framed.frame, legalMonthlyCellJson(month)).ok).toBe(true);

    let calls = 0;
    const broken = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl: async () => {
        calls += 1;
        return chat({});
      },
      timeoutMs: 1000,
      runId: "frame-empty",
      weekId: "2099-07-06",
    });
    expect(calls).toBe(2);
    expect(broken.direction.degraded).toBe(true);
    expect(broken.plan.source).toBe("deterministic");
  });

  it("60자를 넘긴 목적은 그 날만 다시 묻고 통째로 다시 묻지 않는다", async () => {
    const month = month531();
    const legal = legalMonthlyCellJson(month);
    const trainingKey = Object.keys(legal.days).find((key) => legal.days[key]?.choice);
    expect(trainingKey).toBeTruthy();
    if (!trainingKey) return;
    const long = structuredClone(legal);
    long.days[trainingKey] = { ...long.days[trainingKey]!, purpose: "x".repeat(61) };
    const users: string[] = [];
    let calls = 0;
    const fixed = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl: async (_url, init) => {
        calls += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
        users.push(body.messages?.[1]?.content ?? "");
        if (calls === 1) return chat(long);
        return chat({ days: { [trainingKey]: { choice: legal.days[trainingKey]!.choice, purpose: "Train this date at the listed target." } } });
      },
      timeoutMs: 1000,
      runId: "frame-purpose",
      weekId: "2099-07-06",
    });
    expect(calls).toBe(2);
    expect(users[1]).toContain("Rewrite only the listed days");
    expect(users[0]).not.toContain("Rewrite only the listed days");
    expect(fixed.direction).toEqual({ source: "coach", degraded: false, reason: null });
    expect(goalTableErrors(fixed.plan.goal_table ?? null, month)).toEqual([]);

    calls = 0;
    const still = await coachMonthly({
      month,
      key: "sk-test",
      fetchImpl: async () => {
        calls += 1;
        return chat(calls === 1 ? long : { days: { [trainingKey]: { choice: legal.days[trainingKey]!.choice, purpose: "y".repeat(61) } } });
      },
      timeoutMs: 1000,
      runId: "frame-purpose-again",
      weekId: "2099-07-06",
    });
    expect(calls).toBe(2);
    expect(still.direction.degraded).toBe(true);
    expect(still.plan.source).toBe("deterministic");
  });
});

describe("헤드 note_ko", () => {
  it("스키마에서 수정 값보다 앞이고 10자 미만은 실패다", () => {
    expect(HEAD_COACH_PROMPT_VERSION).toBe("head-coach-v10");
    const schema = headReviewFormat(["air_squat"]) as { json_schema: { schema: { properties: Record<string, { minLength?: number }>; required: string[] } } };
    const keys = Object.keys(schema.json_schema.schema.properties);
    expect(keys[0]).toBe("note_ko");
    expect(keys.indexOf("note_ko")).toBeLessThan(keys.indexOf("revisions"));
    expect(schema.json_schema.schema.properties.note_ko?.minLength).toBe(10);
    expect(schema.json_schema.schema.required[0]).toBe("note_ko");
    expect(headReviewErrors({ status: "APPROVE", note_ko: "", revisions: [], adjustments: [] }).join(" ")).toMatch(/note_ko/);
    expect(headReviewErrors({ status: "APPROVE", note_ko: "짧다", revisions: [], adjustments: [] }).join(" ")).toMatch(/10/);
    expect(headReviewErrors({ status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [], adjustments: [] })).toEqual([]);
    expect(parseHeadReview({ status: "APPROVE", note_ko: "", revisions: [] })).toBeNull();
    const pass = runAdjustmentPass({
      sessions: [],
      review: { status: "APPROVE_WITH_NOTE", note_ko: "" },
    });
    expect(pass.note).toBe("");
    expect(coachSystemPrompt("head")).not.toContain("for example");
  });
});
