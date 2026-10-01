import { BODY_BUDGET_MIN, type BlockRole, type SessionBlock } from "./types";

export const BLOCK_ORDER: BlockRole[] = [
  "warmup",
  "main",
  "metcon",
  "skill",
  "assistance",
  "extra_conditioning",
];

/**
 * 90 minutes is the body, not the warmup.
 * Warmup stays. If the body runs long, drop blocks from the bottom.
 */
export function applyTimeCut(blocks: SessionBlock[], bodyBudgetMin = BODY_BUDGET_MIN): SessionBlock[] {
  const ordered = [...blocks].sort(
    (a, b) => BLOCK_ORDER.indexOf(a.role) - BLOCK_ORDER.indexOf(b.role),
  );
  let body = 0;
  const kept = new Set<BlockRole>();
  for (const block of ordered) {
    if (block.role === "warmup") {
      kept.add(block.role);
      continue;
    }
    if (body + block.minutes <= bodyBudgetMin) {
      body += block.minutes;
      kept.add(block.role);
      continue;
    }
    break;
  }
  return ordered.map((block) => ({
    ...block,
    cuttable: block.role !== "warmup",
    kept: kept.has(block.role),
  }));
}
