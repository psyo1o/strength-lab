import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ArchiveFile = {
  relative: string;
  sha256: string;
  bytes: number;
};

export type PassManifest = {
  run_id: string;
  pass: string;
  execution_id: string;
  files: ArchiveFile[];
};

const LABEL = /^[A-Za-z0-9.-]+$/;
const REQUIRED = ["generation-logs.json", "weeks.json", "months.json"] as const;

function assertLabel(value: string, name: string) {
  if (!LABEL.test(value) || value.includes("..") || value.startsWith(".") || value.endsWith(".")) {
    throw new Error(`${name} is not a file label`);
  }
}

function sha256(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

function hasRawResponse(log: unknown): boolean {
  if (!log || typeof log !== "object") return false;
  const row = log as Record<string, unknown>;
  if (row.raw_output != null) return true;
  if (row.body != null) return true;
  if (!Array.isArray(row.model_attempts)) return false;
  return row.model_attempts.some((attempt) => {
    if (!attempt || typeof attempt !== "object") return false;
    return (attempt as { raw?: unknown }).raw != null;
  });
}

/** Writes one pass under root/runId/pass. A later pass uses another directory and does not rewrite this one. */
export function archiveProbePass(input: {
  root: string;
  runId: string;
  pass: string;
  generationLogs: unknown;
  weeks: unknown;
  months: unknown;
  evaluations: unknown;
  calls: number;
  tokens: number;
  elapsed_ms: number;
  notes?: string[];
}): { dir: string; manifest: PassManifest } {
  assertLabel(input.runId, "run_id");
  assertLabel(input.pass, "pass");
  const dir = path.join(input.root, input.runId, input.pass);
  mkdirSync(dir, { recursive: true });
  const files: ArchiveFile[] = [];
  const write = (name: string, value: unknown) => {
    const body = JSON.stringify(value, null, 2);
    writeFileSync(path.join(dir, name), body);
    files.push({ relative: name, sha256: sha256(body), bytes: Buffer.byteLength(body) });
  };
  write("generation-logs.json", input.generationLogs);
  write("weeks.json", input.weeks);
  write("months.json", input.months);
  write("evaluations.json", input.evaluations);
  write("usage.json", {
    calls: input.calls,
    tokens: input.tokens,
    elapsed_ms: input.elapsed_ms,
    notes: input.notes ?? [],
  });
  const manifest: PassManifest = {
    run_id: input.runId,
    pass: input.pass,
    execution_id: `${input.runId}-${input.pass}`,
    files,
  };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { dir, manifest };
}

/**
 * Checks that every required original still matches the manifest.
 * A missing file, a changed file, an empty log, or a log with no raw response fails the probe.
 */
export function verifyProbeArchives(input: { root: string; runId: string; passes: string[] }): { ok: true; missing: [] } | { ok: false; missing: string[] } {
  assertLabel(input.runId, "run_id");
  const missing: string[] = [];
  const dirs = new Set<string>();
  const executionIds = new Set<string>();
  for (const pass of input.passes) {
    assertLabel(pass, "pass");
    const dir = path.join(input.root, input.runId, pass);
    if (dirs.has(dir)) missing.push(`path collision ${dir}`);
    dirs.add(dir);
    const manifestPath = path.join(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      missing.push(manifestPath);
      continue;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PassManifest;
    if (manifest.run_id !== input.runId || manifest.pass !== pass || manifest.execution_id !== `${input.runId}-${pass}`) {
      missing.push(`identity ${dir}`);
    }
    if (executionIds.has(manifest.execution_id)) missing.push(`execution id collision ${manifest.execution_id}`);
    executionIds.add(manifest.execution_id);
    for (const file of manifest.files) {
      const full = path.join(dir, file.relative);
      if (!existsSync(full)) {
        missing.push(full);
        continue;
      }
      const body = readFileSync(full, "utf8");
      if (sha256(body) !== file.sha256) missing.push(`changed ${full}`);
    }
    for (const name of REQUIRED) {
      const full = path.join(dir, name);
      if (!existsSync(full)) missing.push(full);
    }
    const logsPath = path.join(dir, "generation-logs.json");
    if (!existsSync(logsPath)) continue;
    const logs = JSON.parse(readFileSync(logsPath, "utf8")) as unknown;
    if (!Array.isArray(logs) || logs.length === 0) {
      missing.push(`empty generation logs ${logsPath}`);
      continue;
    }
    if (!logs.some((log) => hasRawResponse(log))) missing.push(`raw model response ${logsPath}`);
  }
  if (new Set(input.passes).size !== input.passes.length) missing.push("pass id collision");
  return missing.length ? { ok: false, missing } : { ok: true, missing: [] };
}
