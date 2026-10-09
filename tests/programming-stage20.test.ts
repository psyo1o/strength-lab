import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ensureProgrammingMonth, evaluateProgrammingMonth, readOnlyMonthSummary } from "../src/lib/programming/engine";
import { fallbackMonth } from "../src/lib/programming/fallback";
import { authorMonth, evaluationStatus, monthPrompt } from "../src/lib/programming/model";
import { planLongitudinal } from "../src/lib/programming/planning/plan";
import { englishKoPath, koreanRatio, repairMonthLanguage } from "../src/lib/programming/rules";
import type { WeekActual } from "../src/lib/programming/summary";
import type { MonthDirection } from "../src/lib/programming/types";

const KEY = "sk-stage20-test-key";
const NOW = Date.parse("2099-06-02T01:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage20-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function methodMonth(method: "ACCUMULATION" | "INTENSITY_BLOCK" | "DELOAD_RECOVERY"): MonthDirection {
  const scheme = method === "ACCUMULATION" ? "volume" : method === "INTENSITY_BLOCK" ? "intensity" : "deload";
  return fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: scheme, strength_method: method });
}

function withMethodTokens(month: MonthDirection): MonthDirection {
  return {
    ...month,
    focus_ko: "이번 달은 variation을 줄이고 축적을 유지합니다.",
    why_ko: "ACCUMULATION 블록입니다. engine과 high_rep, technical 노출을 방법 안에서 유지합니다.",
    week_themes: month.week_themes.map((theme, index) => ({
      ...theme,
      theme_ko:
        index === 0
          ? "ACCUMULATION 적응 주입니다. 볼륨으로 엽니다."
          : index === 1
            ? "EMOM interval로 긴 컨디셔닝을 하루만 둡니다."
            : theme.theme_ko,
    })),
  };
}

function highFatigue(): WeekActual {
  return {
    note_ko: "프로브 수행",
    days: [{ day: "mon", completed: true, result_ko: "완료", fatigue: "high" }],
    class_summary: {
      completed_days: 6,
      missed_days: 0,
      scaling_mix: { rx: 6, scaled: 0, beginner: 0 },
      actual_volume: "moderate",
      actual_intensity: "heavy",
      fatigue_signal: "high",
      plan_vs_actual: "계획과 맞습니다.",
      admin_modified_days: 0,
      benchmark_days: 0,
    },
  };
}

function promptBody(fetchImpl: ReturnType<typeof vi.fn>): { evaluation_status: string; summary: { progression: { last_evaluation: { summary_ko: string } | null } } } {
  const request = JSON.parse(String((fetchImpl.mock.calls.at(-1)?.[1] as RequestInit).body)) as {
    messages: Array<{ content: string }>;
  };
  return JSON.parse(request.messages[1]!.content) as {
    evaluation_status: string;
    summary: { progression: { last_evaluation: { summary_ko: string } | null } };
  };
}

