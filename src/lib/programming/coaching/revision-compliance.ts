import type { SessionDraft } from "../types";
import { movementCatalog } from "./pieces";
import type { SessionRevision, TargetCoach } from "./review";
import { MOVEMENT_EQUIPMENT } from "./stage13/units";

/**
 * Machine tokens on the existing revision arrays.
 * replace_movement:<key> in allowed_changes is a required replacement.
 * only_movement:<key> in allowed_changes may change only that movement.
 * keep_movement:<key> in preserve must remain, including its amount.
 * A catalog key named only in prose is unverified and is not a pass.
 */
const REPLACE = "replace_movement:";
const ONLY = "only_movement:";
const KEEP = "keep_movement:";

export type RevisionCompliance = {
  applicable: boolean;
  ok: boolean;
  unverified: boolean;
  required_changes: string[];
  actual_changes: string[];
  preserve_violations: string[];
  allowed_violations: string[];
  reason: string | null;
};

export type ComplianceFeedback = {
  reason: string;
  required_changes: string[];
  actual_changes: string[];
  preserve_violations: string[];
  allowed_violations: string[];
};

type Move = { key: string; amount: string };

function listed(value: readonly string[] | undefined, prefix: string): string[] {
  const keys: string[] = [];
  for (const item of value ?? []) {
    if (!item.startsWith(prefix)) continue;
    const key = item.slice(prefix.length).trim();
    if (key) keys.push(key);
  }
  return keys;
}

function movesOf(session: SessionDraft | null | undefined): Move[] {
  return (session?.conditioning?.movements ?? []).map((movement) => ({ key: movement.key, amount: movement.amount }));
}

function amountsOf(moves: readonly Move[], key: string): string[] {
  return moves.filter((movement) => movement.key === key).map((movement) => movement.amount);
}

function movementDiff(before: readonly Move[], after: readonly Move[]): string[] {
  const keys = [...new Set([...before.map((movement) => movement.key), ...after.map((movement) => movement.key)])];
  const changes: string[] = [];
  for (const key of keys) {
    const left = amountsOf(before, key);
    const right = amountsOf(after, key);
    if (left.join("|") === right.join("|")) continue;
    if (left.length === 0) changes.push(`added:${key}:${right.join("|")}`);
    else if (right.length === 0) changes.push(`removed:${key}`);
    else changes.push(`amount:${key}:${left.join("|")}->${right.join("|")}`);
  }
  return changes;
}

function changeKey(change: string): string {
  const body = change.slice(change.indexOf(":") + 1);
  return body.split(":")[0] ?? "";
}

function proseMovementKeys(revision: SessionRevision): string[] {
  const catalog = movementCatalog()
    .map((row) => row.key)
    .sort((left, right) => right.length - left.length);
  const texts = [
    revision.reason,
    revision.correction_instruction,
    revision.constraints ?? "",
    ...(revision.preserve ?? []).filter((item) => !item.startsWith(KEEP)),
    ...(revision.allowed_changes ?? []).filter((item) => !item.startsWith(REPLACE) && !item.startsWith(ONLY)),
    ...(revision.forbidden_changes ?? []),
  ];
  const found = new Set<string>();
  for (const text of texts) {
    for (const key of catalog) {
      const pattern = new RegExp(`(^|[^a-z0-9_])${key}([^a-z0-9_]|$)`);
      if (pattern.test(text)) found.add(key);
    }
  }
  return [...found];
}

function equipmentViolation(before: readonly string[], after: readonly string[], removed: readonly string[], added: readonly string[]): string | null {
  if (before.join("|") === after.join("|")) return null;
  const swing = new Set<string>();
  for (const key of [...removed, ...added]) {
    const gear = MOVEMENT_EQUIPMENT[key];
    if (gear) swing.add(gear);
  }
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const item of beforeSet) {
    if (!afterSet.has(item) && !swing.has(item)) return `equipment removed ${item}`;
  }
  for (const item of afterSet) {
    if (!beforeSet.has(item) && !swing.has(item)) return `equipment added ${item}`;
  }
  return null;
}

function structureViolations(before: SessionDraft, after: SessionDraft, removed: readonly string[], added: readonly string[]): string[] {
  const violations: string[] = [];
  if (before.warmup_ko !== after.warmup_ko) violations.push("warmup_ko");
  if (JSON.stringify(before.strength) !== JSON.stringify(after.strength)) violations.push("strength");
  if ((before.strength_purpose ?? null) !== (after.strength_purpose ?? null)) violations.push("strength_purpose");
  if ((before.strength_volume ?? null) !== (after.strength_volume ?? null)) violations.push("strength_volume");
  if ((before.strength_intensity ?? null) !== (after.strength_intensity ?? null)) violations.push("strength_intensity");
  const left = before.conditioning;
  const right = after.conditioning;
  if (!left || !right) {
    violations.push("conditioning");
    return violations;
  }
  const fields = ["format", "duration_min", "stimulus", "volume", "intensity", "time_domain", "benchmark", "long_conditioning"] as const;
  for (const field of fields) {
    if (left[field] !== right[field]) violations.push(`conditioning.${field}`);
  }
  const gear = equipmentViolation(left.equipment, right.equipment, removed, added);
  if (gear) violations.push(gear);
  return violations;
}

