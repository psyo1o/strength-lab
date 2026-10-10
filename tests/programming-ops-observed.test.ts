import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { ensureProgrammingMonth, ensureProgrammingWeek, regenerateProgrammingWeek } from "../src/lib/programming/engine";
import { buildFallbackWeek, fallbackIntent, fallbackMonth } from "../src/lib/programming/fallback";
import { refreshSessionFields } from "../src/lib/programming/session-fields";
import {
  judgeWeek,
  similarityDiagnostics,
  similarityMatch,
  structurallySimilar,
  toStructure,
} from "../src/lib/programming/rules";
import { getProgrammingMonth, getProgrammingWeek, listRecentStructures } from "../src/lib/programming/store";
import {
  SIMILARITY_CONFIG,
  addDays,
  weekIndexFromStart,
  type MonthDirection,
  type StoredStructure,
  type WeekDraft,
} from "../src/lib/programming/types";

function scored(partial: Pick<StoredStructure, "day" | "format" | "time_domain" | "stimulus" | "movement_patterns" | "equipment" | "volume">): StoredStructure {
  return {
    ...partial,
    movements: [{ key: "name-not-scored", amount: "8", name_ko: "이름" }],
    rep_structure: "반복",
    work_rest_structure: "쉼",
    duration_min: 12,
    intensity: "moderate",
    benchmark: false,
    long_conditioning: false,
  };
}

const KEY = "sk-ops-observed-test";
const NOW = Date.parse("2099-07-06T01:00:00.000Z");
const OLD_WEEK = "2099-05-26";
const MID_WEEK = "2099-06-09";
const PRIOR_WEEK = "2099-07-06";
const NEXT_WEEK = "2099-07-13";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-ops-observed-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.PHASE_C;
  resetDbConnection();
}

