import fs from "node:fs";
import path from "node:path";
import { seedJsonPath } from "../src/lib/db/seed";
import { decodeGzipBase64, decodePayloadFile, mergePayloadsIntoSeedJson } from "../src/lib/programs/seed-merge";

/** Merge gzip+base64 or JSON program payloads into data/seed.json by id. Keeps P0. */
function main() {
  const args = process.argv.slice(2);
  const seedPath = process.env.SEED_JSON_PATH || seedJsonPath();
  const payloads: unknown[] = [];

  if (!args.length && !process.stdin.isTTY) {
    payloads.push(decodeGzipBase64(fs.readFileSync(0, "utf8")));
  }
  for (const arg of args) {
    if (arg === "-") {
      payloads.push(decodeGzipBase64(fs.readFileSync(0, "utf8")));
      continue;
    }
    const file = path.resolve(arg);
    if (!fs.existsSync(file)) throw new Error(`missing ${file}`);
    payloads.push(decodePayloadFile(file));
  }
  if (!payloads.length) {
    console.error("usage: npx tsx scripts/merge-seed-programs.ts <payload.json|*.gz|*.b64> [...]");
    process.exit(2);
  }
  const { replaced } = mergePayloadsIntoSeedJson({ seedPath, payloads });
  console.log(`Merged ${replaced.join(", ") || "(none)"} into ${seedPath}`);
}

main();
