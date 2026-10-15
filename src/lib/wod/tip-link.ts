import { resolveTipExerciseId, tipFor } from "../tips";

export type MovementTipGap = {
  slug: string;
  movement: string;
};

/** Movements whose string does not resolve to a tip with setup, cue, mistake, and alternative. */
export function movementTipGaps(
  templates: Array<{ slug: string; movements: Array<{ exerciseKey: string }> }>,
): MovementTipGap[] {
  const gaps: MovementTipGap[] = [];
  for (const template of templates) {
    const seen = new Set<string>();
    for (const movement of template.movements) {
      const key = movement.exerciseKey.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const id = resolveTipExerciseId(key);
      const tip = tipFor(key);
      const ready = Boolean(id && tip?.setup?.trim() && tip.cue.trim() && tip.mistake.trim() && tip.alternative.trim());
      if (!ready) gaps.push({ slug: template.slug, movement: key });
    }
  }
  return gaps;
}

/** Build/runtime warning. Empty when every movement resolves. */
export function warnMovementTipGaps(
  templates: Array<{ slug: string; movements: Array<{ exerciseKey: string }> }>,
): MovementTipGap[] {
  const gaps = movementTipGaps(templates);
  for (const gap of gaps) {
    console.warn(`[wod-tip] unmapped ${gap.slug}: ${gap.movement}`);
  }
  return gaps;
}
