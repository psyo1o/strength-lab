import fs from "node:fs";
import path from "node:path";
import { trainingDayKey } from "../progress";
import {
  RX_DISCLAIMER,
  type WodCategory,
  type WodFamily,
  type WodFormat,
  type WodMovement,
  type WodScaling,
  type WodTemplate,
  type WodTier,
} from "./types";

export type { WodCategory, WodFamily, WodFormat, WodMovement, WodScaling, WodTemplate, WodTier } from "./types";
export { RX_DISCLAIMER, categoryLabel, familyLabel, formatLabel, scoreTypeFor, wodTipKeys } from "./types";

type RawFile = {
  disclaimer?: string;
  disclaimerKo?: string;
  sourceNoteKo?: string;
  templates?: Record<string, unknown>[];
  wods?: Record<string, unknown>[];
};

let cached: { disclaimer: string; sourceNoteKo: string; templates: WodTemplate[] } | null = null;

export function resetWodCache() {
  cached = null;
}

export function normalizeWodSlug(slug: string): string {
  return slug.trim().toLowerCase().replace(/-/g, "_");
}

export function wodSlugAliases(slug: string): string[] {
  const trimmed = slug.trim();
  if (!trimmed) return [];
  return [...new Set([trimmed, trimmed.replace(/_/g, "-"), trimmed.replace(/-/g, "_")])];
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asFormat(value: unknown): WodFormat {
  if (value === "amrap" || value === "emom" || value === "chipper") return value;
  return "for_time";
}

function asCategory(value: unknown): WodCategory {
  return value === "conditioning" ? "conditioning" : "benchmark";
}

function asFamily(value: unknown): WodFamily | null {
  return value === "girls" || value === "hero" || value === "benchmark" ? value : null;
}

function asTier(value: unknown): WodTier {
  return value === "scaled" || value === "beginner" ? value : "rx";
}

/** Classic barbell conversion: lb → kg, nearest 2.5. */
export function roundLbTo2p5Kg(lb: number): number {
  return Math.round((lb * 0.45359237) / 2.5) * 2.5;
}

function parseScaling(raw: unknown): WodScaling[] {
  if (!Array.isArray(raw)) return [];
  return (raw as Record<string, unknown>[]).map((s) => ({
    tier: asTier(s.tier),
    titleKo: text(s.titleKo) || asTier(s.tier).toUpperCase(),
    bodyKo: text(s.bodyKo),
  }));
}

function parseMovement(raw: Record<string, unknown>): WodMovement {
  const rxLb = num(raw.rxLb);
  const rxLbF = num(raw.rxLbF);
  const rxKg = num(raw.rxKg) ?? (rxLb != null ? roundLbTo2p5Kg(rxLb) : null);
  const rxKgF = num(raw.rxKgF) ?? (rxLbF != null ? roundLbTo2p5Kg(rxLbF) : null);
  return {
    exerciseKey: text(raw.exerciseKey) || text(raw.id),
    nameKo: text(raw.nameKo) || text(raw.exerciseKey) || text(raw.id),
    scheme: text(raw.scheme),
    rxKg,
    rxKgF,
    rxLb,
    rxLbF,
    rxNote: text(raw.rxNote),
  };
}

function parseTemplate(raw: Record<string, unknown>, sourceNoteKo: string): WodTemplate | null {
  const slug = text(raw.slug) || text(raw.id);
  if (!slug) return null;
  const rxBlock = raw.rx && typeof raw.rx === "object" ? (raw.rx as Record<string, unknown>) : null;
  const movementSource = Array.isArray(raw.movements)
    ? raw.movements
    : Array.isArray(rxBlock?.movements)
      ? rxBlock.movements
      : [];
  const movements = movementSource
    .filter((m) => m && typeof m === "object")
    .map((m) => parseMovement(m as Record<string, unknown>));
  return {
    slug,
    nameKo: text(raw.nameKo) || text(raw.name) || slug,
    category: asCategory(raw.category ?? (text(raw.family) ? "benchmark" : undefined)),
    family: asFamily(raw.family),
    format: asFormat(raw.format),
    timeCapSec: num(raw.timeCapSec),
    targetRounds: num(raw.targetRounds),
    prescriptionKo: text(raw.prescriptionKo),
    equipmentKo: text(raw.equipmentKo),
    sourceNoteKo: text(raw.sourceNoteKo) || sourceNoteKo,
    boxHeightCm: num(raw.boxHeightCm),
    boxHeightCmF: num(raw.boxHeightCmF),
    wallBallKg: num(raw.wallBallKg),
    wallBallKgF: num(raw.wallBallKgF),
    wallBallTargetM: num(raw.wallBallTargetM),
    wallBallTargetMF: num(raw.wallBallTargetMF),
    movements,
    scaling: parseScaling(raw.scaling),
  };
}

function readJson(file: string): RawFile {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as RawFile;
  } catch {
    return {};
  }
}

export function loadWodFile() {
  if (cached) return cached;
  const rxFile = path.join(process.cwd(), "data", "benchmark-wods.rx.json");
  const extraFile = path.join(process.cwd(), "data", "wod-templates.ko.json");
  const rxRaw = readJson(rxFile);
  const extraRaw = readJson(extraFile);
  const sourceNoteKo =
    text(rxRaw.sourceNoteKo) || text(extraRaw.sourceNoteKo);
  const disclaimer = text(rxRaw.disclaimerKo) || text(rxRaw.disclaimer) || RX_DISCLAIMER;

  const rxTemplates = (rxRaw.wods ?? rxRaw.templates ?? [])
    .filter((row) => row && typeof row === "object")
    .map((row) => parseTemplate(row, sourceNoteKo))
    .filter((row): row is WodTemplate => Boolean(row));

  const seen = new Set(rxTemplates.map((t) => normalizeWodSlug(t.slug)));
  const extras = (extraRaw.templates ?? extraRaw.wods ?? [])
    .filter((row) => row && typeof row === "object")
    .map((row) => parseTemplate(row, text(extraRaw.sourceNoteKo) || sourceNoteKo))
    .filter((row): row is WodTemplate => Boolean(row) && !seen.has(normalizeWodSlug(row.slug)));

  cached = {
    disclaimer,
    sourceNoteKo,
    templates: [...rxTemplates, ...extras],
  };
  return cached;
}

export function listWodTemplates(): WodTemplate[] {
  return loadWodFile().templates;
}

export function listBenchmarkTemplates(): WodTemplate[] {
  return listWodTemplates().filter((t) => t.category === "benchmark");
}

export function getWodTemplate(slug: string): WodTemplate | null {
  const key = normalizeWodSlug(slug);
  if (!key) return null;
  return listWodTemplates().find((t) => normalizeWodSlug(t.slug) === key) ?? null;
}

export function todayWodSlug(nowMs = Date.now()): string {
  const templates = listWodTemplates();
  if (!templates.length) return "";
  const day = trainingDayKey(nowMs);
  let h = 0;
  for (let i = 0; i < day.length; i += 1) h = (h * 31 + day.charCodeAt(i)) >>> 0;
  return templates[h % templates.length]!.slug;
}

export function toClientTemplate(template: WodTemplate): WodTemplate {
  return JSON.parse(JSON.stringify(template)) as WodTemplate;
}
