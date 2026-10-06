import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { dryRunMonth, dryRunWeek, presetActual, runFallbackTest } from "../src/lib/programming/admin-tools";
import {
  ensureProgrammingMonth,
  ensureProgrammingWeek,
  readOnlyWeekSummary,
  regenerateProgrammingWeek,
} from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { weekPrompt } from "../src/lib/programming/model";
import {
  constitutionViolations,
  judgeWeek,
  similarityScore,
  similarityViolations,
  structurallySimilar,
  toStructure,
} from "../src/lib/programming/rules";
import { refreshSessionFields } from "../src/lib/programming/session-fields";
import { listProgrammingWeekAttempts } from "../src/lib/programming/store";
import {
  RULES_VERSION,
  SIMILARITY_CONFIG,
  WEEKLY_PROMPT_VERSION,
  type Equipment,
  type MonthDirection,
  type MovementPattern,
  type SessionDraft,
  type StoredStructure,
  type WeekDraft,
  type WeekIndex,
  type WodFormat,
} from "../src/lib/programming/types";

const KEY = "sk-test-not-a-real-key";
const LIVE_KEY = "sk-stage3-live-key-do-not-leak";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";
const MONTH = "2026-10-01";
const TABLES = [
  "programming_weeks",
  "programming_months",
  "programming_actuals",
  "programming_syncs",
  "programming_generation_logs",
  "programming_evaluations",
  "programming_month_proposals",
  "class_weeks",
  "class_day_scores",
] as const;

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage3-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function counts(): Record<string, number> {
  const db = getSqlite();
  const out: Record<string, number> = {};
  for (const table of TABLES) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
  }
  return out;
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function intent(month: MonthDirection) {
  return fallbackIntent(month, 1, "stage3");
}

function weekFor(month: MonthDirection, weekIndex: WeekIndex, actual: "a" | "b" | null = null): WeekDraft {
  return buildFallbackWeek({
    month,
    weekIndex,
    intent: fallbackIntent(month, weekIndex, "stage3"),
    previousActual: actual ? presetActual(actual) : null,
  });
}

function liftsOf(draft: WeekDraft): string {
  return draft.sessions
    .filter((session) => session.strength)
    .map((session) => `${session.day}:${session.strength?.lift}`)
    .join(" ");
}

function training(draft: WeekDraft): SessionDraft[] {
  return draft.sessions.filter((session) => !session.rest);
}