describe("stage20 monthly direction and weekly ceilings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps a parsed month when the only failure is method tokens in Korean fields", async () => {
    freshDb();
    const dirty = withMethodTokens(methodMonth("ACCUMULATION"));
    expect(koreanRatio(dirty.why_ko)).toBeLessThan(0.7);
    expect(englishKoPath(dirty)).toBeTruthy();
    const repaired = repairMonthLanguage(dirty);
    expect(repaired.normalizations.length).toBeGreaterThan(0);
    expect(englishKoPath(repaired.direction)).toBeNull();
    expect(repaired.direction.scheme).toBe("volume");
    expect(repaired.direction.strength_method).toBe("ACCUMULATION");
    expect(repairMonthLanguage(dirty)).toEqual(repaired);

    const authored = await authorMonth({
      summary: readOnlyMonthSummary("2099-06-01"),
      key: KEY,
      fetchImpl: async () => envelope(dirty),
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.direction.strength_method).toBe("ACCUMULATION");
    expect(authored.direction.scheme).toBe("volume");
    expect(authored.direction.why_ko).not.toContain("ACCUMULATION");
    expect(authored.trace.normalizations.length).toBeGreaterThan(0);

    const english = { ...methodMonth("ACCUMULATION"), focus_ko: "Build a stronger class this month" };
    const rejected = await authorMonth({
      summary: readOnlyMonthSummary("2099-06-01"),
      key: KEY,
      fetchImpl: async () => envelope(english),
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.reason).toBe("language");
  });

  it("names a missing evaluation and does not store that absence as a recovery month", async () => {
    freshDb();
    const open = monthPrompt(readOnlyMonthSummary("2099-06-01")) as { evaluation_status: string; block_rule: string };
    expect(evaluationStatus(readOnlyMonthSummary("2099-06-01"))).toBe("no_previous_month");
    expect(open.evaluation_status).toBe("no_previous_month");
    expect(open.block_rule).toContain("not the default");

    const fetchImpl = vi.fn(async () => envelope(withMethodTokens(methodMonth("ACCUMULATION"))));
    const june = await ensureProgrammingMonth("2099-06-01", { nowMs: NOW, key: KEY, fetchImpl });
    expect(june.generationSource).toBe("model");
    expect(june.direction.scheme).toBe("volume");
    expect(june.direction.strength_method).toBe("ACCUMULATION");
    expect(june.direction.why_ko).not.toContain("이전 월 평가가 없습니다");
    expect(june.priorEvaluationId).toBeNull();

    fetchImpl.mockImplementation(async () => envelope(withMethodTokens(methodMonth("INTENSITY_BLOCK"))));
    const july = await ensureProgrammingMonth("2099-07-01", { nowMs: NOW + 1, key: KEY, fetchImpl });
    expect(evaluationStatus(readOnlyMonthSummary("2099-07-01"))).toBe("no_evaluation");
    const julyPrompt = promptBody(fetchImpl);
    expect(julyPrompt.evaluation_status).toBe("no_evaluation");
    expect(JSON.stringify(julyPrompt)).toContain("not a reason to choose DELOAD_RECOVERY");
    expect(july.generationSource).toBe("model");
    expect(july.direction.strength_method).toBe("INTENSITY_BLOCK");
    expect(july.direction.scheme).not.toBe("deload");
    expect(july.priorEvaluationId).toBeNull();

    const evaluation = evaluateProgrammingMonth("2099-07-01", NOW + 2);
    if ("error" in evaluation) throw new Error(evaluation.error);
    expect(evaluation.fatigue).toBe("기록 없음");
    expect(evaluation.fatigue).not.toContain("high");

    fetchImpl.mockImplementation(async () => envelope(withMethodTokens(methodMonth("ACCUMULATION"))));
    const august = await ensureProgrammingMonth("2099-08-01", { nowMs: NOW + 3, key: KEY, fetchImpl });
    expect(evaluationStatus(readOnlyMonthSummary("2099-08-01"))).toBe("present");
    const augustPrompt = promptBody(fetchImpl);
    expect(augustPrompt.evaluation_status).toBe("present");
    expect(augustPrompt.summary.progression.last_evaluation?.summary_ko).toBe(evaluation.summary_ko);
    expect(august.priorEvaluationId).toBe(evaluation.id);
    expect(august.generationSource).toBe("model");
    expect(august.direction.strength_method).toBe("ACCUMULATION");
    expect(august.direction.scheme).toBe("volume");

    expect(fallbackMonth(null).strength_method).toBe("DELOAD_RECOVERY");
    expect(fallbackMonth(null).scheme).toBe("deload");
  });

  it("passes each weekly thesis ceiling into the skeleton", async () => {
    const accumulation = methodMonth("ACCUMULATION");
    const week1 = await planLongitudinal({ month: accumulation, weekIndex: 1 });
    const week2 = await planLongitudinal({ month: accumulation, weekIndex: 2 });
    const week4 = await planLongitudinal({ month: accumulation, weekIndex: 4 });
    const emphasis = await planLongitudinal({ month: accumulation, weekIndex: 2, previousActual: highFatigue() });
    const recovery = methodMonth("DELOAD_RECOVERY");
    const deloadWeeks = await Promise.all(
      ([1, 2, 3, 4] as const).map((weekIndex) => planLongitudinal({ month: recovery, weekIndex })),
    );

    expect(week1.weekly_thesis.week_phase).toBe("accumulation");
    expect(week1.weekly_thesis.volume_ceiling).toBe("high");
    expect(week1.weekly_thesis.conditioning_intensity_ceiling).toBe("heavy");
    expect(week1.weekly_thesis.strength_intensity_ceiling).toBe("heavy");

    expect(week2.weekly_thesis.week_phase).toBe("progression");
    expect(week2.weekly_thesis.volume_ceiling).toBe("high");

    expect(week4.weekly_thesis.week_phase).toBe("DELOAD");
    expect(week4.weekly_thesis.strength_intensity_ceiling).toBe("light");
    expect(week4.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
    expect(week4.weekly_thesis.volume_ceiling).toBe("moderate");
    expect(week4.skeleton.days.filter((day) => day.status === "training").every((day) => day.conditioning.intensity_class !== "heavy")).toBe(true);
    expect(week4.skeleton.days.filter((day) => day.status === "training").every((day) => day.prohibited_patterns.includes("heavy_conditioning"))).toBe(true);

    expect(emphasis.weekly_thesis.week_phase).toBe("emphasis");
    expect(emphasis.weekly_thesis.volume_ceiling).toBe("low");
    expect(emphasis.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
    expect(emphasis.weekly_thesis.strength_intensity_ceiling).toBe("heavy");
    expect(emphasis.skeleton.days.every((day) => day.volume_profile !== "high")).toBe(true);

    for (const planned of deloadWeeks) {
      expect(planned.weekly_thesis.week_phase).toBe("DELOAD");
      expect(planned.weekly_thesis.strength_intensity_ceiling).toBe("light");
      expect(planned.weekly_thesis.conditioning_intensity_ceiling).toBe("moderate");
      expect(planned.weekly_thesis.volume_ceiling).toBe("moderate");
    }
  });
});
