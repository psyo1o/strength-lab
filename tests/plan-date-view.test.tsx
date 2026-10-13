import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerUser } from "../src/lib/auth";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { GeneratedWeekList, PlanDayStatus, PlanWeekScreen } from "../src/components/PlanDateBrowse";
import {
  PLAN_FAILED_RULES_KO,
  PLAN_NOT_GENERATED_KO,
  PLAN_READY_KO,
  SOURCE_MODEL_KO,
  SOURCE_NONE_KO,
  SOURCE_RULES_KO,
  failureSummaryKo,
  isPlanDate,
  listGeneratedWeekLinks,
  loadPlanScreen,
  mondayOf,
  readClassDayBrowse,
  readWeekBrowse,
  shiftWeek,
} from "../src/lib/month-plan/plan-browse";
import type { DayKey, PlannedWeek } from "../src/lib/month-plan/types";
import * as engine from "../src/lib/programming/engine";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (url: string) => {
    throw new Error(`redirect ${url}`);
  },
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/auth")>();
  return { ...actual, getCurrentUser: vi.fn() };
});

import { getCurrentUser } from "@/lib/auth";
import ClassDayPage from "@/app/(app)/plan/w/[weekStart]/[day]/page";

const WEEK = "2099-07-06";
const DATE = "2099-07-08";
const NOW = Date.parse("2099-07-08T00:00:00.000Z");
const SECRET = "실패행비밀운동";
const PUBLIC = "회원공개운동";
const AT = Date.parse("2099-07-06T00:00:00.000Z");

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-plan-date-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.XAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  resetDbConnection();
}

function counts() {
  const db = getSqlite();
  const weeks = (db.prepare("SELECT COUNT(*) AS c FROM programming_weeks").get() as { c: number }).c;
  const classes = (db.prepare("SELECT COUNT(*) AS c FROM class_weeks").get() as { c: number }).c;
  const charges = (db.prepare("SELECT COUNT(*) AS c FROM generation_charges").get() as { c: number }).c;
  return { weeks, classes, charges };
}

function planned(name: string, days: DayKey[]): PlannedWeek {
  return {
    weekIndex: 1,
    source: "rules",
    adapterId: "rules",
    bodyBudgetMin: 90,
    days: days.map((day) => ({
      day,
      labelKo: "수요일",
      optional: false,
      rest: false,
      longPiece: false,
      scheduled: true,
      blocks: [{ role: "metcon" as const, titleKo: "메트콘", bodyKo: name, minutes: 12, cuttable: true, kept: true }],
      piece: {
        id: "piece",
        named: false,
        nameKo: name,
        format: "amrap" as const,
        minutes: 12,
        pattern: "engine" as const,
        movements: [],
        signature: "sig",
        bodyKo: name,
        stimulus: null,
      },
      lift: null,
    })),
  };
}

function seedMonth(): number {
  const info = getSqlite()
    .prepare(
      `INSERT INTO programming_months (
         month_start, scheme, direction_json, input_summary_json, generation_source,
         generated_at, engine_version, created_at, status, generation_version, generation_attempt,
         prompt_version, rules_version, generation_timestamp, input_summary_version
       ) VALUES ('2099-07-01', 'block', '{}', '{}', 'fallback', ?, 'test', ?, 'active', 1, 1, 'monthly-program-v4', 'rules', ?, 'v1')`,
    )
    .run(AT, AT, AT);
  return Number(info.lastInsertRowid);
}

function seedWeek(input: {
  monthId: number;
  weekStart: string;
  status: "active" | "failed";
  source: "model" | "fallback";
  reason: string | null;
  prompt: string;
  display: PlannedWeek;
  plan?: unknown;
}) {
  getSqlite()
    .prepare(
      `INSERT INTO programming_weeks (
         month_id, week_index, week_start, intent_json, plan_json, display_json, input_summary_json,
         generation_source, fallback_reason, generated_at, engine_version, created_at,
         status, generation_version, generation_attempt, prompt_version, rules_version,
         generation_timestamp, input_summary_version
       ) VALUES (?, 1, ?, '{}', ?, ?, '{}', ?, ?, ?, 'test', ?, ?, 1, 1, ?, 'rules', ?, 'v1')`,
    )
    .run(
      input.monthId,
      input.weekStart,
      JSON.stringify(input.plan ?? { intent: { why_ko: "", focus: "", scheme_note: "" }, sessions: [] }),
      JSON.stringify(input.display),
      input.source,
      input.reason,
      AT,
      AT,
      input.status,
      input.prompt,
      AT,
    );
}

