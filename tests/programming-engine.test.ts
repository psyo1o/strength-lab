import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { getUserMaxes, saveUserMaxes } from "../src/lib/maxes";
import { saveWodResult, listWodResults } from "../src/lib/wod/queries";
import { dayByKey } from "../src/lib/month-plan/build-week";
import { ensureClassWeek } from "../src/lib/month-plan/class-week";
import {
  ENGINE_VERSION,
  ensureProgrammingMonth,
  ensureProgrammingWeek,
  evaluateProgrammingMonth,
  recordWeeklyActual,
} from "../src/lib/programming/engine";
import { draftForScheme, extractDraft, fallbackIntent, fallbackMonth, rulesDisplayWeek } from "../src/lib/programming/fallback";
import { refreshSessionFields } from "../src/lib/programming/session-fields";
import { personalWodForMember } from "../src/lib/programming/personalization";
import { constitutionViolations, judgeWeek, structurallySimilar, toStructure } from "../src/lib/programming/rules";
import { getProgrammingMonth, getProgrammingWeek } from "../src/lib/programming/store";
import type { WeekDraft } from "../src/lib/programming/types";

const KEY = "sk-test-not-a-real-key";
const SECRET_EMAIL = "keep-me@example.com";
const SECRET_NOTE = "raw-score-note-should-not-travel";
const NOW = Date.parse("2026-09-07T01:00:00.000Z");
const WEEK1 = "2026-09-07";
const WEEK2 = "2026-09-14";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-program-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
}

function envelope(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function promptOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  const init = fetchImpl.mock.calls[call]?.[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body));
  return JSON.parse(body.messages[1].content) as Record<string, unknown>;
}