function envelope(body: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textEnvelope(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function month531(): MonthDirection {
  return fallbackMonth({ summary_ko: "5/3/1 한 달의 방향을 유지합니다.", next_scheme: "531" });
}

function renameMovements(draft: WeekDraft): WeekDraft {
  const copy = structuredClone(draft);
  for (const session of copy.sessions) {
    if (!session.conditioning) continue;
    session.conditioning = {
      ...session.conditioning,
      movements: session.conditioning.movements.map((movement, index) => ({
        key: `renamed-${session.day}-${index}`,
        amount: movement.amount,
        name_ko: "이름만 바꾼 동작",
      })),
    };
  }
  copy.sessions = refreshSessionFields(copy.sessions);
  return copy;
}

/** Copy scored features from one prior structure onto one non-long day. Stimulus stays, so a name change is not the difference. */
function alignOneDay(draft: WeekDraft, recent: readonly StoredStructure[]): WeekDraft {
  const prior = recent.find((row) => !row.benchmark && !row.long_conditioning && row.time_domain !== "long");
  if (!prior) throw new Error("prior week has no short or medium structure");
  const copy = structuredClone(draft);
  const session = copy.sessions.find((row) => row.conditioning && !row.conditioning.benchmark && !row.conditioning.long_conditioning);
  if (!session?.conditioning) throw new Error("draft has no ordinary conditioning day");
  const duration = prior.duration_min;
  session.conditioning = {
    ...session.conditioning,
    format: prior.format,
    time_domain: prior.time_domain,
    movement_patterns: [...prior.movement_patterns],
    equipment: [...prior.equipment],
    volume: prior.volume,
    duration_min: duration,
    long_conditioning: false,
    movements: [{ key: "renamed-only-row", amount: "12cal", name_ko: "이름만 바꾼 로잉" }],
  };
  copy.sessions = refreshSessionFields(copy.sessions);
  return copy;
}

function weekLogs(weekStart: string): Array<{ attempt: number; raw: Record<string, unknown> }> {
  const rows = getSqlite()
    .prepare(
      `SELECT generation_attempt, raw_json FROM programming_generation_logs
       WHERE scope = 'week' AND scope_key = ? ORDER BY id ASC`,
    )
    .all(weekStart) as Array<{ generation_attempt: number; raw_json: string }>;
  return rows.map((row) => ({ attempt: row.generation_attempt, raw: JSON.parse(row.raw_json) as Record<string, unknown> }));
}

describe("ops-observed weekly similarity and monthly json labels", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    delete process.env.COACHING_PIPELINE;
    delete process.env.LONGITUDINAL_PLANNING;
    delete process.env.PHASE_C;
    resetDbConnection();
  });

  it("keeps the similarity threshold and ignores movement names", () => {
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
    const month = month531();
    const draft = buildFallbackWeek({ month, weekIndex: 1, intent: fallbackIntent(month, 1, "names") });
    const monday = toStructure(draft.sessions.find((session) => session.conditioning)!)!;
    const renamed = {
      ...monday,
      movements: [{ key: "not-the-same-movement", amount: "8", name_ko: "전혀 다른 이름" }],
    };
    const sameNames = similarityMatch(monday, monday);
    const renamedScore = similarityMatch(monday, renamed);
    expect(renamedScore.score).toBe(sameNames.score);
    expect(renamedScore.score).toBeGreaterThanOrEqual(SIMILARITY_CONFIG.threshold);
    expect(structurallySimilar(monday, renamed)).toBe(true);
    const changed = {
      ...renamed,
      format: monday.format === "amrap" ? ("for_time" as const) : ("amrap" as const),
      time_domain: monday.time_domain === "short" ? ("medium" as const) : ("short" as const),
      stimulus: monday.stimulus === "heavy" ? ("technical" as const) : ("heavy" as const),
      equipment: ["rower" as const],
      volume: monday.volume === "low" ? ("high" as const) : ("low" as const),
    };
    const changedScore = similarityMatch(monday, changed);
    expect(changedScore.score).toBeLessThan(SIMILARITY_CONFIG.threshold);
    expect(structurallySimilar(monday, changed)).toBe(false);
    expect(changedScore.matched).not.toEqual(expect.arrayContaining(["format", "time_domain", "stimulus", "equipment", "volume"]));
  });

  it("scores the 2026-10-07 response as thursday against saturday inside the same week", () => {
    const thursday = scored({
      day: "thu",
      format: "amrap",
      time_domain: "medium",
      stimulus: "technical",
      movement_patterns: ["engine", "gymnastic"],
      equipment: ["ski", "bodyweight"],
      volume: "low",
    });
    const saturday = scored({
      day: "sat",
      format: "amrap",
      time_domain: "short",
      stimulus: "technical",
      movement_patterns: ["gymnastic", "engine"],
      equipment: ["jump_rope", "bodyweight"],
      volume: "low",
    });
    expect(similarityMatch(thursday, saturday)).toEqual({
      score: 4,
      matched: ["format", "stimulus", "movement_pattern", "volume"],
    });
    const olderSaturday = scored({
      day: "sat",
      format: "amrap",
      time_domain: "short",
      stimulus: "high_rep",
      movement_patterns: ["gymnastic"],
      equipment: ["bodyweight", "rings"],
      volume: "low",
    });
    expect(similarityMatch(saturday, olderSaturday)).toEqual({
      score: 3,
      matched: ["format", "time_domain", "volume"],
    });
    expect(SIMILARITY_CONFIG.threshold).toBe(4);
  });

  it("compares only active weeks inside the forty day window", async () => {
    freshDb();
    await ensureProgrammingWeek(OLD_WEEK, { nowMs: NOW, key: null });
    await ensureProgrammingWeek(MID_WEEK, { nowMs: NOW, key: null });
    await regenerateProgrammingWeek(MID_WEEK, { nowMs: NOW + 1, key: null });
    await ensureProgrammingWeek(PRIOR_WEEK, { nowMs: NOW, key: null });

    const rows = getSqlite()
      .prepare(
        `SELECT w.week_start, w.status, COUNT(*) AS structures
         FROM wod_structures s JOIN programming_weeks w ON w.id = s.week_id
         GROUP BY w.id ORDER BY w.week_start, w.id`,
      )
      .all() as Array<{ week_start: string; status: string; structures: number }>;
    expect(rows.filter((row) => row.week_start === MID_WEEK).map((row) => row.status).sort()).toEqual(["active", "superseded"]);
    expect(rows.some((row) => row.week_start === OLD_WEEK && row.status === "active" && row.structures > 0)).toBe(true);

    const recent = listRecentStructures(NEXT_WEEK);
    const windowStart = addDays(NEXT_WEEK, -40);
    expect(windowStart).toBe("2099-06-03");
    expect(OLD_WEEK < windowStart).toBe(true);
    const inWindow = rows
      .filter((row) => row.status === "active" && row.week_start < NEXT_WEEK && row.week_start >= windowStart)
      .reduce((sum, row) => sum + row.structures, 0);
    expect(recent).toHaveLength(inWindow);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.every((row) => row.movements.length > 0)).toBe(true);
    const supersededStructures = rows
      .filter((row) => row.status === "superseded")
      .reduce((sum, row) => sum + row.structures, 0);
    expect(supersededStructures).toBeGreaterThan(0);
    expect(recent).toHaveLength(inWindow);
  });

  it("adopts a differentiated model week and does not treat a rename as similarity", async () => {
    freshDb();
    await ensureProgrammingWeek(PRIOR_WEEK, { nowMs: NOW, key: null });
    const month = getProgrammingMonth("2099-07-01");
    if (!month) throw new Error("month missing");
    const recent = listRecentStructures(NEXT_WEEK);
    expect(recent.length).toBeGreaterThan(0);
    const legal = buildFallbackWeek({
      month: month.direction,
      weekIndex: weekIndexFromStart(NEXT_WEEK),
      intent: fallbackIntent(month.direction, weekIndexFromStart(NEXT_WEEK), "differentiated"),
      recent,
    });
    const renamed = renameMovements(legal);
    const judged = judgeWeek(renamed, month.direction, weekIndexFromStart(NEXT_WEEK), recent);
    expect(judged.ok, judged.ok ? "" : judged.errors.join(" | ")).toBe(true);
    const diagnostics = similarityDiagnostics(renamed, recent);
    expect(diagnostics.threshold).toBe(4);
    expect(diagnostics.hits).toEqual([]);

    const fetchImpl = vi.fn(async () => envelope(renamed));
    const saved = await ensureProgrammingWeek(NEXT_WEEK, { nowMs: NOW + 2, key: KEY, fetchImpl });
    expect(saved.generationSource).toBe("model");
    expect(saved.fallbackReason).toBeNull();
    expect(saved.promptVersion).toBe("wod-from-intent-v1");
    expect(saved.generationAttempt).toBe(1);
    expect(JSON.stringify(saved.draft)).toContain("renamed-mon-0");
    const logs = weekLogs(NEXT_WEEK);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.raw.run).toMatchObject({ generation_source: "model" });
  });

  it("stores too_similar when the model only renames a movement against the prior active week", async () => {
    freshDb();
    const prior = await ensureProgrammingWeek(PRIOR_WEEK, { nowMs: NOW, key: null });
    expect(prior.generationSource).toBe("fallback");
    expect(prior.fallbackReason).toBe("no_model");
    const month = getProgrammingMonth("2099-07-01");
    if (!month) throw new Error("month missing");
    const recent = listRecentStructures(NEXT_WEEK);
    const priorStructures = getSqlite()
      .prepare("SELECT COUNT(*) AS c FROM wod_structures WHERE week_id = ?")
      .get(prior.id) as { c: number };
    expect(recent).toHaveLength(priorStructures.c);

    const legal = buildFallbackWeek({
      month: month.direction,
      weekIndex: weekIndexFromStart(NEXT_WEEK),
      intent: fallbackIntent(month.direction, weekIndexFromStart(NEXT_WEEK), "aligned"),
      recent,
    });
    const aligned = alignOneDay(legal, recent);
    const judged = judgeWeek(aligned, month.direction, weekIndexFromStart(NEXT_WEEK), recent);
    expect(judged.ok).toBe(false);
    if (judged.ok) return;
    expect(judged.reason).toBe("too_similar");
    const preview = similarityDiagnostics(aligned, recent);
    const recentHit = preview.hits.find((hit) => hit.compared_scope === "recent");
    expect(recentHit?.score).toBeGreaterThanOrEqual(4);
    expect(recentHit?.matched.length).toBeGreaterThanOrEqual(4);
    const renamedOnly = toStructure(aligned.sessions.find((session) => session.conditioning?.movements.some((movement) => movement.key === "renamed-only-row"))!);
    const priorMatch = recent.find((row) => row.day === recentHit?.compared_day && !row.benchmark);
    expect(renamedOnly && priorMatch).toBeTruthy();
    if (renamedOnly && priorMatch) {
      expect(similarityMatch(renamedOnly, { ...priorMatch, movements: renamedOnly.movements }).score).toBe(
        similarityMatch(renamedOnly, priorMatch).score,
      );
    }

    const fetchImpl = vi.fn(async () => envelope(aligned));
    const saved = await ensureProgrammingWeek(NEXT_WEEK, { nowMs: NOW + 3, key: KEY, fetchImpl });
    expect(saved.generationSource).toBe("fallback");
    expect(saved.fallbackReason).toBe("too_similar");
    expect(saved.promptVersion).toBe("wod-from-intent-v1");
    expect(saved.generationAttempt).toBe(2);
    expect(JSON.stringify(saved.draft)).not.toContain("renamed-only-row");
    expect(getProgrammingWeek(NEXT_WEEK)?.generationSource).not.toBe("model");

    const logs = weekLogs(NEXT_WEEK);
    expect(logs.map((row) => row.attempt)).toEqual([1, 2]);
    for (const log of logs) {
      expect(log.raw.run).toMatchObject({ generation_source: "fallback" });
      const errors = log.raw.errors as string[];
      expect(errors.join(" ")).toContain("matches a recent structure");
      const similarity = (log.raw.diagnostics as { similarity: { threshold: number; hits: Array<{ compared_scope: string; score: number }> } }).similarity;
      expect(similarity.threshold).toBe(4);
      expect(similarity.hits.some((hit) => hit.compared_scope === "recent" && hit.score >= 4)).toBe(true);
    }
  });

  it("stores monthly bad_json, schema, and an adopted retry as different results", async () => {
    freshDb();
    const unreadable = await ensureProgrammingMonth("2099-01-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => textEnvelope("not-json"),
    });
    expect(unreadable.generationSource).toBe("fallback");
    expect(unreadable.fallbackReason).toBe("bad_json");
    expect(unreadable.generationAttempt).toBe(2);

    const thin = await ensureProgrammingMonth("2099-02-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope({ scheme: "531" }),
    });
    expect(thin.generationSource).toBe("fallback");
    expect(thin.fallbackReason).toBe("schema");
    expect(thin.fallbackReason).not.toBe("bad_json");

    const valid = month531();
    const adopted = await ensureProgrammingMonth("2099-03-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(valid),
    });
    expect(adopted.generationSource).toBe("model");
    expect(adopted.fallbackReason).toBeNull();
    expect(adopted.direction.scheme).toBe("531");
    expect(adopted.promptVersion).toBe("monthly-program-v4");

    let monthCalls = 0;
    const retried = await ensureProgrammingMonth("2099-04-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => {
        monthCalls += 1;
        return monthCalls === 1 ? textEnvelope("{") : envelope(valid);
      },
    });
    expect(monthCalls).toBe(2);
    expect(retried.generationSource).toBe("model");
    expect(retried.fallbackReason).toBeNull();
    expect(retried.generationAttempt).toBe(2);
    expect(retried.direction.scheme).toBe("531");

    const mismatched = {
      ...valid,
      strength_method: "DELOAD_RECOVERY",
    };
    const rejected = await ensureProgrammingMonth("2099-05-01", {
      nowMs: NOW,
      key: KEY,
      fetchImpl: async () => envelope(mismatched),
    });
    expect(rejected.generationSource).toBe("fallback");
    expect(rejected.fallbackReason).toBe("schema");
    expect(rejected.direction.scheme).not.toBe("531");
    expect(getProgrammingMonth("2099-05-01")?.generationSource).not.toBe("model");
  });
});
