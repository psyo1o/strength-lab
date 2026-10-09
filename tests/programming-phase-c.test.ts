import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { reviewActiveWeek } from "../src/lib/programming/coaching/phase-c/active";
import { applyAcceptedPatches, parseHeadChoice, parseSpecialistReview } from "../src/lib/programming/coaching/phase-c/logic";
import { runPhaseCReview } from "../src/lib/programming/coaching/phase-c/run";
import type { PhaseCPacket, PhaseCProposal } from "../src/lib/programming/coaching/phase-c/logic";
import type { SessionDraft } from "../src/lib/programming/types";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-phase-c-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  resetDbConnection();
  getSqlite();
}

function chat(body: unknown, status = 200): Response {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(body) } }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function session(amount = "30sec"): SessionDraft {
  return {
    day: "mon",
    rest: false,
    optional: false,
    warmup_min: 5,
    warmup_ko: "준비합니다.",
    strength: null,
    conditioning: {
      benchmark: false,
      format: "intervals",
      time_domain: "medium",
      stimulus: "high_rep",
      movement_patterns: ["engine"],
      movements: [
        { key: "double_under", amount, name_ko: "더블언더" },
        { key: "burpee", amount: "8", name_ko: "버피" },
      ],
      equipment: ["jump_rope", "bodyweight"],
      rep_structure: "12분 인터벌.",
      work_rest_structure: "30초 일하고 30초 쉽니다.",
      duration_min: 12,
      volume: "moderate",
      intensity: "moderate",
      long_conditioning: false,
      purpose: "일과 쉼으로 이어 갑니다.",
    },
    strength_purpose: null,
    strength_volume: null,
    strength_intensity: null,
    metcon_purpose: "일과 쉼으로 이어 갑니다.",
    metcon_format: "intervals",
    time_domain: "medium",
    stimulus: "high_rep",
    movement_combination: "더블언더와 버피",
    equipment: ["jump_rope", "bodyweight"],
    volume: "moderate",
    intensity: "moderate",
    expected_duration: 12,
  };
}

function packet(amount = "30sec"): PhaseCPacket {
  return {
    week_start: "2099-07-06",
    month: { scheme: "volume", strength_method: "ACCUMULATION", focus_ko: "축적", why_ko: "볼륨을 쌓습니다." },
    thesis: "이번 주는 축적입니다.",
    gaps: ["회원 1RM은 없다."],
    days: [{ day: "mon", intent: null, lock: null, session: session(amount) }],
  };
}

function pass(role: "programming" | "strength_fatigue" | "execution") {
  return {
    role,
    days: [
      {
        day: "mon",
        verdict: "PASS",
        problem: "",
        severity: "low",
        evidence: "",
        intent_impact: "",
        uncertainty: "",
        proposal: null,
      },
    ],
  };
}

function clockProposal(role: "execution" | "strength_fatigue" = "execution") {
  return {
    role,
    days: [
      {
        day: "mon",
        verdict: "SUGGEST_REVISION",
        problem: "30초 작업에 더블언더 30초와 버피가 같이 있다.",
        severity: "moderate",
        evidence: "작업 문구는 30초이고 더블언더 양이 30sec다.",
        intent_impact: "버피를 같은 작업에서 끝내기 어렵다.",
        uncertainty: "선수 페이스는 패킷에 없다.",
        proposal: {
          target: "interval_clock",
          movement_key: "double_under",
          before: "30초 일하고 30초 쉽니다.",
          after: "45초 일하고 30초 쉽니다.",
          work_sec: 45,
          rest_sec: 30,
          reason: "버피까지 넣으려면 작업 창이 더 필요하다.",
          expected_effect: "두 동작을 한 작업 안에서 끝낼 수 있다.",
          downside: "라운드 수가 줄어 밀도가 낮아진다.",
          skeleton_impact: "none",
        },
      },
    ],
  };
}

function head(decision: string, accepted: unknown[], rejected: unknown[] = []) {
  return {
    decision,
    rationale: "실행 가능성과 의도를 비교해 결정했습니다.",
    accepted,
    rejected,
  };
}

function scripted(bodies: unknown[]) {
  const queue = [...bodies];
  return async () => {
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return chat(next);
  };
}

