import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { dryRunMonth, dryRunWeek, presetActual } from "../src/lib/programming/admin-tools";
import { ensureProgrammingWeek, readOnlyWeekSummary } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { authorMonth, authorWeek, monthPrompt, weekPrompt } from "../src/lib/programming/model";
import { constitutionViolations, MONTH_REQUIRED_KEYS } from "../src/lib/programming/rules";
import { schemeSets } from "../src/lib/programming/schemes";
import {
  monthlyTimeoutMs,
  weeklyTimeoutMs,
  DEFAULT_MONTHLY_TIMEOUT_MS,
  DEFAULT_WEEKLY_TIMEOUT_MS,
} from "../src/lib/programming/timeouts";
import { SCHEMES, type WeekIndex } from "../src/lib/programming/types";

const KEY = "sk-stage4-test-key";
const NOW = Date.parse("2026-10-05T01:00:00.000Z");
const WEEK = "2026-10-05";

const ENGINE_KEYS = new Set(["run", "row", "ski", "ski_erg", "fan_bike", "bike", "assault_bike", "echo_bike", "double_under"]);

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-stage4-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS;
  delete process.env.MONTH_PLAN_MONTHLY_TIMEOUT_MS;
  resetDbConnection();
  getSqlite();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("stage 4 model wait, schema, and fallback quality", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS;
    delete process.env.MONTH_PLAN_MONTHLY_TIMEOUT_MS;
    delete process.env.MONTH_PLAN_MODEL_TIMEOUT_MS;
    resetDbConnection();
  });

  it("uses a 90s weekly wait and a 60s monthly wait, overridable without the old 12s constant", () => {
    expect(weeklyTimeoutMs()).toBe(DEFAULT_WEEKLY_TIMEOUT_MS);
    expect(monthlyTimeoutMs()).toBe(DEFAULT_MONTHLY_TIMEOUT_MS);
    expect(weeklyTimeoutMs()).toBe(90_000);
    expect(monthlyTimeoutMs()).toBe(60_000);
    process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS = "12345";
    process.env.MONTH_PLAN_MONTHLY_TIMEOUT_MS = "23456";
    expect(weeklyTimeoutMs()).toBe(12345);
    expect(monthlyTimeoutMs()).toBe(23456);
    process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS = "nope";
    process.env.MONTH_PLAN_MONTHLY_TIMEOUT_MS = "500";
    expect(weeklyTimeoutMs()).toBe(90_000);
    expect(monthlyTimeoutMs()).toBe(60_000);
    process.env.MONTH_PLAN_MODEL_TIMEOUT_MS = "12000";
    delete process.env.MONTH_PLAN_WEEKLY_TIMEOUT_MS;
    expect(weeklyTimeoutMs()).toBe(90_000);
  });

  it("passes the configured wait to AbortSignal and keeps two attempts", async () => {
    freshDb();
    const month = fallbackMonth(null);
    const summary = readOnlyWeekSummary(WEEK);
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("slow"), { name: "TimeoutError" });
    });
    const authored = await authorWeek({
      summary,
      month,
      weekIndex: 1,
      recent: [],
      key: KEY,
      fetchImpl,
      timeoutMs: 1234,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(timeout).toHaveBeenCalledWith(1234);
    expect(authored.ok).toBe(false);
    if (authored.ok) return;
    expect(authored.reason).toBe("timeout");
    expect(authored.trace.detail).toBe("timed out");
    expect(authored.trace.responses).toHaveLength(2);
    expect(authored.trace.responses[0]).toMatchObject({ attempt: 1, raw: { timeout: true } });
    expect(authored.trace.responses[0]?.latencyMs).toEqual(expect.any(Number));

    timeout.mockClear();
    await authorWeek({ summary, month, weekIndex: 1, recent: [], key: KEY, fetchImpl });
    expect(timeout).toHaveBeenCalledWith(90_000);
    timeout.mockClear();
    await authorMonth({ summary, key: KEY, fetchImpl });
    expect(timeout).toHaveBeenCalledWith(60_000);
  });

  it("asks for json schema and falls back to json object when the api rejects it", async () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const direction = fallbackMonth(null);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { response_format: { type: string } };
      if (body.response_format.type === "json_schema") {
        return new Response(JSON.stringify({ error: { message: "response_format json_schema is unsupported" } }), {
          status: 400,
        });
      }
      expect(body.response_format.type).toBe("json_object");
      return envelope(direction);
    });
    const authored = await authorMonth({ summary, key: KEY, fetchImpl });
    expect(authored.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("accepts a wrapped month and rejects a thin wrapper as schema, not bad json", async () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const direction = fallbackMonth(null);
    const wrapped = await authorMonth({
      summary,
      key: KEY,
      fetchImpl: async () => envelope({ month_direction_only: direction }),
    });
    expect(wrapped.ok).toBe(true);

    const thin = await authorMonth({
      summary,
      key: KEY,
      fetchImpl: async () => envelope({ month_direction_only: { scheme: "531" } }),
    });
    expect(thin.ok).toBe(false);
    if (thin.ok) return;
    expect(thin.reason).toBe("schema");
    expect(thin.trace.detail).toMatch(/missing/);
    expect(thin.reason).not.toBe("bad_json");

    const broken = await authorMonth({
      summary,
      key: KEY,
      fetchImpl: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    });
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.reason).toBe("bad_json");
    expect(broken.trace.detail).toBe("unreadable JSON");
  });

  it("puts required month keys at the top level and keeps the week task sentence", () => {
    freshDb();
    const summary = readOnlyWeekSummary(WEEK);
    const month = monthPrompt(summary) as { task: string; required_top_level_keys: string[]; rules: string[] };
    expect(month.required_top_level_keys).toEqual([...MONTH_REQUIRED_KEYS]);
    expect(month.task).toContain("top level");
    expect(month.task).toContain("month_direction_only");
    expect(month.rules.join(" ")).not.toContain("Write the month direction only");
    const week = weekPrompt({ summary, month: fallbackMonth(null), weekIndex: 1 }) as { task: string; rules: string[] };
    expect(week.task).toBe("Write the whole class week, including why. Do not pick from a catalog.");
    expect(week.rules.join(" ")).toContain("60 minutes");
  });

  it("returns validation detail for weekly and monthly dry runs and stores latency", async () => {
    freshDb();
    const failedWeek = await dryRunWeek({
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => new Response("no", { status: 500 }),
    });
    expect(failedWeek.validation).toMatchObject({ ok: false, reason: "http_error", detail: "http 500" });
    const raw = failedWeek.raw_responses as { latencyMs: number; raw: { status: number } }[];
    expect(raw).toHaveLength(2);
    expect(raw[0]?.latencyMs).toEqual(expect.any(Number));
    expect(raw[0]?.raw.status).toBe(500);

    const failedMonth = await dryRunMonth({
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope({ month_direction_only: { scheme: "531" } }),
    });
    expect(failedMonth.validation).toMatchObject({ ok: false, reason: "schema" });
    expect(String((failedMonth.validation as { detail: unknown }).detail)).toMatch(/missing/);
    expect(JSON.stringify(failedWeek)).not.toContain("모델 키는 여기에 적지 않습니다.");

    const month = fallbackMonth(null);
    const draft = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "stage4") });
    await ensureProgrammingWeek(WEEK, {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(draft),
    });
    const logged = getSqlite().prepare("SELECT latency_ms, raw_json FROM programming_generation_logs").all() as {
      latency_ms: number | null;
      raw_json: string;
    }[];
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.every((row) => typeof row.latency_ms === "number")).toBe(true);
  });

  it("keeps the route limit high enough for two long model waits", () => {
    const files = [
      "src/app/api/admin/engine/route.ts",
      "src/app/api/month-plan/route.ts",
      "src/app/(app)/dashboard/page.tsx",
      "src/app/(app)/plan/page.tsx",
      "src/app/(app)/plan/w/[weekStart]/[day]/page.tsx",
    ];
    for (const file of files) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8")).toContain("export const maxDuration = 300");
    }
  });

  it("builds a class-sized fallback whose labels, sets, and clock match the movements", () => {
    const month = fallbackMonth({ summary_ko: "5/3/1 한 달", next_scheme: "531" });
    let skillHits = 0;
    for (const scheme of SCHEMES) {
      const block = scheme === "531" ? month : fallbackMonth({ summary_ko: `${scheme} 블록`, next_scheme: scheme });
      for (const weekIndex of [1, 2, 3, 4] as WeekIndex[]) {
        for (const actual of ["a", "b"] as const) {
          const draft = buildFallbackWeek({
            month: block,
            weekIndex,
            intent: fallbackIntent(block, weekIndex, "stage4"),
            previousActual: presetActual(actual),
          });
          expect(constitutionViolations(draft, block, weekIndex, presetActual(actual))).toEqual([]);
          const combos = new Set<string>();
          const warmups = new Set<string>();
          const purposes = new Set<string>();
          for (const session of draft.sessions) {
            if (session.day === "sat") expect(session.strength).toBeNull();
            if (session.rest || !session.conditioning) continue;
            const keys = session.conditioning.movements.map((movement) => movement.key);
            const combo = [...keys].sort().join("+");
            expect(combos.has(combo)).toBe(false);
            combos.add(combo);
            warmups.add(session.warmup_ko);
            purposes.add(session.metcon_purpose ?? "");
            const minutes = session.warmup_min + (session.strength ? 25 : 0) + session.conditioning.duration_min;
            expect(minutes).toBeLessThanOrEqual(60);
            if (session.conditioning.long_conditioning) {
              expect(session.strength).toBeNull();
              expect(session.conditioning.rep_structure).toMatch(/라운드|캡/);
              expect(session.day).not.toBe("wed");
            }
            if (session.conditioning.format === "emom") {
              expect(session.conditioning.rep_structure).toMatch(/1분/);
              expect(session.conditioning.rep_structure).toMatch(/캡/);
              expect(keys.join(" ")).not.toMatch(/400m|250m|800m|1600m/);
            }
            const engineOnly = keys.length > 0 && keys.every((key) => ENGINE_KEYS.has(key));
            if (engineOnly) {
              expect(session.conditioning.stimulus).not.toBe("heavy");
              expect(session.conditioning.intensity).not.toBe("heavy");
            }
            if (keys.includes("double_under") && keys.includes("handstand")) {
              skillHits += 1;
              expect(session.conditioning.movement_patterns).toContain("gymnastic");
              expect(session.conditioning.stimulus).not.toBe("heavy");
              expect(session.conditioning.movement_patterns).toContain("engine");
            }
            const barbell =
              Boolean(session.strength) ||
              session.conditioning.equipment.includes("barbell") ||
              keys.some((key) => ["thruster", "clean", "snatch", "deadlift", "squat", "front_squat"].includes(key));
            if (!barbell) expect(session.warmup_ko).not.toContain("빈 바");
          }
          expect(warmups.size).toBeGreaterThan(1);
          expect(purposes.has("클래스 메트콘입니다.")).toBe(false);
          expect(purposes.size).toBeGreaterThan(1);
        }
      }
    }
    expect(skillHits).toBeGreaterThan(0);

    const high = buildFallbackWeek({
      month,
      weekIndex: 1,
      intent: fallbackIntent(month, 1, "stage4"),
      previousActual: presetActual("a"),
    });
    for (const session of high.sessions) {
      if (session.strength?.lift === "squat" || session.strength?.lift === "deadlift") {
        expect(session.strength.sets.length).toBeLessThan(schemeSets(month.scheme, 1).length);
        expect(session.strength.sets.some((set) => set.amrap)).toBe(false);
      }
    }
    const note = high.intent.scheme_note;
    expect(note).toContain("하체");
    expect(note.split(month.scheme).length - 1).toBe(1);
    expect(note).not.toContain("모델 키");
    expect(high.intent.why_ko).not.toContain("모델 키는 여기에 적지 않습니다.");
  });
});
