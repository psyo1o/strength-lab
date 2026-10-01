import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { resetDbConnection } from "../src/lib/db/client";
import { saveUserMaxes } from "../src/lib/maxes";
import { buildWeek, dayByKey, weekMetconSlots } from "../src/lib/month-plan/build-week";
import { listStructuralMetcons } from "../src/lib/month-plan/pieces";
import { generatePlanForUser } from "../src/lib/month-plan/store";
import {
  acceptCandidateIds,
  MONTH_PLAN_OPENAI_MODEL,
  MONTH_PLAN_OPENAI_URL,
  parseCandidatePicks,
  resolvePlannedWeek,
  type CandidatePick,
} from "../src/lib/month-plan/week-model";
import type { MetconRequest, WeekBuildInput } from "../src/lib/month-plan/types";

const KEY = "sk-test-not-a-real-key";

function input(partial: Partial<WeekBuildInput> & Pick<WeekBuildInput, "weekIndex" | "maxes">): WeekBuildInput {
  return {
    sex: partial.sex ?? null,
    recentMetcons: partial.recentMetcons ?? [],
    trainingDays: partial.trainingDays,
    weekIndex: partial.weekIndex,
    maxes: partial.maxes,
  };
}

function envelope(picks: CandidatePick[]): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ picks }) } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const ALT_WEEK: CandidatePick[] = [
  { day: "mon", candidate_id: "mon-gym" },
  { day: "tue", candidate_id: "tue-skill" },
  { day: "wed", candidate_id: "wed-intervals" },
  { day: "thu", candidate_id: "thu-short" },
  { day: "fri", candidate_id: "fri-engine" },
  { day: "sat", candidate_id: "sat-reps" },
];

function weekInput(): WeekBuildInput {
  return input({
    weekIndex: 1,
    sex: "m",
    maxes: { squat: 200, ohp: 100, bench: 140, deadlift: 220 },
  });
}

const NOW = Date.parse("2026-09-30T01:00:00.000Z");