function seedClass(weekStart: string, display: PlannedWeek) {
  getSqlite()
    .prepare("INSERT INTO class_weeks (week_index, week_start, sex, plan_json, created_at) VALUES (1, ?, 'm', ?, ?)")
    .run(weekStart, JSON.stringify(display), AT);
}

describe("plan date view", () => {
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    freshDb();
    spy = vi.spyOn(engine, "ensureProgrammingWeek");
    vi.mocked(getCurrentUser).mockReset();
  });

  afterEach(() => {
    spy.mockRestore();
    resetDbConnection();
  });

  it("maps a 2099 date onto its Monday and does not treat a bad date as a plan date", () => {
    expect(mondayOf(DATE)).toBe(WEEK);
    expect(mondayOf("2099-07-12")).toBe(WEEK);
    expect(shiftWeek(WEEK, 1)).toBe("2099-07-13");
    expect(shiftWeek(WEEK, -1)).toBe("2099-06-29");
    expect(isPlanDate(DATE)).toBe(true);
    expect(isPlanDate("2099-02-31")).toBe(false);
    expect(failureSummaryKo("final_validation_failed")).toBe("최종 검증 실패");
    expect(failureSummaryKo("no_model;too_similar")).toBe("모델을 부르지 않음, 최근 주와 너무 비슷함");
  });

  it("reads a missing 2099 week without a generation call", async () => {
    const created = registerUser("member-2099@example.com", "password123");
    if ("error" in created) throw new Error("register failed");
    vi.mocked(getCurrentUser).mockReturnValue(created.user);
    const before = counts();
    const loaded = await loadPlanScreen({
      date: DATE,
      userId: created.user.id,
      isAdmin: false,
      nowMs: NOW,
    });
    await ClassDayPage({ params: Promise.resolve({ weekStart: WEEK, day: "wed" }) });
    expect(spy).not.toHaveBeenCalled();
    expect(counts()).toEqual(before);
    expect(before).toEqual({ weeks: 0, classes: 0, charges: 0 });
    const html = renderToStaticMarkup(<PlanWeekScreen browse={loaded.browse} />);
    expect(html).toContain(PLAN_NOT_GENERATED_KO);
    expect(html).toContain("이전 주");
    expect(html).toContain("다음 주");
    expect(html).toContain(`href="/plan?date=2099-06-29"`);
    expect(html).toContain(`href="/plan?date=2099-07-13"`);
    expect(html).toContain(`href="/plan?date=${DATE}"`);
    expect(html).toContain("오늘");
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("이 주 수정");
    expect(loaded.today).toBeNull();
    expect(loaded.browse.admin).toBeNull();
  });

  it("shows a model week and hides a failed row from the member", () => {
    const created = registerUser("viewer-2099@example.com", "password123");
    if ("error" in created) throw new Error("register failed");
    const monthId = seedMonth();
    const modelName = PUBLIC;
    const modelWeek = planned(modelName, ["mon", "tue", "wed"]);
    seedWeek({
      monthId,
      weekStart: WEEK,
      status: "active",
      source: "model",
      reason: null,
      prompt: "coaching-pipeline-v6",
      display: modelWeek,
      plan: {
        intent: {
          why_ko: "",
          focus: "",
          scheme_note: "",
          plan: {
            day_sources: { mon: "model", tue: "fallback" },
            day_records: { wed: { day_status: "FAILED" } },
          },
        },
        sessions: [],
      },
    });
    seedClass(WEEK, modelWeek);
    seedWeek({
      monthId,
      weekStart: "2099-07-13",
      status: "failed",
      source: "fallback",
      reason: "final_validation_failed",
      prompt: "coaching-pipeline-v6",
      display: planned(SECRET, ["mon"]),
    });

    const member = readWeekBrowse({ date: DATE, userId: created.user.id, isAdmin: false, nowMs: NOW });
    const memberHtml = renderToStaticMarkup(<PlanWeekScreen browse={member} />);
    expect(memberHtml).toContain(PUBLIC);
    expect(memberHtml).toContain(SOURCE_MODEL_KO);
    expect(memberHtml).toContain(PLAN_FAILED_RULES_KO);
    expect(memberHtml).toContain(PLAN_READY_KO);
    expect(memberHtml).not.toContain(SECRET);
    expect(member.days.find((day) => day.day === "mon")?.sourceKo).toBe(SOURCE_MODEL_KO);
    expect(member.days.find((day) => day.day === "mon")?.statusKo).toBe(PLAN_READY_KO);
    expect(member.days.find((day) => day.day === "tue")?.statusKo).toBe(PLAN_FAILED_RULES_KO);
    expect(member.days.find((day) => day.day === "tue")?.sourceKo).toBe(SOURCE_RULES_KO);
    expect(member.days.find((day) => day.day === "wed")?.statusKo).toBe(PLAN_FAILED_RULES_KO);
    expect(member.days.find((day) => day.day === "thu")?.statusKo).toBe(PLAN_NOT_GENERATED_KO);
    expect(member.days.find((day) => day.day === "thu")?.sourceKo).toBe(SOURCE_NONE_KO);

    const hidden = readWeekBrowse({ date: "2099-07-13", userId: created.user.id, isAdmin: false, nowMs: NOW });
    const hiddenHtml = renderToStaticMarkup(<PlanWeekScreen browse={hidden} />);
    expect(hiddenHtml).toContain(PLAN_NOT_GENERATED_KO);
    expect(hiddenHtml).not.toContain(SECRET);
    expect(hiddenHtml).not.toContain(PLAN_FAILED_RULES_KO);

    const admin = readWeekBrowse({ date: "2099-07-13", userId: created.user.id, isAdmin: true, nowMs: NOW });
    const adminHtml = renderToStaticMarkup(<PlanWeekScreen browse={admin} />);
    expect(adminHtml).toContain(SECRET);
    expect(adminHtml).toContain(PLAN_FAILED_RULES_KO);
    expect(adminHtml).toContain(SOURCE_RULES_KO);
    expect(adminHtml).toContain("상태 실패");
    expect(adminHtml).toContain("프롬프트 버전 coaching-pipeline-v6");
    expect(adminHtml).toContain("최종 검증 실패");
    expect(adminHtml).toContain('href="/admin/wod?week=2099-07-13"');
    expect(adminHtml).toContain("2099-07-06 09:00 KST");

    const day = readClassDayBrowse({
      weekStart: "2099-07-13",
      day: "mon",
      userId: created.user.id,
      isAdmin: false,
      nowMs: NOW,
    });
    const dayHtml = renderToStaticMarkup(
      <PlanDayStatus
        labelKo={day.labelKo}
        date={day.date}
        statusKo={day.statusKo}
        sourceKo={day.sourceKo}
        blocks={day.adminFailedDay?.blocks ?? null}
      />,
    );
    expect(day.memberDay).toBeNull();
    expect(day.adminFailedDay).toBeNull();
    expect(dayHtml).toContain(PLAN_NOT_GENERATED_KO);
    expect(dayHtml).not.toContain(SECRET);

    const links = listGeneratedWeekLinks();
    expect(links.map((week) => week.weekStart)).toEqual(["2099-07-13", WEEK]);
    expect(links[0]?.statusKo).toBe("실패");
    expect(links[1]?.statusKo).toBe("활성");
    expect(links[1]?.sourceKo).toBe(SOURCE_MODEL_KO);
    const listHtml = renderToStaticMarkup(<GeneratedWeekList weeks={links} />);
    expect(listHtml).toContain('href="/plan?date=2099-07-06"');
    expect(listHtml).toContain("날짜별 보기");
    expect(spy).not.toHaveBeenCalled();
  });
});
