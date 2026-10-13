/**
 * Phase 4-1 live probe. Stages A, B, and C on a 2099 database under /tmp.
 * MONTH_PLAN_MODEL_KEY is required and is never printed.
 *   npx tsx scripts/phase4-probe.ts
 */
import { mkdirSync, rmSync } from "node:fs";

const dbPath = "/tmp/strength-lab-phase4-2099.db";
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${dbPath}${suffix}`, { force: true });
process.env.DATABASE_PATH = dbPath;
process.env.LONGITUDINAL_PLANNING = "";
process.env.FALLBACK_WEEK_DISPLAY = "";
delete process.env.COACH_MODEL_PROVIDER;
delete process.env.COACH_MODEL_NAME;
delete process.env.COACHING_MODEL;

const key = process.env.MONTH_PLAN_MODEL_KEY?.trim() ?? "";
if (!key) {
  console.error("MONTH_PLAN_MODEL_KEY is missing");
  process.exit(2);
}

mkdirSync("docs/phase4-runs", { recursive: true });

async function main() {
  const { runPhase4, writePhase4Report } = await import("../src/lib/programming/phase4/run");
  const result = await runPhase4({ key, dbPath, logPath: "docs/phase4-runs/calls.log" });
  writePhase4Report({
    ...result,
    tests: "테스트는 프로브와 따로 적는다.",
    tsc: "tsc는 프로브와 따로 적는다.",
  });
  console.log(JSON.stringify({ stages: result.stages, adopted: result.adopted, weeks: result.weeks, tokens: result.tokens, stopped: result.stopped }));
  if (result.stopped || result.stages.some((row) => !row.pass)) process.exit(1);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "probe failed";
  console.error(message);
  process.exit(1);
});
