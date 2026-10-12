import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  advanceAfterRevalidation,
  assessRepairs,
  classifyWeekOrigin,
  decideModelAdoption,
  judgeFallback,
  judgeNoModel,
  makeIssue,
  persistApproved,
  repairKindsForCode,
  repairRequestFitsIssue,
  transitionGenerationStatus,
  WARNING_POLICY,
  type ModelAdoptionInput,
  type RepairRequest,
  type RepairResult,
} from "../src/lib/programming/v2";

function ready(overrides: Partial<ModelAdoptionInput> = {}): ModelAdoptionInput {
  return {
    origin: "model",
    status: "validated",
    requiredDaysValid: true,
    weekStructureValid: true,
    lockedSkeletonHeld: true,
    issues: [],
    repairRequests: [],
    repairResults: [],
    head: "approve",
    ...overrides,
  };
}

const amountRequest: RepairRequest = {
  kind: "field_edit",
  issueCode: "amount.out_of_range",
  day: "mon",
  fieldPath: "conditioning.amount",
  allowedFields: ["conditioning.amount"],
};

function amountResult(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    request: amountRequest,
    applied: true,
    changedFields: ["conditioning.amount"],
    unexpectedFields: [],
    revalidation: "passed",
    ...overrides,
  };
}

describe("아키텍처 v2 계약", () => {
  it("초안은 승인으로 바로 넘어가지 않는다", () => {
    const direct = transitionGenerationStatus("draft", "approved");
    expect(direct.ok).toBe(false);
    if (!direct.ok) expect(direct.code).toBe("state.forbidden_transition");
    const judged = decideModelAdoption(ready({ status: "draft" }));
    expect(judged.adopted).toBe(false);
    expect(judged.modelSuccess).toBe(false);
    expect(judged.status).toBe("draft");
    expect(judged.issueCodes).toContain("state.draft_not_approvable");
  });

  it("하드 오류가 남으면 모델 주를 채택하지 않는다", () => {
    const issue = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "field",
      day: "mon",
      fieldPath: "conditioning.amount",
      message: "수량이 범위를 벗어났다",
      expected: "허용 범위",
      actual: "범위 밖",
    });
    const judged = decideModelAdoption(ready({ issues: [issue] }));
    expect(judged.adopted).toBe(false);
    expect(judged.status).not.toBe("approved");
    expect(judged.issueCodes).toContain("amount.out_of_range");
  });

  it("경고만 있으면 하드 오류가 없을 때의 정책대로 채택한다", () => {
    expect(WARNING_POLICY.blocksAdoption).toBe(false);
    const warning = makeIssue({
      code: "similarity.over_threshold",
      severity: "warning",
      scope: "day",
      day: "tue",
      message: "구조가 가깝다",
      expected: "임계값 미만",
      actual: "임계값",
    });
    const judged = decideModelAdoption(ready({ issues: [warning], head: "approve_with_note" }));
    expect(judged.adopted).toBe(true);
    expect(judged.modelSuccess).toBe(true);
    expect(judged.status).toBe("approved");
    expect(judged.origin).toBe("model");
  });

  it("헤드의 수정 요청만으로는 채택되지 않는다", () => {
    const judged = decideModelAdoption(ready({ head: "adjust" }));
    expect(judged.adopted).toBe(false);
    expect(judged.modelSuccess).toBe(false);
    expect(judged.status).toBe("needs_repair");
    expect(judged.issueCodes).toContain("head.adjust");
  });

  it("수정 요청 뒤 바뀐 필드가 없으면 수정 완료가 아니다", () => {
    const judged = decideModelAdoption(
      ready({
        repairRequests: [amountRequest],
        repairResults: [amountResult({ applied: true, changedFields: [] })],
      }),
    );
    expect(judged.adopted).toBe(false);
    expect(judged.issueCodes).toContain("repair.not_applied");
  });

  it("요청하지 않은 필드가 바뀌면 수정 준수가 실패한다", () => {
    const judged = decideModelAdoption(
      ready({
        repairRequests: [amountRequest],
        repairResults: [amountResult({ changedFields: ["conditioning.amount", "conditioning.format"] })],
      }),
    );
    expect(judged.adopted).toBe(false);
    expect(judged.issueCodes).toContain("repair.unexpected_field");
    const assessed = assessRepairs([amountRequest], [amountResult({ unexpectedFields: ["conditioning.format"] })]);
    expect(assessed.ok).toBe(false);
    expect(assessed.codes).toContain("repair.unexpected_field");
  });

  it("재검증이 실패하면 승인 상태가 되지 않는다", () => {
    const stayed = advanceAfterRevalidation("needs_repair", false);
    expect(stayed.status).toBe("needs_repair");
    const judged = decideModelAdoption(
      ready({
        repairRequests: [amountRequest],
        repairResults: [amountResult({ revalidation: "failed" })],
      }),
    );
    expect(judged.adopted).toBe(false);
    expect(judged.status).not.toBe("approved");
    expect(judged.issueCodes).toContain("repair.revalidation_failed");
  });

  it("fallback 출처는 model로 바뀌지 않는다", () => {
    const judged = decideModelAdoption(ready({ origin: "fallback" }));
    expect(judged.origin).toBe("fallback");
    expect(judged.modelSuccess).toBe(false);
    expect(judged.adopted).toBe(false);
    const recorded = judgeFallback(true);
    expect(recorded.origin).toBe("fallback");
    expect(recorded.modelSuccess).toBe(false);
    expect(recorded.status).toBe("validated");
  });

  it("no_model은 모델 성공으로 기록되지 않는다", () => {
    const judged = decideModelAdoption(ready({ origin: "no_model", status: "approved" }));
    expect(judged.origin).toBe("no_model");
    expect(judged.modelSuccess).toBe(false);
    expect(judged.status).not.toBe("approved");
    const recorded = judgeNoModel();
    expect(recorded.modelSuccess).toBe(false);
    expect(recorded.origin).toBe("no_model");
  });

  it("허용되지 않은 상태 전이를 거부한다", () => {
    expect(transitionGenerationStatus("rejected", "approved").ok).toBe(false);
    expect(transitionGenerationStatus("needs_repair", "approved").ok).toBe(false);
    expect(transitionGenerationStatus("approved", "draft").ok).toBe(false);
    expect(transitionGenerationStatus("approved", "validated").ok).toBe(false);
    expect(persistApproved("draft", "unsaved").ok).toBe(false);
    expect(persistApproved("validated", "unsaved").ok).toBe(false);
    const persisted = persistApproved("approved", "unsaved");
    expect(persisted.ok).toBe(true);
    if (persisted.ok) expect(persisted.persistence).toBe("persisted");
  });

  it("오류 코드로 구분하고 문구에는 의존하지 않는다", () => {
    const message = "값이 맞지 않다";
    const equipment = makeIssue({
      code: "equipment.mismatch",
      severity: "hard_error",
      scope: "movement",
      day: "wed",
      area: "conditioning",
      movementKey: "row_erg",
      message,
      expected: "동작에 맞는 장비",
      actual: "다른 장비",
    });
    const amount = makeIssue({
      code: "amount.out_of_range",
      severity: "hard_error",
      scope: "field",
      day: "wed",
      fieldPath: "conditioning.amount",
      message,
      expected: "허용 범위",
      actual: "범위 밖",
    });
    expect(equipment.message).toBe(amount.message);
    expect(repairKindsForCode(equipment.code)).toEqual(["movement_replacement"]);
    expect(repairKindsForCode(amount.code)).toEqual(["field_edit"]);
    const amountEdit: RepairRequest = {
      kind: "field_edit",
      issueCode: "equipment.mismatch",
      day: "wed",
      fieldPath: "conditioning.amount",
      allowedFields: ["conditioning.amount"],
    };
    expect(repairRequestFitsIssue(equipment, amountEdit)).toBe(false);
    const replacement: RepairRequest = {
      kind: "movement_replacement",
      issueCode: "equipment.mismatch",
      day: "wed",
      area: "conditioning",
      movementKey: "row_erg",
    };
    expect(repairRequestFitsIssue(equipment, replacement)).toBe(true);
  });

  it("복구할 수 없는 오류는 성공 상태가 되지 않는다", () => {
    const blocked = makeIssue({
      code: "head.block",
      severity: "hard_error",
      scope: "week",
      message: "채택할 수 없다",
      expected: "승인",
      actual: "차단",
    });
    expect(blocked.repairable).toBe(false);
    const judged = decideModelAdoption(ready({ issues: [blocked], head: "block" }));
    expect(judged.adopted).toBe(false);
    expect(judged.modelSuccess).toBe(false);
    expect(judged.status).toBe("rejected");
    const alreadyApproved = decideModelAdoption(ready({ status: "approved", head: "block", issues: [blocked] }));
    expect(alreadyApproved.adopted).toBe(false);
    expect(alreadyApproved.status).toBe("rejected");
    expect(alreadyApproved.issueCodes).toContain("head.block");
  });

  it("일부 날짜만 모델이면 주 출처가 model이 아니다", () => {
    expect(classifyWeekOrigin({ modelCalled: true, days: ["model", "fallback", "model"] })).toBe("fallback");
    expect(classifyWeekOrigin({ modelCalled: true, days: ["model", "model"] })).toBe("model");
    expect(classifyWeekOrigin({ modelCalled: false, days: ["model"] })).toBe("no_model");
  });

  it("수정 후 재검증을 통과하면 검증 상태를 거쳐 채택할 수 있다", () => {
    const validated = advanceAfterRevalidation("needs_repair", true);
    expect(validated.ok).toBe(true);
    expect(validated.status).toBe("validated");
    const judged = decideModelAdoption(
      ready({
        status: "validated",
        repairRequests: [amountRequest],
        repairResults: [amountResult()],
      }),
    );
    expect(judged.adopted).toBe(true);
    expect(judged.status).toBe("approved");
  });

  it("v2 모듈은 모델 SDK, 데이터베이스, 기존 생성 경로를 가져오지 않는다", () => {
    const dir = path.join(process.cwd(), "src/lib/programming/v2");
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    const banned = ["openai", "better-sqlite3", "next/", "../engine", "../coaching", "../db", "drizzle", "month-plan"];
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const token of banned) {
        expect(text.includes(token), `${file} ${token}`).toBe(false);
      }
    }
  });
});
