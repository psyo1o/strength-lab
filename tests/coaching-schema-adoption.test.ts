import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../src/lib/db/client";
import type { DayKey } from "../src/lib/month-plan/types";
import { deterministicMonthlyPlan } from "../src/lib/programming/coaching/monthly";
import { assembleLegalWeek } from "../src/lib/programming/coaching/session";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { STAGE16_PIPELINE_VERSION } from "../src/lib/programming/coaching/prompts";
import { ensureProgrammingWeek } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { timeDomainFromMinutes } from "../src/lib/programming/coaching/canonical";
import { judgeWeek, similarityScore } from "../src/lib/programming/rules";
import { getProgrammingMonth, listRecentStructures } from "../src/lib/programming/store";
import { SIMILARITY_CONFIG, monthStartOf, weekIndexFromStart, type WeekIndex } from "../src/lib/programming/types";

const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const KEY = "sk-schema-test";
const WEEK = "2099-07-06";
const NEXT = "2099-07-13";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-schema-adopt-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.STRENGTH_LAB_PROBE;
  resetDbConnection();
}

function chat(content: unknown, status = 200) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function specialistFetch(input: { alignDay?: { day: DayKey; format: string; duration_min: number; stimulus: string; equipment: string[]; volume: string; intensity: string } | null }) {
  return async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const user = JSON.parse(body.messages?.find((message) => message.role === "user")?.content ?? "{}") as Record<string, unknown>;
    const agent = typeof user.agent_name === "string" ? user.agent_name : "";
    const month = getProgrammingMonth(monthStartOf(WEEK))?.direction ?? fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
    const weekIndex = (typeof user.week_index === "number" ? user.week_index : weekIndexFromStart(NEXT)) as WeekIndex;
    const plan = planCoachedWeek({ month, weekIndex });
    if (agent === "monthly_coach") {
      const monthly = deterministicMonthlyPlan(month);
      return chat({ ...monthly, fatigue_tolerance: "moderate", variety_requirement: "moderate" });
    }
    if (agent === "weekly_coach") {
      return chat({
        block_phase: plan.block_phase,
        emphasis: plan.emphasis,
        why_ko: plan.why_ko,
        focus: plan.focus,
        scheme_note: plan.scheme_note,
        adjustment_ko: plan.adjustment_ko,
        days: plan.days,
      });
    }
    const day = String((user.day_intent as { day?: string } | undefined)?.day ?? "");
    const built = assembleLegalWeek({ month, weekIndex, plan });
    const session = built.draft.sessions.find((row) => row.day === day);
    if (agent === "strength_coach") return chat({ day, strength_note_ko: "이 날의 스트렝스 목적을 유지합니다." });
    if (agent === "warmup_coach") return chat({ day, warmup_ko: day === input.alignDay?.day ? "유사복사토큰 준비 동작을 먼저 합니다." : `모델 ${day} 준비 동작을 먼저 합니다.` });
    if (agent === "conditioning_coach") {
      const piece = session?.conditioning;
      if (!piece) return chat({ day, notes_ko: "휴식", conditioning: null });
      const aligned = input.alignDay && day === input.alignDay.day ? input.alignDay : null;
      // sessionFromCoachJson stamps movement_pattern from the day intent, so mixed days share one pattern.
      // A 10 minute Tuesday is a different time domain from the other mixed days and stays under threshold 4.
      const duration_min = aligned?.duration_min ?? (day === "tue" ? 10 : piece.duration_min);
      return chat({
        day,
        notes_ko: "이 날의 컨디셔닝 목적을 유지합니다.",
        conditioning: {
          format: aligned?.format ?? piece.format,
          duration_min,
          stimulus: aligned?.stimulus ?? piece.stimulus,
          movements: piece.movements,
          equipment: aligned?.equipment ?? piece.equipment,
          volume: aligned?.volume ?? piece.volume,
          intensity: aligned?.intensity ?? piece.intensity,
          interval_work_sec: (aligned?.format ?? piece.format) === "intervals" ? 30 : null,
          interval_rest_sec: (aligned?.format ?? piece.format) === "intervals" ? 30 : null,
        },
      });
    }
    if (agent === "load_coach") {
      return chat({
        decisions: plan.days
          .filter((row) => row.primary_training !== "rest")
          .map((row) => ({ day: row.day, action: "hold", reason_ko: "방법 표를 유지합니다.", target_effort: "moderate", relative_intensity: "same" })),
      });
    }
    return chat({ status: "APPROVE", note_ko: "이번 주는 유지합니다.", revisions: [], adjustments: [] });
  };
}

describe("coaching schema adoption", () => {
  beforeEach(() => freshDb());

  it("adopts a week built from specialist schemas", async () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const { ensureProgrammingMonth } = await import("../src/lib/programming/engine");
    await ensureProgrammingMonth(monthStartOf(WEEK), { nowMs: NOW, key: null });
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW + 1, key: KEY, fetchImpl: specialistFetch({ alignDay: null }) });
    expect(saved.generationSource).toBe("model");
    expect(saved.fallbackReason).toBeNull();
    expect(saved.promptVersion).toBe(STAGE16_PIPELINE_VERSION);
    expect(saved.draft.sessions.some((session) => session.warmup_ko.includes("모델"))).toBe(true);
  });

  it("stores too_similar when a specialist copies a recent structure", async () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const recent = listRecentStructures(NEXT);
    const prior = recent.find((row) => !row.benchmark && !row.long_conditioning && row.time_domain !== "long" && row.duration_min >= 8 && row.duration_min <= 20);
    expect(prior).toBeTruthy();
    if (!prior) return;
    const month = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
    const plan = planCoachedWeek({ month, weekIndex: weekIndexFromStart(NEXT) });
    const built = assembleLegalWeek({ month, weekIndex: weekIndexFromStart(NEXT), plan });
    const host = built.draft.sessions.find((session) => session.conditioning && !session.conditioning.long_conditioning && session.day !== "sun");
    expect(host).toBeTruthy();
    if (!host) return;
    const saved = await ensureProgrammingWeek(NEXT, {
      nowMs: NOW + 2,
      key: KEY,
      fetchImpl: specialistFetch({
        alignDay: {
          day: host.day,
          format: prior.format,
          duration_min: prior.duration_min,
          stimulus: prior.stimulus ?? host.conditioning?.stimulus ?? "high_rep",
          equipment: [...prior.equipment],
          volume: prior.volume,
          intensity: prior.intensity,
        },
      }),
    });
    const storedMonth = getProgrammingMonth(monthStartOf(NEXT))?.direction ?? month;
    const intent = planCoachedWeek({ month: storedMonth, weekIndex: weekIndexFromStart(NEXT) }).days.find((row) => row.day === host.day);
    const pattern =
      !intent || intent.movement_pattern === "mixed" || intent.movement_pattern === "none" ? "engine" : intent.movement_pattern;
    const copiedScore = similarityScore(
      { ...prior, day: host.day, movement_patterns: [pattern], time_domain: timeDomainFromMinutes(prior.duration_min) },
      prior,
    );
    expect(copiedScore).toBeGreaterThanOrEqual(SIMILARITY_CONFIG.threshold);
    const judged = judgeWeek(saved.draft, storedMonth, weekIndexFromStart(NEXT), recent);
    expect(saved.generationSource).toBe("fallback");
    expect(saved.fallbackReason).toBe("too_similar");
    expect(saved.promptVersion).toBe(STAGE16_PIPELINE_VERSION);
    expect(saved.draft.sessions.some((session) => session.warmup_ko.includes("유사복사토큰"))).toBe(false);
    expect(judged.ok).toBe(true);
  });
});