describe("long-term programming engine", () => {
  beforeEach(() => {
    freshDb();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("creates a month direction with no daily workouts", async () => {
    const month = await ensureProgrammingMonth("2026-09-01", { nowMs: NOW, key: null });
    expect(month.generationSource).toBe("fallback");
    expect(month.direction.scheme).toBe("deload");
    expect(month.direction.strength_method).toBe("DELOAD_RECOVERY");
    expect(month.direction.week_themes.map((theme) => theme.week_index)).toEqual([1, 2, 3, 4]);
    expect(month.direction.long_conditioning_weeks).toEqual([2, 4]);
    const raw = JSON.stringify(month.direction);
    expect(raw).not.toContain("sessions");
    expect(raw).not.toContain("candidate_id");
    expect(raw).not.toMatch(/\d+(\.\d+)?\s*kg/i);
  });

  it("creates week 1 as one shared class plan and keeps the 5/3/1 fallback on the screen", async () => {
    const week = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    expect(week.weekIndex).toBe(1);
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).toBe("no_model");
    expect(week.generatedAt).toBe(NOW);
    expect(week.engineVersion).toBe(ENGINE_VERSION);
    expect(week.intent.why_ko.length).toBeGreaterThan(10);
    expect(week.draft.sessions).toHaveLength(7);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM wod_structures").get()).toEqual({ c: 6 });
    const lifts = week.draft.sessions.filter((session) => session.strength).map((session) => `${session.day}:${session.strength?.lift}`);
    expect(lifts).not.toEqual(["mon:squat", "tue:ohp", "thu:bench", "fri:deadlift"]);
    expect(week.draft.sessions.some((session) => session.strength?.sets.some((set) => set.percent_of_tm === 85))).toBe(false);
    expect(week.draft.sessions.some((session) => session.strength?.sets.some((set) => set.percent_of_tm <= 70))).toBe(true);
    expect(JSON.stringify(week.display)).not.toMatch(/"weightKg":\s*\d/);

    const shared = await ensureClassWeek(NOW);
    expect(shared.weekStart).toBe(WEEK1);
    expect(getProgrammingWeek(WEEK1)?.classWeekId).toBe(shared.id);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 1 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM month_plans").get()).toEqual({ c: 0 });
    expect(personalWodForMember()).toBeNull();
  });

  it("saves the week 1 actual and sends that summary, not raw history, into week 2", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    saveWodResult(created.user.id, { templateSlug: "fran", tier: "rx", timeSec: 300, notesKo: SECRET_NOTE });
    getSqlite()
      .prepare(
        `INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (1, '2026-08-31', 'm', '{}', ?)`,
      )
      .run(NOW);
    const classWeekId = (
      getSqlite().prepare("SELECT id FROM class_weeks WHERE week_start = '2026-08-31'").get() as { id: number }
    ).id;
    getSqlite()
      .prepare(
        `INSERT INTO class_day_scores (
           user_id, class_week_id, day_key, completed_at, time_sec, rounds, extra_reps, notes_ko
         ) VALUES (?, ?, 'mon', ?, NULL, 4, 2, ?)`,
      )
      .run(created.user.id, classWeekId, NOW, SECRET_NOTE);

    const actual = recordWeeklyActual(
      WEEK1,
      {
        note_ko: "클래스 한 판",
        days: [{ day: "mon", completed: true, result_ko: "5라운드" }],
      },
      NOW + 1,
    );
    if ("error" in actual) throw new Error(actual.error);

    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    await ensureProgrammingWeek(WEEK2, { nowMs: NOW + 2, key: KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const sent = promptOf(fetchImpl, 0);
    const summary = sent.summary as {
      previous_week: {
        generation_source: string;
        actual: { days: { day: string; result_ko: string }[] };
      };
      personalization: null;
    };
    expect(summary.personalization).toBeNull();
    expect(summary.previous_week.actual.days[0]).toMatchObject({ day: "mon", result_ko: "5라운드" });
    const packed = JSON.stringify(fetchImpl.mock.calls.map((call) => String((call[1] as RequestInit).body)));
    expect(packed).not.toContain(SECRET_EMAIL);
    expect(packed).not.toContain(SECRET_NOTE);
    expect(packed).not.toContain('"candidate_id"');
    expect(sent.task).toBe("Return one weekly intent. Decide what each day trains. Do not write exercises, sets, reps, kilograms, or a WOD.");
    const wod = promptOf(fetchImpl, 2);
    expect(wod.task).toBe("Write the class week that realizes weekly_intent. The intent is already decided. Do not invent a new week purpose.");
    const wodSummary = wod.summary as { previous_week: { actual: { days: { day: string; result_ko: string }[] } } };
    expect(wodSummary.previous_week.actual.days[0]).toMatchObject({ day: "mon", result_ko: "5라운드" });
    expect(wod.weekly_intent).toBeTruthy();
  });

  it("treats several matching structural axes as a near-copy, and lets the same movement through", () => {
    const month = fallbackMonth(null);
    const draft = draftForScheme(month, 1, fallbackIntent(month, 1, "check"));
    const monday = toStructure(draft.sessions[0]!)!;
    const renamed = {
      ...monday,
      day: "fri" as const,
      movements: [{ key: "burpee", amount: "8", name_ko: "버피" }],
    };
    expect(structurallySimilar(monday, renamed)).toBe(true);
    const sameMovement = {
      ...monday,
      day: "fri" as const,
      format: "for_time" as const,
      time_domain: "medium" as const,
      stimulus: "technical" as const,
      equipment: ["rower" as const],
      volume: "high" as const,
    };
    expect(structurallySimilar(monday, sameMovement)).toBe(false);
    const benchmark = { ...renamed, benchmark: true };
    expect(structurallySimilar(monday, benchmark)).toBe(false);

    const copied = structuredClone(draft) as WeekDraft;
    const saturday = copied.sessions[5]!.conditioning!;
    copied.sessions[5]!.conditioning = {
      ...saturday,
      format: monday.format,
      time_domain: monday.time_domain,
      stimulus: saturday.stimulus,
      intensity: saturday.intensity,
      movement_patterns: [...monday.movement_patterns],
      equipment: [...monday.equipment],
      volume: monday.volume,
      duration_min: monday.duration_min,
      movements: renamed.movements,
      benchmark: false,
      long_conditioning: false,
    };
    copied.sessions = refreshSessionFields(copied.sessions);
    expect(judgeWeek(copied, month, 1, [monday]).ok).toBe(false);
    if (judgeWeek(copied, month, 1, [monday]).ok) return;
    expect(judgeWeek(copied, month, 1, [monday])).toMatchObject({ reason: "too_similar" });
  });

  it("stores an api failure as fallback and feeds that fallback to the next week", async () => {
    await ensureProgrammingMonth("2026-09-01", { nowMs: NOW, key: null });
    const fetchImpl = vi.fn(async () => new Response("no", { status: 429 }));
    const week = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(week.generationSource).toBe("fallback");
    expect(week.fallbackReason).toBe("http_error");
    expect(week.generatedAt).toBe(NOW);
    expect(week.engineVersion).toBe(ENGINE_VERSION);
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).not.toContain(KEY);

    recordWeeklyActual(WEEK1, { note_ko: "", days: [{ day: "fri", completed: true, result_ko: "12분" }] }, NOW);
    const nextFetch = vi.fn(async () => new Response("still-down", { status: 500 }));
    const second = await ensureProgrammingWeek(WEEK2, { nowMs: NOW + 5, key: KEY, fetchImpl: nextFetch });
    expect(nextFetch).toHaveBeenCalledTimes(4);
    expect(second.generationSource).toBe("fallback");
    const sent = promptOf(nextFetch);
    const previous = (sent.summary as { previous_week: Record<string, unknown> }).previous_week;
    expect(previous).toMatchObject({
      week_start: WEEK1,
      generation_source: "fallback",
      fallback_reason: "http_error",
      generated_at: NOW,
      engine_version: ENGINE_VERSION,
    });
    expect(JSON.stringify(previous)).toContain("12분");
  });

  it("keeps a model-written week instead of a catalog pick", async () => {
    const month = await ensureProgrammingMonth("2026-09-01", { nowMs: NOW, key: null });
    const draft = draftForScheme(month.direction, 1, {
      why_ko: "모델이 이번 주 클래스 한 판의 이유를 적습니다.",
      focus: "스키로 엔진을 엽니다",
      scheme_note: "531 세트를 이번 달 내내 유지합니다.",
    });
    const monday = draft.sessions[0]!.conditioning!;
    monday.movements = [{ key: "ski", amount: "200m", name_ko: "스키" }];
    monday.equipment = ["ski"];
    monday.movement_patterns = ["engine"];
    const fetchImpl = vi.fn(async () => envelope(draft));
    const week = await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: KEY, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(week.generationSource).toBe("model");
    expect(week.fallbackReason).toBeNull();
    expect(week.draft.sessions[0]?.conditioning?.movements[0]?.key).toBe("ski");
    expect(dayByKey(week.display, "mon")?.piece?.movements.map((movement) => movement.key)).toEqual(["ski"]);
    expect(dayByKey(week.display, "mon")?.piece?.id).not.toBe("mon-engine");
    expect(JSON.stringify(promptOf(fetchImpl))).not.toContain('"candidate_id"');
  });

  it("writes a month evaluation and the next month reads it", async () => {
    await ensureProgrammingWeek(WEEK1, { nowMs: NOW, key: null });
    recordWeeklyActual(WEEK1, { note_ko: "", days: [{ day: "mon", completed: true, result_ko: "마침" }] }, NOW);
    const evaluation = evaluateProgrammingMonth("2026-09-01", NOW + 3);
    if ("error" in evaluation) throw new Error(evaluation.error);
    expect(evaluation.summary_ko).toContain("deload");
    expect(evaluation.next_scheme).toBe("531");

    const fetchImpl = vi.fn(async () => new Response("no", { status: 500 }));
    const next = await ensureProgrammingMonth("2026-10-01", { nowMs: NOW + 4, key: KEY, fetchImpl });
    expect(next.priorEvaluationId).toBe(evaluation.id);
    expect(next.generationSource).toBe("fallback");
    expect(next.direction.scheme).toBe("531");
    expect(next.direction.why_ko).toContain(evaluation.summary_ko);
    const sent = promptOf(fetchImpl);
    expect(JSON.stringify(sent)).toContain(evaluation.summary_ko);
    expect(JSON.stringify(sent.summary)).toContain("531");
    const again = getProgrammingMonth("2026-10-01");
    expect(again?.priorEvaluationId).toBe(evaluation.id);
    const volumeWeek = await ensureProgrammingWeek("2026-10-05", { nowMs: NOW + 6, key: null });
    expect(volumeWeek.draft.sessions.some((session) => session.strength?.sets.some((set) => set.percent_of_tm >= 85))).toBe(true);
  });

  it("keeps stored users, 1RMs, WOD scores, and class scores", async () => {
    const created = registerUser(SECRET_EMAIL, "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 180, unit: "kg" }]);
    saveWodResult(created.user.id, {
      templateSlug: "fran",
      tier: "rx",
      timeSec: 240,
      notesKo: "keep-wod",
    });
    getSqlite()
      .prepare(
        `INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (1, '2026-08-03', 'm', '{}', ?)`,
      )
      .run(NOW);
    getSqlite()
      .prepare(
        `INSERT INTO class_day_scores (
           user_id, class_week_id, day_key, completed_at, rounds, extra_reps, notes_ko
         ) VALUES (?, 1, 'mon', ?, 3, 1, 'keep-class-score')`,
      )
      .run(created.user.id, NOW);

    resetDbConnection();
    getSqlite();
    expect(getUserMaxes(created.user.id).squat).toBe(180);
    expect(listWodResults(created.user.id)).toHaveLength(1);
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM users").get()).toEqual({ c: 1 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_day_scores").get()).toEqual({ c: 1 });
    expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM class_weeks").get()).toEqual({ c: 1 });
    expect(getSqlite().prepare("SELECT notes_ko FROM class_day_scores").get()).toEqual({ notes_ko: "keep-class-score" });
  });
});

describe("fallback obeys the constitution for every scheme", () => {
  it("accepts the 5/3/1 screen week and the other month schemes", () => {
    const month = fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
    for (const weekIndex of [1, 2, 3, 4] as const) {
      const draft = extractDraft(rulesDisplayWeek(weekIndex), fallbackIntent(month, weekIndex, "no_model"));
      expect(constitutionViolations(draft, month, weekIndex)).toEqual([]);
    }
    for (const scheme of ["volume", "intensity", "skill", "deload"] as const) {
      const block = fallbackMonth({ summary_ko: `${scheme} 블록`, next_scheme: scheme });
      for (const weekIndex of [1, 2, 3, 4] as const) {
        const draft = draftForScheme(block, weekIndex, fallbackIntent(block, weekIndex, "no_model"));
        expect(constitutionViolations(draft, block, weekIndex)).toEqual([]);
        expect(draft.sessions.some((session) => session.metcon_purpose && session.expected_duration)).toBe(true);
      }
    }
  });
});