describe("generating a week stays on the server", () => {
  beforeEach(() => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-model-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("makes no network call without a key, and one failed call falls back to rules", async () => {
    const created = registerUser("model-week@example.com", "password123");
    if ("error" in created) throw new Error(created.error);
    saveUserMaxes(created.user.id, [{ exerciseKey: "squat", value: 200, unit: "kg" }]);
    const spy = vi.spyOn(globalThis, "fetch");
    const first = await generatePlanForUser(created.user.id, { weekIndex: 1, sex: "m", nowMs: NOW });
    if ("error" in first) throw new Error(first.error);
    expect(spy).not.toHaveBeenCalled();
    expect(first.week.adapterId).toBe("rules");
    expect(dayByKey(first.week, "mon")!.piece!.id).toBe("mon-engine");
    expect(dayByKey(first.week, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual([117.5, 135, 152.5]);

    process.env.MONTH_PLAN_MODEL_KEY = KEY;
    spy.mockResolvedValue(new Response("not-json", { status: 200 }));
    const second = await generatePlanForUser(created.user.id, { weekIndex: 1, sex: "m", nowMs: NOW + 1_000 });
    if ("error" in second) throw new Error(second.error);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe(MONTH_PLAN_OPENAI_URL);
    expect(second.week.adapterId).toBe("rules");
    expect(dayByKey(second.week, "mon")!.piece!.signature).toBe(dayByKey(first.week, "mon")!.piece!.signature);
    expect(dayByKey(second.week, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual([117.5, 135, 152.5]);
  });
});

describe("weekly model picks a candidate id", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.MONTH_PLAN_MODEL_KEY;
  });

  it("fills from rules and does not call the network when the key is absent", async () => {
    const fetchImpl = vi.fn();
    const built = input({ weekIndex: 1, sex: "f", maxes: { squat: 100, deadlift: 120 } });
    const week = await resolvePlannedWeek(built, { key: null, fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(week).toEqual(buildWeek(built));
    expect(week.adapterId).toBe("rules");
    expect(dayByKey(week, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual([57.5, 67.5, 77.5]);
  });

  it("uses one weekly call and keeps the server piece for a known candidate id", async () => {
    const fetchImpl = vi.fn(async () => envelope(ALT_WEEK));
    const built = weekInput();
    const week = await resolvePlannedWeek(built, { key: KEY, fetchImpl, blockedSignatures: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(MONTH_PLAN_OPENAI_URL);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(MONTH_PLAN_OPENAI_MODEL);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.reasoning_effort).toBe("none");
    expect(JSON.stringify(body)).not.toContain(KEY);
    expect(JSON.stringify(body)).not.toMatch(/117\.5|152\.5/);
    expect(body.messages).toHaveLength(2);
    const days = JSON.parse(body.messages[1].content).days as { day: string; candidates: { candidate_id: string }[] }[];
    expect(days.map((day) => day.day)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(days.every((day) => day.candidates.length > 0)).toBe(true);

    expect(week.adapterId).toBe("model");
    expect(dayByKey(week, "mon")!.piece!.id).toBe("mon-gym");
    expect(dayByKey(week, "tue")!.piece!.id).toBe("tue-skill");
    expect(dayByKey(week, "mon")!.piece!.stimulus).toBe("고반복");
    expect(dayByKey(week, "tue")!.piece!.stimulus).toBe("기술");
    expect(dayByKey(week, "wed")!.piece!.stimulus).toBeNull();
    expect(dayByKey(week, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual(
      buildWeek(built).days.find((day) => day.day === "mon")!.lift!.sets.map((set) => set.weightKg),
    );
    expect(dayByKey(week, "mon")!.lift!.trainingMaxKg).toBe(180);
    expect(weekTextHasNoKm(week)).toBe(true);

    const empty = input({ weekIndex: 1, sex: null, maxes: {} });
    const emptyFetch = vi.fn(async () => envelope(ALT_WEEK));
    const emptyWeek = await resolvePlannedWeek(empty, { key: KEY, fetchImpl: emptyFetch });
    expect(emptyFetch).toHaveBeenCalledTimes(1);
    expect(dayByKey(emptyWeek, "mon")!.piece!.id).toBe("mon-gym");
    expect(dayByKey(emptyWeek, "mon")!.lift!.sets.map((set) => set.weightKg)).toEqual([null, null, null]);
    expect(JSON.stringify(dayByKey(emptyWeek, "mon")!.lift)).not.toMatch(/"weightKg":\s*\d/);
  });

  it("falls back to the rules week when the id is unknown, the JSON is bad, or a rule breaks", async () => {
    const built = weekInput();
    const rules = buildWeek(built);

    const unknown = vi.fn(async () =>
      envelope(ALT_WEEK.map((pick) => (pick.day === "mon" ? { day: "mon", candidate_id: "not-a-candidate" } : pick))),
    );
    const unknownWeek = await resolvePlannedWeek(built, { key: KEY, fetchImpl: unknown });
    expect(unknown).toHaveBeenCalledTimes(1);
    expect(unknownWeek).toEqual(rules);

    const prose = vi.fn(async () => envelopeText("20분 AMRAP\n런 400m\n버피 8"));
    const proseWeek = await resolvePlannedWeek(built, { key: KEY, fetchImpl: prose });
    expect(prose).toHaveBeenCalledTimes(1);
    expect(proseWeek).toEqual(rules);

    const broken = vi.fn(async () =>
      envelope(ALT_WEEK.map((pick) => (pick.day === "tue" ? { day: "tue", candidate_id: "tue-gym" } : pick))),
    );
    const brokenWeek = await resolvePlannedWeek(built, { key: KEY, fetchImpl: broken });
    expect(broken).toHaveBeenCalledTimes(1);
    expect(brokenWeek).toEqual(rules);
    expect(dayByKey(brokenWeek, "mon")!.piece!.id).toBe("mon-engine");

    const http = vi.fn(async () => new Response("no", { status: 500 }));
    expect(await resolvePlannedWeek(built, { key: KEY, fetchImpl: http })).toEqual(rules);

    const timeout = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        const fail = () => reject(new DOMException("aborted", "AbortError"));
        if (init?.signal?.aborted) fail();
        else init?.signal?.addEventListener("abort", fail, { once: true });
      });
    });
    expect(await resolvePlannedWeek(built, { key: KEY, fetchImpl: timeout, timeoutMs: 20 })).toEqual(rules);
  });

  it("keeps sex on wall ball, kettlebell, and box height, and blocks a repeated signature", () => {
    const benchmark = (sex: WeekBuildInput["sex"]): MetconRequest => ({
      weekIndex: 4,
      day: "thu",
      sex,
      avoidPatterns: [],
      avoidStimuli: [],
      allowHeavy: true,
      longPiece: false,
      forbid: [],
    });
    const male = listStructuralMetcons(benchmark("m"));
    const female = listStructuralMetcons(benchmark("f"));
    const plain = listStructuralMetcons(benchmark(null));
    expect(male.map((piece) => piece.id)).toEqual(["sl-month-benchmark"]);
    expect(female.map((piece) => piece.id)).toEqual(["sl-month-benchmark"]);
    expect(male[0]!.bodyKo).toMatch(/9kg/);
    expect(female[0]!.bodyKo).toMatch(/6kg/);
    expect(plain[0]!.bodyKo).not.toMatch(/\d+(\.\d+)?\s*kg/);
    expect(male[0]!.stimulus).toBeNull();

    const tue = listStructuralMetcons({
      weekIndex: 4,
      day: "tue",
      sex: "m",
      avoidPatterns: [],
      avoidStimuli: [],
      allowHeavy: false,
      longPiece: false,
      forbid: ["snatch", "clean", "deadlift"],
    });
    expect(tue.some((piece) => piece.stimulus === "고중량")).toBe(false);
    expect(tue.find((piece) => piece.bodyKo.includes("박스"))!.bodyKo).toMatch(/60cm/);

    const sat = listStructuralMetcons({
      weekIndex: 1,
      day: "sat",
      sex: "f",
      avoidPatterns: [],
      avoidStimuli: [],
      allowHeavy: false,
      longPiece: false,
      forbid: [],
    });
    expect(sat.find((piece) => piece.bodyKo.includes("케틀벨"))!.bodyKo).toMatch(/16kg/);

    for (const weekIndex of [1, 2, 3, 4] as const) {
      for (const slot of weekMetconSlots(weekIndex)) {
        const pieces = listStructuralMetcons({
          weekIndex,
          day: slot.day,
          sex: "m",
          avoidPatterns: [],
          avoidStimuli: [],
          allowHeavy: slot.allowHeavy,
          longPiece: slot.longPiece,
          forbid: slot.forbid,
        });
        expect(pieces.length).toBeGreaterThan(0);
        for (const piece of pieces) {
          expect(piece.bodyKo).not.toMatch(/km/i);
          if (slot.longPiece) {
            expect(piece.minutes).toBeGreaterThanOrEqual(30);
            expect(piece.minutes).toBeLessThanOrEqual(40);
            expect(piece.stimulus).toBeNull();
          }
          if (!slot.allowHeavy) expect(piece.stimulus).not.toBe("고중량");
        }
      }
    }

    const built = weekInput();
    const monday = dayByKey(buildWeek(built), "mon")!.piece!;
    expect(acceptCandidateIds(built, ALT_WEEK, [monday.signature])).not.toBeNull();
    const repeated = acceptCandidateIds(
      built,
      ALT_WEEK.map((pick) => (pick.day === "mon" ? { day: "mon", candidate_id: monday.id } : pick)),
      [monday.signature],
    );
    expect(repeated).toBeNull();
  });

  it("rejects free text that is not a candidate id list", () => {
    expect(parseCandidatePicks({ choices: [{ message: { content: "런 1600m 팬바이크" } }] })).toBeNull();
    expect(parseCandidatePicks({ choices: [{ message: { content: JSON.stringify({ workout: "AMRAP" }) } }] })).toBeNull();
    expect(parseCandidatePicks({ choices: [{ message: { content: JSON.stringify({ picks: ALT_WEEK }) } }] })).toEqual(ALT_WEEK);
  });
});

function envelopeText(content: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
}

function weekTextHasNoKm(week: ReturnType<typeof buildWeek>): boolean {
  return !JSON.stringify(week).match(/km/i);
}