describe("phase C coach review", () => {
  afterEach(() => {
    delete process.env.MONTH_PLAN_MODEL_KEY;
    resetDbConnection();
  });

  it("keeps the original when every coach passes", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      const role = calls === 1 ? "programming" : calls === 2 ? "strength_fatigue" : "execution";
      return chat(pass(role));
    };
    const run = await runPhaseCReview({ packet: packet(), key: "test-key", fetchImpl });
    expect(run.decision).toBe("APPROVE_ORIGINAL");
    expect(run.changes).toEqual([]);
    expect(run.confirmed).toEqual(run.original);
    expect(calls).toBe(3);
    expect(run.validation.ok).toBe(true);
  });

  it("stores a concrete proposal and applies it only when the head coach accepts", async () => {
    const original = packet().days[0]!.session.conditioning!.work_rest_structure;
    const run = await runPhaseCReview({
      packet: packet(),
      key: "test-key",
      fetchImpl: scripted([
        pass("programming"),
        pass("strength_fatigue"),
        clockProposal(),
        head("APPROVE_REVISED", [{ role: "execution", day: "mon" }]),
      ]),
    });
    expect(run.proposals).toHaveLength(1);
    expect(run.decision).toBe("APPROVE_REVISED");
    expect(run.changes[0]?.after).toBe("45초 일하고 30초 쉽니다.");
    expect(run.original[0]?.work_rest).toBe(original);
    expect(run.confirmed?.[0]?.work_rest).toBe("45초 일하고 30초 쉽니다.");
    expect(run.validation.ok).toBe(true);
  });

  it("keeps the original when the head coach rejects the proposal", async () => {
    const run = await runPhaseCReview({
      packet: packet(),
      key: "test-key",
      fetchImpl: scripted([
        pass("programming"),
        pass("strength_fatigue"),
        clockProposal(),
        head("APPROVE_ORIGINAL", [], [{ role: "execution", day: "mon", reason: "취향 차이라 원본 의도를 유지합니다." }]),
      ]),
    });
    expect(run.decision).toBe("APPROVE_ORIGINAL");
    expect(run.changes).toEqual([]);
    expect(run.rejected[0]?.reason).toMatch(/취향/);
    expect(run.confirmed).toEqual(run.original);
  });

  it("records both sides when coaches disagree", async () => {
    const run = await runPhaseCReview({
      packet: packet(),
      key: "test-key",
      fetchImpl: scripted([
        pass("programming"),
        clockProposal("strength_fatigue"),
        clockProposal("execution"),
        head(
          "PARTIAL_REVISION",
          [{ role: "execution", day: "mon" }],
          [{ role: "strength_fatigue", day: "mon", reason: "같은 시계 조정이 이미 채택되었습니다." }],
        ),
      ]),
    });
    expect(run.decision).toBe("PARTIAL_REVISION");
    expect(run.proposals).toHaveLength(2);
    expect(run.changes).toHaveLength(1);
    expect(run.rejected).toHaveLength(1);
    expect(run.rationale).toMatch(/결정/);
  });

  it("does not approve a locked-field change and stops after two validation attempts", async () => {
    const locked = clockProposal();
    (locked.days[0].proposal as { duration_min: number }).duration_min = 40;
    let headCalls = 0;
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content?: string }> };
      const system = body.messages?.[0]?.content ?? "";
      if (system.includes("programming coach")) return chat(pass("programming"));
      if (system.includes("strength and fatigue")) return chat(pass("strength_fatigue"));
      if (system.includes("execution coach")) return chat(locked);
      headCalls += 1;
      return chat(head("APPROVE_REVISED", [{ role: "execution", day: "mon" }]));
    };
    const run = await runPhaseCReview({ packet: packet(), key: "test-key", fetchImpl });
    expect(run.decision).toBe("NEEDS_REVIEW");
    expect(run.changes).toEqual([]);
    expect(run.confirmed).toBeNull();
    expect(run.validation.attempts).toBe(2);
    expect(run.validation.errors.join(" ")).toMatch(/duration_min is locked/);
    expect(headCalls).toBe(2);
    expect(packet().days[0]!.session.conditioning!.duration_min).toBe(12);
  });

  it("leaves the original in place when the model call fails", async () => {
    const source = packet();
    const before = JSON.stringify(source);
    const run = await runPhaseCReview({
      packet: source,
      key: "test-key",
      fetchImpl: async () => {
        throw new Error("socket down");
      },
    });
    expect(run.decision).toBe("NEEDS_REVIEW");
    expect(run.failure_reason).toBeTruthy();
    expect(run.changes).toEqual([]);
    expect(run.confirmed).toBeNull();
    expect(JSON.stringify(source)).toBe(before);
  });

  it("does not rewrite a stored week and does not review the same sessions twice", async () => {
    freshDb();
    const db = getSqlite();
    const now = Date.now();
    const plan = {
      intent: { why_ko: "축적", focus: "volume", scheme_note: "유지" },
      sessions: [session()],
    };
    const month = db
      .prepare(
        `INSERT INTO programming_months (
          month_start, scheme, direction_json, input_summary_json, generation_source, generated_at, engine_version, created_at,
          prompt_version, rules_version, generation_timestamp, input_summary_version
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("2099-07-01", "volume", JSON.stringify({ scheme: "volume", strength_method: "ACCUMULATION", focus_ko: "축적", why_ko: "볼륨" }), "{}", "model", now, "test", now, "test", "test", now, "test");
    db.prepare(
      `INSERT INTO programming_weeks (
        month_id, week_index, week_start, intent_json, plan_json, display_json, input_summary_json, generation_source,
        generated_at, engine_version, created_at, prompt_version, rules_version, generation_timestamp, input_summary_version
      ) VALUES (?, 1, ?, ?, ?, ?, ?, 'fallback', ?, 'test', ?, 'test', 'test', ?, 'test')`,
    ).run(month.lastInsertRowid, "2099-07-06", JSON.stringify({ why_ko: "축적", focus: "volume", scheme_note: "유지", plan: { days: [] } }), JSON.stringify(plan), "{}", "{}", now, now, now);
    const before = db.prepare(`SELECT plan_json FROM programming_weeks WHERE week_start = ?`).get("2099-07-06") as { plan_json: string };
    const fetchImpl = async () => chat(pass("programming"));
    const sequenced = (() => {
      let n = 0;
      return async () => {
        n += 1;
        const role = n % 3 === 1 ? "programming" : n % 3 === 2 ? "strength_fatigue" : "execution";
        return chat(pass(role));
      };
    })();
    const first = await reviewActiveWeek({ weekStart: "2099-07-06", key: "test-key", fetchImpl: sequenced });
    const second = await reviewActiveWeek({ weekStart: "2099-07-06", key: "test-key", fetchImpl });
    const after = db.prepare(`SELECT plan_json FROM programming_weeks WHERE week_start = ?`).get("2099-07-06") as { plan_json: string };
    const logs = db.prepare(`SELECT COUNT(*) AS n FROM programming_generation_logs WHERE scope_key = ?`).get("2099-07-06") as { n: number };
    expect(first.decision).toBe("APPROVE_ORIGINAL");
    expect(second.duplicate).toBe(true);
    expect(second.calls).toBe(0);
    expect(after.plan_json).toBe(before.plan_json);
    expect(logs.n).toBe(1);
    await expect(reviewActiveWeek({ weekStart: "2026-10-05", key: "test-key", fetchImpl })).rejects.toThrow(/refuses/);
  });

  it("rejects an impossible amount before it can become the confirmed piece", () => {
    const proposal = {
      role: "execution" as const,
      day: "mon" as const,
      target: "amount" as const,
      movement_key: "row",
      before: "500m",
      after: "10000m",
      replacement_key: null,
      work_sec: null,
      rest_sec: null,
      reason: "더 길게",
      expected_effect: "없음",
      downside: "끝낼 수 없다",
      skeleton_impact: "none" as const,
      duration_min: null,
      problem: "거리",
      severity: "high" as const,
      evidence: "10분",
      intent_impact: "수행 불가",
      uncertainty: "",
    } satisfies PhaseCProposal;
    const row = session();
    row.conditioning!.movements = [
      { key: "row", amount: "500m", name_ko: "로잉" },
      { key: "burpee", amount: "8", name_ko: "버피" },
    ];
    row.conditioning!.format = "for_time";
    row.conditioning!.equipment = ["rower", "bodyweight"];
    const result = applyAcceptedPatches({
      packet: { ...packet(), days: [{ day: "mon", intent: null, lock: null, session: row }] },
      proposals: [proposal],
      accepted: [{ role: "execution", day: "mon" }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toMatch(/cannot be finished/);
    expect(parseSpecialistReview(pass("programming"), "programming").ok).toBe(true);
    expect(parseHeadChoice(head("NEEDS_REVIEW", [])).ok).toBe(true);
  });
});
