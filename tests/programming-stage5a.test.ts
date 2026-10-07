import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { dryRunWeek, presetActual } from "../src/lib/programming/admin-tools";
import { ensureProgrammingMonth, ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { MONTH_MAX_TOKENS, WEEK_MAX_TOKENS, authorMonth, authorWeek, monthPrompt, weekPrompt } from "../src/lib/programming/model";
import {
  TIME_DOMAIN_RANGES,
  constitutionViolations,
  heavierThan,
  judgeWeek,
  liftMapKey,
  weekBurden,
} from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import { exampleSets, validateStrengthPrescription } from "../src/lib/programming/strength-methods";
import { getProgrammingMonth } from "../src/lib/programming/store";
import { MONTH_PLAN_OPENAI_MODEL } from "../src/lib/month-plan/week-model";
import type { MonthDirection, WeekDraft } from "../src/lib/programming/types";

const KEY = "sk-stage5a-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";
const MONTH = "2026-10-01";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage5a-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function envelope(body: unknown, finishReason?: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: finishReason ?? "stop", message: { content: JSON.stringify(body) } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
}

function methodMonth(method: "ACCUMULATION" | "INTENSITY_BLOCK" | "DELOAD_RECOVERY"): MonthDirection {
  const scheme = method === "ACCUMULATION" ? "volume" : method === "INTENSITY_BLOCK" ? "intensity" : "deload";
  return fallbackMonth({ summary_ko: "이번 달은 고른 방법을 유지합니다.", next_scheme: scheme, strength_method: method });
}

function weekOf(month: MonthDirection, weekIndex: 1 | 2 | 3 | 4 = 1): WeekDraft {
  return buildFallbackWeek({ month, weekIndex, intent: fallbackIntent(month, weekIndex, "stage5a") });
}

function requestOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> {
  return JSON.parse(String((fetchImpl.mock.calls[call]?.[1] as RequestInit).body)) as Record<string, unknown>;
}

describe("stage 5A week contract and strength methods", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("sends a strict week schema, 8000 tokens, and logs json_schema", async () => {
    freshDb();
    const month = month531();
    const draft = weekOf(month);
    const fetchImpl = vi.fn(async () => envelope(draft));
    const authored = await authorWeek({
      summary: readOnlyWeekSummary(WEEK),
      month,
      weekIndex: 1,
      recent: [],
      key: KEY,
      fetchImpl,
    });
    const body = requestOf(fetchImpl);
    expect(body.max_completion_tokens).toBe(WEEK_MAX_TOKENS);
    expect(WEEK_MAX_TOKENS).toBe(8_000);
    expect(MONTH_MAX_TOKENS).toBe(2_500);
    expect(body.model).toBe("gpt-5.4-nano");
    expect(MONTH_PLAN_OPENAI_MODEL).toBe("gpt-5.4-nano");
    const format = body.response_format as {
      type: string;
      json_schema: { strict: boolean; schema: { additionalProperties: boolean; properties: Record<string, unknown> } };
    };
    expect(format.type).toBe("json_schema");
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.additionalProperties).toBe(false);
    const sessions = format.json_schema.schema.properties.sessions as { items: { properties: Record<string, { anyOf?: Array<{ properties?: { lift?: { enum?: string[] } } }> }> } };
    const liftEnum = sessions.items.properties.strength?.anyOf?.[0]?.properties?.lift?.enum;
    expect(liftEnum).toEqual(["squat", "ohp", "bench", "deadlift"]);
    expect(liftEnum).not.toContain("press");
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.trace.responses[0]?.responseFormat).toBe("json_schema");
  });

  it("names truncation, wrappers, press, short 14, and a missing Sunday", async () => {
    freshDb();
    const month = month531();
    const summary = readOnlyWeekSummary(WEEK);
    const base = weekOf(month);
    const run = (body: unknown) =>
      authorWeek({ summary, month, weekIndex: 1, recent: [], key: KEY, fetchImpl: async () => envelope(body) });

    const cut = await authorWeek({
      summary,
      month,
      weekIndex: 1,
      recent: [],
      key: KEY,
      fetchImpl: async () => envelope({ intent: base.intent }, "length"),
    });
    expect(cut.ok).toBe(false);
    if (cut.ok) return;
    expect(cut.reason).toBe("truncated");
    expect(cut.trace.detail).toBe("finish_reason length");

    const wrapped = await run({ class_week: { days: [] } });
    expect(wrapped.ok).toBe(false);
    if (wrapped.ok) return;
    expect(wrapped.reason).toBe("schema");
    expect(wrapped.trace.detail).toContain("class_week");
    expect(wrapped.trace.errors.join(" ")).toContain("intent");

    const days = await run({ days: base.sessions, why_ko: "이유" });
    expect(days.ok).toBe(false);
    if (days.ok) return;
    expect(days.trace.detail).toContain("days");

    const weekWrap = await run({ week: { why: "이유", days: base.sessions } });
    expect(weekWrap.ok).toBe(false);
    if (weekWrap.ok) return;
    expect(weekWrap.trace.detail).toContain("week");

    const pressed = structuredClone(base) as WeekDraft;
    const liftDay = pressed.sessions.find((session) => session.strength);
    if (!liftDay?.strength) throw new Error("lift missing");
    (liftDay.strength as { lift: string }).lift = "press";
    const press = await run(pressed);
    expect(press.ok).toBe(false);
    if (press.ok) return;
    expect(press.trace.detail).toContain("press");

    const short = structuredClone(base) as WeekDraft;
    const piece = short.sessions.find((session) => session.conditioning && !session.conditioning.long_conditioning);
    if (!piece?.conditioning) throw new Error("piece missing");
    piece.time_domain = "short";
    piece.expected_duration = 14;
    piece.conditioning = { ...piece.conditioning, time_domain: "short", duration_min: 14, long_conditioning: false };
    const fourteen = judgeWeek(short, month, 1, []);
    expect(fourteen.ok).toBe(false);
    if (fourteen.ok) return;
    expect(fourteen.errors.join(" ")).toMatch(/time domain does not match duration/);

    const noSunday = { ...base, sessions: base.sessions.filter((session) => session.day !== "sun") };
    const missing = judgeWeek(noSunday, month, 1, []);
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.errors.join(" ")).toMatch(/seven|missing/);
  });

  it("puts the previous errors on the weekly retry and checks Korean", async () => {
    freshDb();
    const month = month531();
    const summary = readOnlyWeekSummary(WEEK);
    const fetchImpl = vi.fn(async () => envelope({ class_week: { days: [] } }));
    const authored = await authorWeek({ summary, month, weekIndex: 1, recent: [], key: KEY, fetchImpl });
    expect(authored.ok).toBe(false);
    const first = JSON.stringify(requestOf(fetchImpl, 0));
    const second = JSON.stringify(requestOf(fetchImpl, 1));
    expect(first).not.toContain("Do not repeat these errors");
    expect(second).toContain("Do not repeat these errors");
    expect(second).toContain("class_week");
    expect(first).toContain("do not force 5/3/1");

    const english = structuredClone(weekOf(month)) as WeekDraft;
    english.intent.why_ko = "Reduce lower body fatigue and add heavier sets this week.";
    const language = judgeWeek(english, month, 1, []);
    expect(language.ok).toBe(false);
    if (language.ok) return;
    expect(language.reason).toBe("language");

    const korean = structuredClone(weekOf(month)) as WeekDraft;
    korean.intent.why_ko = "이번 주 AMRAP은 16분입니다. 하체는 방법 안에서 유지합니다.";
    expect(judgeWeek(korean, month, 1, []).ok).toBe(true);

    const englishMonth = structuredClone(month) as MonthDirection;
    englishMonth.focus_ko = "Build a stronger class this month";
    const monthResult = await authorMonth({
      summary,
      key: KEY,
      fetchImpl: async () => envelope(englishMonth),
    });
    expect(monthResult.ok).toBe(false);
    if (monthResult.ok) return;
    expect(monthResult.reason).toBe("language");
    expect(monthResult.trace.detail).toContain("focus_ko");
  });

  it("keeps time-domain numbers and the week task, and does not default a missing month to 5/3/1", () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const month = monthPrompt(summary) as { task: string; block_rule: string; implemented_strength_methods: string[] };
    expect(month.task).toContain("top level");
    expect(month.block_rule).toContain("not the default");
    expect(month.implemented_strength_methods).toContain("ACCUMULATION");
    const open = fallbackMonth(null);
    expect(open.strength_method).not.toBe("531");
    expect(open.scheme).not.toBe("531");
    const week = weekPrompt({ summary, month: month531(), weekIndex: 2 }) as {
      task: string;
      time_domain_rules: { short: string; medium: string; long: string };
      strength_prescription: { mode: string; sets?: { percent_of_tm: number }[] };
    };
    expect(week.task).toBe("Write the whole class week, including why. Do not pick from a catalog.");
    expect(week.time_domain_rules.short).toContain(String(TIME_DOMAIN_RANGES.short.min));
    expect(week.time_domain_rules.short).toContain(String(TIME_DOMAIN_RANGES.short.max));
    expect(week.time_domain_rules.medium).toContain(String(TIME_DOMAIN_RANGES.medium.min));
    expect(week.time_domain_rules.long).toContain(String(TIME_DOMAIN_RANGES.long.max));
    expect(week.strength_prescription.mode).toBe("exact");
    expect(week.strength_prescription.sets?.map((set) => set.percent_of_tm)).toEqual([70, 80, 90]);

    const accumulation = weekPrompt({ summary, month: methodMonth("ACCUMULATION"), weekIndex: 1 }) as {
      strength_prescription: { mode: string; note: string };
    };
    expect(accumulation.strength_prescription.mode).toBe("range");
    expect(accumulation.strength_prescription.note).toContain("Do not use 5/3/1");
  });

  it("A–D validate 5/3/1, accumulation, intensity, and deload separately", () => {
    const five = month531();
    const sets531 = schemeSets("531", 1);
    expect(validateStrengthPrescription("531", sets531, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "unknown" })).toBeNull();
    const accumulationSets = exampleSets("ACCUMULATION", 1, "unknown", "squat");
    if (!accumulationSets) throw new Error("accumulation sets missing");
    expect(validateStrengthPrescription("531", accumulationSets, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "unknown" })).toMatch(/strength method/);

    const accumulation = methodMonth("ACCUMULATION");
    expect(accumulation.strength_method).toBe("ACCUMULATION");
    expect(validateStrengthPrescription("ACCUMULATION", accumulationSets, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "unknown" })).toBeNull();
    expect(validateStrengthPrescription("ACCUMULATION", sets531, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "unknown" })).toMatch(/strength method/);
    expect(constitutionViolations(weekOf(accumulation), accumulation, 1)).toEqual([]);

    const intensitySets = exampleSets("INTENSITY_BLOCK", 2, "unknown", "squat");
    if (!intensitySets) throw new Error("intensity sets missing");
    expect(validateStrengthPrescription("INTENSITY_BLOCK", intensitySets, { day: "tue", weekIndex: 2, lift: "squat", fatigue: "unknown" })).toBeNull();
    expect(validateStrengthPrescription("INTENSITY_BLOCK", sets531, { day: "tue", weekIndex: 2, lift: "squat", fatigue: "unknown" })).toMatch(/strength method/);
    expect(constitutionViolations(weekOf(methodMonth("INTENSITY_BLOCK"), 2), methodMonth("INTENSITY_BLOCK"), 2)).toEqual([]);

    const deload = methodMonth("DELOAD_RECOVERY");
    const deloadSets = exampleSets("DELOAD_RECOVERY", 1, "unknown", "squat");
    if (!deloadSets) throw new Error("deload sets missing");
    expect(validateStrengthPrescription("DELOAD_RECOVERY", deloadSets, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "low" })).toBeNull();
    expect(validateStrengthPrescription("DELOAD_RECOVERY", sets531, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "low" })).toMatch(/strength method/);
    expect(constitutionViolations(weekOf(deload), deload, 1)).toEqual([]);
    expect(validateStrengthPrescription("POWER_SPEED", sets531, { day: "mon", weekIndex: 1, lift: "squat", fatigue: "unknown" })).toMatch(/not implemented/);
  });

  it("E keeps the month method when the weekly model fails", async () => {
    freshDb();
    const month = methodMonth("ACCUMULATION");
    await ensureProgrammingMonth(MONTH, { nowMs: NOW, key: KEY, fetchImpl: async () => envelope(month) });
    const stored = getProgrammingMonth(MONTH);
    expect(stored?.direction.strength_method).toBe("ACCUMULATION");
    const week = await ensureProgrammingWeek(WEEK, {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => new Response("no", { status: 500 }),
    });
    expect(week.generationSource).toBe("fallback");
    expect(getProgrammingMonth(MONTH)?.direction.strength_method).toBe("ACCUMULATION");
    const strength = week.draft.sessions.filter((session) => session.strength);
    expect(strength.length).toBeGreaterThan(0);
    for (const session of strength) {
      expect(session.strength?.sets.some((set) => set.reps === 5 && set.percent_of_tm >= 85)).toBe(false);
      expect(session.strength?.sets.every((set) => set.reps >= 6)).toBe(true);
    }
  });

  it("F distinguishes high and low fatigue without using 5/3/1 as the only scale", () => {
    const month = methodMonth("ACCUMULATION");
    const high = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "a"),
      previousActual: presetActual("a"),
    });
    const low = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "b"),
      previousActual: presetActual("b"),
    });
    expect(heavierThan(weekBurden(high), weekBurden(low))).toEqual([]);
    expect(JSON.stringify(high.sessions.map((session) => session.strength?.sets))).not.toBe(
      JSON.stringify(low.sessions.map((session) => session.strength?.sets)),
    );
    const judgedHigh = judgeWeek(low, month, 1, [], { previousActual: presetActual("a") });
    expect(judgedHigh.ok).toBe(false);
    if (judgedHigh.ok) return;
    expect(judgedHigh.reason).toBe("feedback");
    expect(judgedHigh.detail).not.toContain("scheme_sets");

    const saidReduced = structuredClone(low) as WeekDraft;
    saidReduced.intent.why_ko = "하체 부담을 줄였습니다. 세트도 낮췄습니다.";
    const intent = judgeWeek(saidReduced, month, 1, [], { previousActual: presetActual("a") });
    expect(intent.ok).toBe(false);
    if (intent.ok) return;
    expect(intent.errors.join(" ")).toMatch(/fatigue limit|strength method/);
  });

  it("G rejects a copied weekday lift map unless the month states a progression reason", () => {
    const month = methodMonth("ACCUMULATION");
    const draft = weekOf(month);
    const map = liftMapKey(draft);
    const repeated = judgeWeek(draft, month, 1, [], { recentLiftMaps: [map, map] });
    expect(repeated.ok).toBe(false);
    if (repeated.ok) return;
    expect(repeated.reason).toBe("weekday_pattern");
    const progressing = { ...month, progression_notes: "같은 요일 리프트를 주차 진행으로 이어 갑니다." };
    expect(judgeWeek(draft, progressing, 1, [], { recentLiftMaps: [map, map] }).ok).toBe(true);
    expect(judgeWeek(draft, month, 1, [], { recentLiftMaps: [map] }).ok).toBe(true);
  });

  it("shows parse, validation, similarity, feedback, fallback, and the final result on a dry run", async () => {
    freshDb();
    const month = month531();
    const draft = weekOf(month);
    await ensureProgrammingMonth(MONTH, { nowMs: NOW, key: KEY, fetchImpl: async () => envelope(month) });
    const ok = await dryRunWeek({
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(draft),
    });
    expect(ok.wrote).toBe(false);
    expect(ok).toHaveProperty("input");
    expect(ok).toHaveProperty("ai_output");
    expect(ok.parse_result).toMatchObject({ ok: true });
    expect(ok.validation).toMatchObject({ ok: true, detail: null });
    expect(ok.validation_errors).toEqual([]);
    expect(ok).toHaveProperty("similarity");
    expect(ok).toHaveProperty("feedback");
    expect(ok).toHaveProperty("fallback");
    expect(ok.final_result).toMatchObject({ generation_source: "model" });

    const failed = await dryRunWeek({
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope({ class_week: { days: [] } }),
    });
    expect(failed.parse_result).toMatchObject({ ok: false });
    expect(failed.final_result).toMatchObject({ generation_source: "fallback" });
    expect(Array.isArray(failed.validation_errors)).toBe(true);
  });
});
