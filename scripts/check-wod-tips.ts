import { listWodTemplates } from "../src/lib/wod/templates";
import { movementTipGaps } from "../src/lib/wod/tip-link";

const gaps = movementTipGaps(listWodTemplates());
if (gaps.length === 0) {
  process.exit(0);
}

for (const gap of gaps) {
  console.warn(`[wod-tip] unmapped ${gap.slug}: ${gap.movement}`);
}
process.exit(1);
