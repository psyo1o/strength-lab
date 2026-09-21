import fs from "node:fs";
import path from "node:path";
import { trainingDayKey } from "../progress";
import {
  type WodCategory,
  type WodFormat,
  type WodMovement,
  type WodScaling,
  type WodTemplate,
  type WodTier,
} from "./types";

export type { WodCategory, WodFormat, WodMovement, WodScaling, WodTemplate, WodTier } from "./types";
export { categoryLabel, formatLabel, scoreTypeFor, wodTipKeys } from "./types";

type RawFile = {
  disclaimer?: string;
  sourceNoteKo?: string;
  templates?: Record<string, unknown>[];
};

let cached: { disclaimer: string; sourceNoteKo: string; templates: WodTemplate[] } | null = null;

export function resetWodCache() {
  cached = null;
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
  return value === "amrap" || value === "emom" ? value : "for_time";
}

function asCategory(value: unknown): WodCategory {
  return value === "conditioning" ? "conditioning" : "benchmark";
}

function asTier(value: unknown): WodTier {
  return value === "scaled" || value === "beginner" ? value : "rx";
}

function parseMovement(raw: Record<string, unknown>): WodMovement {
  return {
    exerciseKey: text(raw.exerciseKey),
    nameKo: text(raw.nameKo) || text(raw.exerciseKey),
    scheme: text(raw.scheme),
    rxKg: num(raw.rxKg),
    rxKgF: num(raw.rxKgF),
    rxNote: text(raw.rxNote),
  };
}

function parseTemplate(raw: Record<string, unknown>, sourceNoteKo: string): WodTemplate | null {
  const slug = text(raw.slug);
  if (!slug) return null;
  const movements = Array.isArray(raw.movements)
    ? raw.movements.filter((m) => m && typeof m === "object").map((m) => parseMovement(m as Record<string, unknown>))
    : [];
  const scaling = Array.isArray(raw.scaling)
    ? (raw.scaling as Record<string, unknown>[]).map((s) => ({
        tier: asTier(s.tier),
        titleKo: text(s.titleKo) || asTier(s.tier).toUpperCase(),
        bodyKo: text(s.bodyKo),
      }))
    : [];
  return {
    slug,
    nameKo: text(raw.nameKo) || slug,
    category: asCategory(raw.category),
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
    scaling,
  };
}

export function loadWodFile() {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "wod-templates.ko.json");
  let raw: RawFile = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as RawFile;
  } catch {
    raw = {};
  }
  const sourceNoteKo = text(raw.sourceNoteKo);
  const templates = (raw.templates ?? [])
    .filter((row) => row && typeof row === "object")
    .map((row) => parseTemplate(row, sourceNoteKo))
    .filter((row): row is WodTemplate => Boolean(row));
  cached = {
    disclaimer: text(raw.disclaimer),
    sourceNoteKo,
    templates,
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
  return listWodTemplates().find((t) => t.slug === slug) ?? null;
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
