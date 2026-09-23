import fs from "node:fs";
import path from "node:path";

export const GEAR_DISCLOSURE =
  "이 페이지의 일부 링크는 파트너스(제휴) 링크이며, 구매 시 수수료를 받을 수 있습니다.";

export type GearItem = {
  id: string;
  nameKo: string;
  whyKo: string;
  imageUrl: string;
  affiliateUrl: string;
  merchant: string;
  configured: boolean;
};

export type GearCategory = {
  id: string;
  nameKo: string;
  items: GearItem[];
};

export type GearCatalog = {
  disclosureKo: string;
  noteKo: string;
  sourcePath: string;
  categories: GearCategory[];
};

type Cache = { mtimeMs: number; path: string; catalog: GearCatalog };

let cache: Cache | null = null;

export function resetGearCache() {
  cache = null;
}

export function bundledGearJsonPath(): string {
  return path.join(process.cwd(), "data", "gear-affiliates.json");
}

/** NAS overlay next to SQLite, then the image/bundled JSON. */
export function resolveGearJsonPath(): string {
  if (process.env.GEAR_JSON_PATH) return process.env.GEAR_JSON_PATH;
  const bundled = path.resolve(bundledGearJsonPath());
  const db = process.env.DATABASE_PATH;
  if (db) {
    const overlay = path.resolve(path.dirname(path.resolve(db)), "gear-affiliates.json");
    if (overlay !== bundled && fs.existsSync(overlay)) return overlay;
  }
  return bundled;
}

export function isConfiguredAffiliateUrl(raw: string): boolean {
  const url = raw.trim();
  if (!url) return false;
  if (/placeholder/i.test(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (/(^|\.)example\.(com|net|org)$/i.test(parsed.hostname)) return false;
  return true;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseItem(raw: Record<string, unknown>, index: number): GearItem | null {
  const nameKo = text(raw.nameKo);
  if (!nameKo) return null;
  const affiliateUrl = text(raw.affiliateUrl);
  const imageUrl = text(raw.imageUrl);
  return {
    id: text(raw.id) || `item-${index}`,
    nameKo,
    whyKo: text(raw.whyKo),
    imageUrl: isConfiguredAffiliateUrl(imageUrl) ? imageUrl : "",
    affiliateUrl,
    merchant: text(raw.merchant) || "쿠팡",
    configured: isConfiguredAffiliateUrl(affiliateUrl),
  };
}

function parseCatalog(raw: unknown, sourcePath: string): GearCatalog {
  const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const categories: GearCategory[] = [];
  const rows = Array.isArray(data.categories) ? data.categories : [];
  rows.forEach((row, idx) => {
    if (!row || typeof row !== "object") return;
    const cat = row as Record<string, unknown>;
    const nameKo = text(cat.nameKo);
    if (!nameKo) return;
    const items = (Array.isArray(cat.items) ? cat.items : [])
      .map((item, itemIdx) =>
        item && typeof item === "object" ? parseItem(item as Record<string, unknown>, itemIdx) : null,
      )
      .filter((item): item is GearItem => Boolean(item));
    categories.push({
      id: text(cat.id) || `cat-${idx}`,
      nameKo,
      items,
    });
  });
  return {
    disclosureKo: text(data.disclosureKo) || GEAR_DISCLOSURE,
    noteKo: text(data.noteKo),
    sourcePath,
    categories,
  };
}

export function loadGearCatalog(): GearCatalog {
  const file = resolveGearJsonPath();
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    mtimeMs = 0;
  }
  if (cache && cache.path === file && cache.mtimeMs === mtimeMs) return cache.catalog;
  let raw: unknown = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    raw = {};
  }
  const catalog = parseCatalog(raw, file);
  cache = { mtimeMs, path: file, catalog };
  return catalog;
}

export function listGearItems(catalog: GearCatalog = loadGearCatalog()): GearItem[] {
  return catalog.categories.flatMap((cat) => cat.items);
}
