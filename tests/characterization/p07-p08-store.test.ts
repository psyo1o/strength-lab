import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDbConnection } from "../../src/lib/db/client";
import { ensureClassWeekForStart, getClassPlanByStart } from "../../src/lib/month-plan/class-week";
import { ensureProgrammingWeek } from "../../src/lib/programming/engine";
import { insertProgrammingWeek, listProgrammingWeekAttempts } from "../../src/lib/programming/store";
import { fetchFor, month531, NOW } from "./support";

function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sl-char-"));
  process.env.DATABASE_PATH = path.join(dir, "app.db");
  process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  delete process.env.MONTH_PLAN_MODEL_KEY;
  delete process.env.COACHING_PIPELINE;
  delete process.env.LONGITUDINAL_PLANNING;
  delete process.env.COACH_MODEL_PROVIDER;
  resetDbConnection();
}

describe("특성화 P7 P8", () => {
  beforeEach(() => {
    freshDb();
  });

  /**
   * P7. 근거 engine.ts:687-689, class-week.ts:122-126.
   * 현재 동작: 활성 행이 없으면 실패 행을 돌려주고, class_weeks가 비어 있으면 그 실패 행을 화면에 복사한다.
   * 목표 동작: 실패 행은 class_weeks로 복사하지 않는다. 아직 구현하지 않는다.
   */
  it("P7: 실패 행이 ensureClassWeekForStart에서 class_weeks로 동기화된다", async () => {
    const weekStart = "2099-07-06";
    expect(getClassPlanByStart(weekStart)).toBeNull();
    process.env.MONTH_PLAN_MODEL_KEY = "sk-test";
    const original = globalThis.fetch;
    globalThis.fetch = fetchFor({
      month: month531(),
      weekIndex: 1,
      monthly: "valid",
      weekly: "valid",
      head: "block",
    }) as typeof fetch;
    try {
      const stored = await ensureClassWeekForStart(weekStart, NOW);
      const attempts = listProgrammingWeekAttempts(weekStart);
      const failed = attempts.find((row) => row.status === "failed");
      expect(failed).toBeTruthy();
      expect(attempts.some((row) => row.status === "active")).toBe(false);
      expect(stored.weekStart).toBe(weekStart);
      expect(getClassPlanByStart(weekStart)?.weekStart).toBe(weekStart);
    } finally {
      globalThis.fetch = original;
      delete process.env.MONTH_PLAN_MODEL_KEY;
    }
  });

  /**
   * P8. 근거 store.ts:522-524.
   * 현재 동작: create인데 활성 행이 있으면 새 결과를 failed로 넣고, 예외 없이 기존 활성 행을 돌려준다.
   * 목표 동작: 호출자가 새 결과가 버려졌는지 구분할 수 있어야 한다. 아직 구현하지 않는다.
   */
  it("P8: mode=create에서 활성 행이 있으면 새 결과는 failed로 들어가고 기존 행이 반환되며 구분 신호가 없다", async () => {
    const weekStart = "2099-07-06";
    const first = await ensureProgrammingWeek(weekStart, { key: null, nowMs: NOW });
    expect(first.status).toBe("active");
    const draft = structuredClone(first.draft);
    draft.intent = { ...draft.intent, why_ko: "새 결과" };
    const returned = insertProgrammingWeek({
      monthId: first.monthId,
      weekIndex: first.weekIndex,
      weekStart,
      draft,
      display: first.display,
      inputSummaryJson: first.inputSummaryJson,
      mode: "create",
      generationSource: "model",
      fallbackReason: null,
      generatedAt: first.generatedAt + 1,
      modelName: "test-double",
      promptVersion: first.promptVersion,
      rulesVersion: first.rulesVersion,
      inputSummaryVersion: first.inputSummaryVersion,
      generationAttempt: first.generationAttempt + 1,
      responses: [],
    });
    expect(returned.id).toBe(first.id);
    expect(returned.status).toBe("active");
    expect(returned.generationSource).toBe(first.generationSource);
    expect(returned.generatedAt).toBe(first.generatedAt);
    expect("created" in returned).toBe(false);
    const failed = listProgrammingWeekAttempts(weekStart).find((row) => row.status === "failed");
    expect(failed?.generationSource).toBe("model");
    expect(failed?.draft.intent.why_ko).toBe("새 결과");
    expect(failed?.id).not.toBe(returned.id);
  });
});