function verdict(input: {
  applicable: boolean;
  unverified: boolean;
  required_changes: string[];
  actual_changes: string[];
  preserve_violations: string[];
  allowed_violations: string[];
  misses: string[];
}): RevisionCompliance {
  const reason = input.misses[0] ?? input.preserve_violations[0] ?? input.allowed_violations[0] ?? null;
  return {
    applicable: input.applicable,
    ok: input.misses.length === 0 && input.preserve_violations.length === 0 && input.allowed_violations.length === 0,
    unverified: input.unverified,
    required_changes: input.required_changes,
    actual_changes: input.actual_changes,
    preserve_violations: input.preserve_violations,
    allowed_violations: input.allowed_violations,
    reason,
  };
}

export function checkRevisionCompliance(input: {
  revision: SessionRevision;
  before: SessionDraft | null | undefined;
  after: SessionDraft | null | undefined;
  otherDaysChanged: boolean;
  targetCoach: TargetCoach;
}): RevisionCompliance {
  const replaceKeys = listed(input.revision.allowed_changes, REPLACE);
  const onlyKeys = listed(input.revision.allowed_changes, ONLY);
  const keepKeys = listed(input.revision.preserve, KEEP);
  const beforeMoves = movesOf(input.before);
  const afterMoves = movesOf(input.after);
  const actual = movementDiff(beforeMoves, afterMoves);
  const required = [
    ...replaceKeys.map((key) => `${REPLACE}${key}`),
    ...onlyKeys.map((key) => `${ONLY}${key}`),
    ...keepKeys.map((key) => `${KEEP}${key}`),
  ];
  const dayMismatch = !input.after || input.after.day !== input.revision.day;
  const coachMismatch = input.revision.target_coach !== input.targetCoach;
  const baseAllowed = [
    ...(input.otherDaysChanged ? ["other_days"] : []),
    ...(dayMismatch ? [`day ${input.after?.day ?? "missing"} does not match ${input.revision.day}`] : []),
    ...(coachMismatch ? [`target_coach ${input.revision.target_coach ?? "missing"} does not match ${input.targetCoach}`] : []),
  ];
  const tokens = replaceKeys.length + onlyKeys.length + keepKeys.length > 0;
  if (!tokens) {
    const named = proseMovementKeys(input.revision);
    if (named.length === 0 && baseAllowed.length === 0) {
      return verdict({
        applicable: false,
        unverified: false,
        required_changes: [],
        actual_changes: actual,
        preserve_violations: [],
        allowed_violations: [],
        misses: [],
      });
    }
    return verdict({
      applicable: true,
      unverified: named.length > 0,
      required_changes: named.map((key) => `unverified:${key}`),
      actual_changes: actual,
      preserve_violations: [],
      allowed_violations: baseAllowed,
      misses: named.length ? [`movement ${named.join(", ")} is named without a machine token`] : [],
    });
  }
  if (!input.before || !input.after) {
    return verdict({
      applicable: true,
      unverified: false,
      required_changes: required,
      actual_changes: actual,
      preserve_violations: [],
      allowed_violations: baseAllowed,
      misses: ["target session is missing"],
    });
  }
  const removed = actual.filter((change) => change.startsWith("removed:")).map(changeKey);
  const added = actual.filter((change) => change.startsWith("added:")).map(changeKey);
  const misses: string[] = [];
  const preserve = structureViolations(input.before, input.after, removed, added);
  const allowed = [...baseAllowed];
  for (const key of replaceKeys) {
    const was = beforeMoves.some((movement) => movement.key === key);
    const still = afterMoves.some((movement) => movement.key === key);
    if (!was) misses.push(`${REPLACE}${key} was not in the session`);
    else if (still) misses.push(`${REPLACE}${key} still present`);
  }
  if (replaceKeys.length > 0 && added.length !== replaceKeys.length) {
    misses.push(`replacement count ${added.length}; required ${replaceKeys.length}`);
  }
  for (const key of keepKeys) {
    const left = amountsOf(beforeMoves, key);
    const right = amountsOf(afterMoves, key);
    if (right.length === 0) preserve.push(`${KEEP}${key} missing`);
    else if (left.join("|") !== right.join("|")) preserve.push(`${KEEP}${key} amount changed`);
  }
  for (const change of actual) {
    const key = changeKey(change);
    if (replaceKeys.includes(key) && (change.startsWith("removed:") || change.startsWith("amount:"))) continue;
    if (change.startsWith("added:") && replaceKeys.length > 0 && added.length === replaceKeys.length) continue;
    if (onlyKeys.includes(key) && !replaceKeys.includes(key)) continue;
    allowed.push(change);
  }
  return verdict({
    applicable: true,
    unverified: false,
    required_changes: required,
    actual_changes: actual,
    preserve_violations: preserve,
    allowed_violations: allowed,
    misses,
  });
}
