import type { IssueCode, RepairRequest, RepairResult } from "./domain";

function sameRequest(left: RepairRequest, right: RepairRequest): boolean {
  if (left.kind !== right.kind || left.issueCode !== right.issueCode) return false;
  if (left.kind === "field_edit" && right.kind === "field_edit") {
    return left.day === right.day && left.fieldPath === right.fieldPath;
  }
  if (left.kind === "movement_replacement" && right.kind === "movement_replacement") {
    return left.day === right.day && left.area === right.area && left.movementKey === right.movementKey;
  }
  if (left.kind === "session_regeneration" && right.kind === "session_regeneration") {
    return left.day === right.day && left.area === right.area;
  }
  return true;
}

export type RepairAssessment = {
  ok: boolean;
  codes: IssueCode[];
};

/** 요청한 수정이 실제로 적용됐는지, 다른 필드가 바뀌지 않았는지, 재검증을 통과했는지를 본다. */
export function assessRepairs(requests: readonly RepairRequest[], results: readonly RepairResult[]): RepairAssessment {
  const codes: IssueCode[] = [];
  for (const request of requests) {
    if (request.kind === "unrepairable") {
      codes.push("repair.unrepairable");
      continue;
    }
    const result = results.find((row) => sameRequest(row.request, request));
    if (!result || !result.applied || result.changedFields.length === 0) {
      codes.push("repair.not_applied");
      continue;
    }
    if (result.unexpectedFields.length > 0) codes.push("repair.unexpected_field");
    if (request.kind === "field_edit") {
      const outside = result.changedFields.filter((field) => !request.allowedFields.includes(field));
      if (outside.length > 0) codes.push("repair.unexpected_field");
    }
    if (result.revalidation !== "passed") codes.push("repair.revalidation_failed");
  }
  return { ok: codes.length === 0, codes };
}