describe("stage 3 fallback, similarity, and dry run", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("test 6 fails similarity when a structure is a near copy", () => {
    const month = fallbackMonth(null);
    const draft = weekFor(month, 1);
    const source = training(draft).find((session) => session.conditioning && !session.conditioning.benchmark);
    if (!source?.conditioning) throw new Error("training day missing");
    const recent: StoredStructure = { ...toStructure(source)!, day: "sun" };
    expect(similarityScore(toStructure(source)!, recent)).toBeGreaterThanOrEqual(SIMILARITY_CONFIG.threshold);
    expect(structurallySimilar(toStructure(source)!, recent)).toBe(true);
    expect(judgeWeek(draft, month, 1, [recent])).toMatchObject({ ok: false, reason: "too_similar" });
  });

  it("test 7 passes similarity when the movement stays and the structure and purpose change", () => {
    const month = fallbackMonth(null);
    const draft = weekFor(month, 1);
    const original = draft.sessions.find((row) => row.day === "wed" && row.conditioning);
    if (!original?.conditioning) throw new Error("wednesday missing");
    const before = toStructure(original)!;
    const names = original.conditioning.movements.map((movement) => movement.name_ko);
    const formats: WodFormat[] = ["amrap", "for_time", "emom", "intervals"];
    const patterns: MovementPattern[] = ["press", "pull", "olympic", "engine", "gymnastic"];
    const gear: Equipment[] = ["rower", "ski", "bike", "jump_rope", "kettlebell", "rings"];
    let placed = false;
    for (const format of formats) {
      for (const pattern of patterns) {
        for (const equipment of gear) {
          const current = draft.sessions.find((row) => row.day === "wed");
          if (!current?.conditioning) throw new Error("wednesday missing");
          current.conditioning = {
            ...current.conditioning,
            format,
            time_domain: "short",
            stimulus: before.stimulus,
            movement_patterns: [pattern],
            equipment: [equipment],
            duration_min: 10,
            volume: "low",
            intensity: before.stimulus === "heavy" ? "heavy" : before.stimulus === "technical" ? "light" : "moderate",
            long_conditioning: false,
            benchmark: false,
          };
          draft.sessions = refreshSessionFields(draft.sessions);
          const candidate = draft.sessions.find((row) => row.day === "wed");
          if (!candidate) continue;
          candidate.metcon_purpose = "같은 동작이지만 목적과 구조가 다릅니다.";
          const after = toStructure(candidate);
          if (!after || structurallySimilar(before, after)) continue;
          if (similarityViolations(draft, [before]).length === 0) {
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (placed) break;
    }
    expect(placed).toBe(true);
    const updated = draft.sessions.find((row) => row.day === "wed");
    if (!updated?.conditioning) throw new Error("wednesday missing after refresh");
    expect(updated.conditioning.movements.map((movement) => movement.name_ko)).toEqual(names);
    expect(updated.metcon_purpose).toBe("같은 동작이지만 목적과 구조가 다릅니다.");
    expect(structurallySimilar(before, toStructure(updated)!)).toBe(false);
    expect(similarityViolations(draft, [before])).toEqual([]);
    const judged = judgeWeek(draft, month, 1, [before]);
    expect(judged.ok ? null : judged.reason).not.toBe("too_similar");
    expect(judged.ok).toBe(true);
  });

  it("test 8 passes a repeated benchmark", () => {
    const month = fallbackMonth(null);
    const draft = weekFor(month, 4);
    const benchmark = draft.sessions.find((session) => session.conditioning?.benchmark);
    if (!benchmark?.conditioning) throw new Error("benchmark missing");
    const measurement = toStructure(benchmark)!;
    const sameFeatures: StoredStructure = { ...measurement, day: "mon", benchmark: false };
    expect(similarityScore(measurement, sameFeatures)).toBeGreaterThanOrEqual(SIMILARITY_CONFIG.threshold);
    expect(structurallySimilar(measurement, sameFeatures)).toBe(false);
    const repeatedBenchmark: StoredStructure = { ...measurement, day: "thu" };
    expect(similarityViolations(draft, [repeatedBenchmark])).toEqual([]);
    expect(judgeWeek(draft, month, 4, [repeatedBenchmark]).ok).toBe(true);
  });

  it("test 9 retries a forced api failure and stores a fallback week", async () => {
    await ensureProgrammingMonth(MONTH, { nowMs: NOW, key: null });
    process.env.MONTH_PLAN_MODEL_KEY = LIVE_KEY;
    const fetchImpl = vi.fn(async () => new Response("forced-failure", { status: 500 }));
    const week = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const header = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(header.Authorization).toBe(`Bearer ${KEY}`);
    expect(header.Authorization).not.toContain(LIVE_KEY);
    expect(week).toMatchObject({
      generationSource: "fallback",
      fallbackReason: "http_error",
      rulesVersion: RULES_VERSION,
      promptVersion: WEEKLY_PROMPT_VERSION,
      generationAttempt: 2,
      generatedAt: NOW,
    });
    expect(RULES_VERSION).toBe("programming-3");
    expect(WEEKLY_PROMPT_VERSION).toBe("weekly-program-v4");
    const nextFetch = vi.fn(async () => new Response("still-down", { status: 500 }));
    await ensureProgrammingWeek("2026-10-12", { nowMs: NOW + 5, key: KEY, fetchImpl: nextFetch });
    const init = nextFetch.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(JSON.parse(String(init.body)).messages[1].content) as {
      previous_generation_source: string;
      summary: { previous_week: { generation_source: string } };
    };
    expect(sent.previous_generation_source).toBe("fallback");
    expect(sent.summary.previous_week.generation_source).toBe("fallback");
  });

  it("test 12 keeps a single active row when the same week is generated twice", async () => {
    const first = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const second = await ensureProgrammingWeek(WEEK, { nowMs: NOW + 1, key: null });
    expect(second.id).toBe(first.id);
    expect(listProgrammingWeekAttempts(WEEK).filter((row) => row.status === "active")).toHaveLength(1);

    const replaced = await regenerateProgrammingWeek(WEEK, { nowMs: NOW + 2, key: null });
    const attempts = listProgrammingWeekAttempts(WEEK);
    expect(replaced.id).not.toBe(first.id);
    expect(attempts.filter((row) => row.status === "active")).toHaveLength(1);
    expect(attempts.find((row) => row.id === first.id)?.status).toBe("superseded");
  });

  it("fallback does not use the fixed weekday lift map and follows the month block", () => {
    const classic = "mon:squat tue:ohp thu:bench fri:deadlift";
    const month = fallbackMonth(null);
    expect(month.scheme).toBe("531");
    const maps = ([1, 2, 3, 4] as WeekIndex[]).map((weekIndex) => liftsOf(weekFor(month, weekIndex)));
    expect(maps).not.toContain(classic);
    expect(new Set(maps).size).toBeGreaterThan(1);
    const week = weekFor(month, 1);
    expect(week.sessions.some((session) => session.strength?.sets.some((set) => set.percent_of_tm >= 85))).toBe(true);
    expect(week.intent.scheme_note).toContain(month.primary_block);
    expect(constitutionViolations(week, month, 1)).toEqual([]);

    const volume = fallbackMonth({ summary_ko: "볼륨 블록", next_scheme: "volume" });
    const volumeWeek = weekFor(volume, 1);
    expect(liftsOf(volumeWeek)).not.toBe(liftsOf(week));
    expect(volumeWeek.sessions.some((session) => session.strength?.sets.every((set) => set.percent_of_tm === 70))).toBe(true);
    expect(volumeWeek.sessions.some((session) => session.strength?.sets.some((set) => set.percent_of_tm >= 85))).toBe(false);
    expect(volumeWeek.intent.scheme_note).toContain(volume.primary_block);
    expect(constitutionViolations(volumeWeek, volume, 1)).toEqual([]);
  });

  it("fallback follows fatigue, duration, warmup, and recent-structure rules", () => {
    const month = fallbackMonth(null);
    const high = weekFor(month, 1, "a");
    const low = weekFor(month, 1, "b");
    expect(JSON.stringify(high)).not.toBe(JSON.stringify(low));
    for (const session of high.sessions) {
      if (session.strength?.lift === "squat" || session.strength?.lift === "deadlift") {
        expect(session.day === "mon" || session.day === "tue").toBe(false);
        expect(session.strength_volume).toBe("low");
      }
      if (session.day === "mon" || session.day === "tue") {
        expect(session.conditioning?.movement_patterns.some((pattern) => pattern === "squat" || pattern === "hinge")).toBe(false);
      }
    }
    expect(high.intent.scheme_note).toContain("하체");
    const lowSquat = low.sessions.find((session) => session.strength?.lift === "squat");
    const highSquat = high.sessions.find((session) => session.strength?.lift === "squat");
    expect(lowSquat?.day === highSquat?.day && lowSquat?.strength_volume === highSquat?.strength_volume).toBe(false);

    for (const weekIndex of [1, 2, 3, 4] as WeekIndex[]) {
      for (const actual of ["a", "b"] as const) {
        const draft = weekFor(month, weekIndex, actual);
        expect(constitutionViolations(draft, month, weekIndex)).toEqual([]);
        expect(JSON.stringify(draft)).toBe(JSON.stringify(weekFor(month, weekIndex, actual)));
        const order = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;
        const lowerDays = new Set(
          draft.sessions.filter((session) => session.strength?.lift === "squat" || session.strength?.lift === "deadlift").map((session) => session.day),
        );
        for (const session of training(draft)) {
          expect(session.warmup_min).toBeGreaterThanOrEqual(8);
          expect(session.warmup_min).toBeLessThanOrEqual(12);
          expect(session.metcon_purpose).toBeTruthy();
          expect(session.metcon_format).toBe(session.conditioning?.format);
          expect(session.expected_duration).toBe(session.conditioning?.duration_min);
          expect(session.equipment.length).toBeGreaterThan(0);
          const minutes = session.conditioning?.duration_min ?? 0;
          const index = order.indexOf(session.day as (typeof order)[number]);
          const previousDay = index > 0 ? order[index - 1] : null;
          const afterLower = previousDay ? lowerDays.has(previousDay) : false;
          if (session.conditioning?.long_conditioning) {
            expect(minutes).toBeGreaterThanOrEqual(30);
            expect(minutes).toBeLessThanOrEqual(40);
            expect(session.day).not.toBe("wed");
            expect(lowerDays.has(session.day)).toBe(false);
          } else if (session.conditioning?.benchmark) {
            expect(session.day).not.toBe("thu");
          } else if (afterLower) {
            expect(minutes).toBeGreaterThanOrEqual(8);
            expect(minutes).toBeLessThanOrEqual(12);
          } else {
            expect(minutes).toBeGreaterThanOrEqual(12);
            expect(minutes).toBeLessThanOrEqual(20);
          }
        }
      }
    }
    const longWeeks = ([2, 4] as WeekIndex[]).map((weekIndex) => weekFor(month, weekIndex).sessions.find((session) => session.conditioning?.long_conditioning)?.day);
    expect(longWeeks.every((day) => day && day !== "wed")).toBe(true);

    const first = weekFor(month, 1);
    const source = training(first).find((session) => session.conditioning && !session.conditioning.long_conditioning && !session.conditioning.benchmark);
    if (!source) throw new Error("source day missing");
    const recent = [toStructure(source)!];
    const again = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: intent(month),
      recent,
    });
    const rebuilt = again.sessions.find((session) => session.day === source.day);
    expect(structurallySimilar(toStructure(source)!, toStructure(rebuilt!)!)).toBe(false);
    expect(constitutionViolations(again, month, 1)).toEqual([]);
  });

  it("fills the weekly prompt and saved fallback sessions with the session fields", async () => {
    const month = fallbackMonth(null);
    const prompt = weekPrompt({
      summary: readOnlyWeekSummary(WEEK),
      month,
      weekIndex: 1,
    }) as { prompt_version: string; session_shape: Record<string, unknown> };
    expect(prompt.prompt_version).toBe("weekly-program-v4");
    for (const field of [
      "strength_purpose",
      "strength_volume",
      "strength_intensity",
      "metcon_purpose",
      "metcon_format",
      "time_domain",
      "stimulus",
      "movement_combination",
      "equipment",
      "volume",
      "intensity",
      "expected_duration",
    ]) {
      expect(prompt.session_shape).toHaveProperty(field);
    }
    const saved = await ensureProgrammingWeek(WEEK, { nowMs: NOW, key: null });
    const work = saved.draft.sessions.find((session) => session.strength && session.conditioning);
    const rest = saved.draft.sessions.find((session) => session.rest);
    if (!work || !rest) throw new Error("session missing");
    expect(work.strength_purpose).toBeTruthy();
    expect(work.strength_volume).toBeTruthy();
    expect(work.strength_intensity).toBeTruthy();
    expect(work.metcon_purpose).toBeTruthy();
    expect(work.movement_combination).toBeTruthy();
    expect(rest.strength_purpose).toBeNull();
    expect(rest.metcon_purpose).toBeNull();
    expect(rest.expected_duration).toBeNull();
    expect(rest.equipment).toEqual([]);
  });

  it("dry run returns the model trail and writes nothing", async () => {
    const before = counts();
    process.env.MONTH_PLAN_MODEL_KEY = LIVE_KEY;
    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    const high = await dryRunWeek({ nowMs: NOW, fetchImpl, actualCase: "a" });
    const header = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(header.Authorization).toBe(`Bearer ${LIVE_KEY}`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(high.wrote).toBe(false);
    expect(high.actual_case).toBe("a");
    expect(high.prompt_version).toBe("weekly-program-v4");
    expect(high).toHaveProperty("input");
    expect(high).toHaveProperty("ai_output");
    expect(high).toHaveProperty("validation");
    expect(high).toHaveProperty("similarity");
    expect(high).toHaveProperty("fallback");
    expect(JSON.stringify(high)).not.toContain(LIVE_KEY);

    const low = await dryRunWeek({ nowMs: NOW, key: null, actualCase: "b" });
    expect(low.wrote).toBe(false);
    expect(JSON.stringify(low.fallback)).not.toBe(JSON.stringify(high.fallback));
    const lowActual = (low.input as { summary: { previous_week: { actual: { class_summary: { fatigue_signal: string } } } } }).summary
      .previous_week.actual.class_summary.fatigue_signal;
    const highActual = (high.input as { summary: { previous_week: { actual: { class_summary: { fatigue_signal: string } } } } }).summary
      .previous_week.actual.class_summary.fatigue_signal;
    expect(highActual).toBe("high");
    expect(lowActual).toBe("low");

    const monthDraft = weekFor(fallbackMonth(null), 1);
    const accepted = await dryRunWeek({
      nowMs: NOW,
      key: KEY,
      actualCase: null,
      fetchImpl: vi.fn(async () => envelope(monthDraft)),
    });
    expect(accepted.wrote).toBe(false);
    expect(accepted.validation).toEqual({ ok: true, detail: null });
    expect(JSON.stringify(accepted)).not.toContain(KEY);
    expect(JSON.stringify(accepted)).not.toContain(LIVE_KEY);

    const month = await dryRunMonth({ nowMs: NOW, key: null });
    expect(month.wrote).toBe(false);
    expect(month.scope).toBe("month");
    expect(month).toHaveProperty("ai_output");
    expect(month).toHaveProperty("validation");
    expect(month).toHaveProperty("fallback");
    expect(counts()).toEqual(before);
  });

  it("fallback test forces failure without the live key and then saves a fallback week", async () => {
    await ensureProgrammingMonth(MONTH, { nowMs: NOW, key: null });
    process.env.MONTH_PLAN_MODEL_KEY = LIVE_KEY;
    const result = await runFallbackTest(NOW);
    expect(result).toMatchObject({
      wrote: true,
      week_start: WEEK,
      generation_source: "fallback",
      rules_version: "programming-3",
      generation_attempt: 2,
    });
    expect(JSON.stringify(result)).not.toContain(LIVE_KEY);
    const stored = getSqlite()
      .prepare("SELECT input_summary_json, fallback_reason, rules_version FROM programming_weeks WHERE status = 'active'")
      .all();
    const logs = getSqlite().prepare("SELECT raw_json FROM programming_generation_logs").all();
    const packed = JSON.stringify({ stored, logs });
    expect(packed).not.toContain(LIVE_KEY);
    expect(packed).not.toContain("fallback-test");
  });
});
