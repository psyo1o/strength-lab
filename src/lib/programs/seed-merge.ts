import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Completeness } from "./completeness-ux";
import type { PublicSeedFile, PublicSeedProgram, PublicSeedWeek } from "./seed-schema";

export const P0_PROGRAM_IDS = [
  "jim-wendler-531",
  "starting-strength",
  "stronglifts-5x5",
  "madcow-5x5",
] as const;

export function weeksHaveMissingDays(weeks: Array<{ days?: unknown[] }> | undefined): boolean {
  if (!weeks?.length) return true;
  return weeks.some((w) => !Array.isArray(w.days) || w.days.length === 0);
}

/** Wendler stays full. Template only when a seeded week has no days. */
export function inferCompleteness(opts: {
  id: string;
  declared?: Completeness | string | null;
  weeks?: Array<{ days?: unknown[] }>;
}): Completeness {
  if (opts.id === "jim-wendler-531" || opts.declared === "full") return "full";
  if (weeksHaveMissingDays(opts.weeks)) return "template";
  return "working";
}

export function stampCompleteness<T extends { id?: string; slug?: string; completeness?: Completeness; weeks?: PublicSeedWeek[] }>(
  program: T,
): T {
  const id = String(program.id ?? program.slug ?? "");
  return { ...program, completeness: inferCompleteness({ id, declared: program.completeness, weeks: program.weeks }) };
}

export function decodeGzipBase64(raw: string): unknown {
  const cleaned = raw.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!cleaned) throw new Error("empty payload");
  const buf = Buffer.from(cleaned, "base64");
  if (!buf.length) throw new Error("invalid base64 payload");
  let text: string;
  try {
    text = zlib.gunzipSync(buf).toString("utf8");
  } catch {
    text = buf.toString("utf8");
  }
  return JSON.parse(text);
}

export function decodePayloadFile(filePath: string): unknown {
  const raw = fs.readFileSync(filePath);
  const name = filePath.toLowerCase();
  if (name.endsWith(".json")) return JSON.parse(raw.toString("utf8"));
  if (name.endsWith(".gz") || name.endsWith(".gzip")) {
    return JSON.parse(zlib.gunzipSync(raw).toString("utf8"));
  }
  return decodeGzipBase64(raw.toString("utf8"));
}

export function programsFromDecoded(decoded: unknown): PublicSeedProgram[] {
  if (!decoded || typeof decoded !== "object") return [];
  const data = decoded as Record<string, unknown>;
  if (Array.isArray(data.programs)) return data.programs as PublicSeedProgram[];
  if (data.id && Array.isArray(data.weeks)) return [data as unknown as PublicSeedProgram];
  return [];
}

export function mergePublicSeedById(
  base: PublicSeedFile,
  incoming: PublicSeedProgram[],
): { seed: PublicSeedFile; replaced: string[] } {
  const byId = new Map(base.programs.map((p) => [p.id, p]));
  const replaced: string[] = [];
  for (const raw of incoming) {
    if (!raw?.id) continue;
    const next = stampCompleteness({ ...byId.get(raw.id), ...raw, id: raw.id, weeks: raw.weeks });
    byId.set(raw.id, next);
    replaced.push(raw.id);
  }
  for (const id of P0_PROGRAM_IDS) {
    if (!byId.has(id)) {
      const keep = base.programs.find((p) => p.id === id);
      if (keep) byId.set(id, keep);
    }
  }
  const seen = new Set<string>();
  const programs: PublicSeedProgram[] = [];
  for (const p of base.programs) {
    const next = stampCompleteness(byId.get(p.id) ?? p);
    programs.push(next);
    seen.add(next.id);
  }
  for (const p of byId.values()) {
    if (seen.has(p.id)) continue;
    programs.push(stampCompleteness(p));
  }
  return { seed: { ...base, programs }, replaced };
}

export function readPublicSeedFile(filePath: string): PublicSeedFile {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as PublicSeedFile;
}

export function writePublicSeedFile(filePath: string, seed: PublicSeedFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(seed, null, 2)}\n`);
}

/** Merge decoded payloads into data/seed.json by program id. Keeps P0. */
export function mergePayloadsIntoSeedJson(opts: {
  seedPath: string;
  payloads: unknown[];
}): { replaced: string[]; seed: PublicSeedFile } {
  const base = readPublicSeedFile(opts.seedPath);
  const incoming = opts.payloads.flatMap(programsFromDecoded);
  const { seed, replaced } = mergePublicSeedById(base, incoming);
  writePublicSeedFile(opts.seedPath, seed);
  return { replaced, seed };
}
