import fs from "node:fs";
import path from "node:path";

export const GEAR_DISCLOSURE =
  "이 화면은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

/** The only outbound partner href. Never built from coupangPartnerId. */
export const ONLY_PARTNER_HREF = "https://link.coupang.com/a/hvCaduhQ8O";

const CONFIRMED_PARTNER_IMAGE =
  "https://thumbnail.coupangcdn.com/thumbnails/remote/492x492ex/image/retail/images/2024/07/17/15/4/6d758f0b-8b3a-466d-be69-3588f5ed9eb3.jpg";

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
  /** Coupang Partners account id. Not a link and never substituted for affiliateUrl. */
  coupangPartnerId: string;
  sourcePath: string;
  categories: GearCategory[];
};

export type PartnerLinkCard = {
  id: string;
  nameKo: string;
  whyKo: string;
  imageUrl: string;
  href: string;
};

export type ReferenceCard = {
  id: string;
  nameKo: string;
  whyKo: string;
  imageUrl: string;
};

export type GearPageModel = {
  disclosure: string;
  partner: PartnerLinkCard | null;
  references: ReferenceCard[];
};

/**
 * Confirmed product for the single partner link.
 * The short link was opened and this name and photo were supplied for that product.
 */
export const CONFIRMED_PARTNER: PartnerLinkCard = {
  id: "kratos-hook-grip-tape",
  nameKo: "KRATOS 접착식 훅 그립 테이프",
  whyKo: "바벨 풀 때 손에 감는 훅 그립 테이프입니다.",
  imageUrl: CONFIRMED_PARTNER_IMAGE,
  href: ONLY_PARTNER_HREF,
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

export function isUnnamedGearTitle(name: string): boolean {
  const value = name.trim();
  return value.length === 0 || value === "운동 장비";
}

/** True only for the one confirmed partner href. Partner ids and search URLs are not links. */
export function isOutboundPartnerHref(raw: string): boolean {
  return raw.trim() === ONLY_PARTNER_HREF;
}

export function isConfiguredAffiliateUrl(raw: string): boolean {
  return isOutboundPartnerHref(raw);
}

export function isAppGearImage(raw: string): boolean {
  return /^\/gear\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(raw.trim());
}

export function isDisplayPhoto(raw: string): boolean {
  const url = raw.trim();
  return isAppGearImage(url) || url === CONFIRMED_PARTNER_IMAGE;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function keptAffiliateUrl(raw: string): string {
  return isOutboundPartnerHref(raw) ? ONLY_PARTNER_HREF : "";
}

function keptImage(raw: string): string {
  const url = raw.trim();
  return isDisplayPhoto(url) ? url : "";
}

function parseItem(raw: Record<string, unknown>, index: number): GearItem | null {
  const nameKo = text(raw.nameKo);
  if (!nameKo) return null;
  const affiliateUrl = keptAffiliateUrl(text(raw.affiliateUrl));
  return {
    id: text(raw.id) || `item-${index}`,
    nameKo,
    whyKo: text(raw.whyKo),
    imageUrl: keptImage(text(raw.imageUrl)),
    affiliateUrl,
    merchant: text(raw.merchant) || "쿠팡",
    configured: affiliateUrl.length > 0,
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
    coupangPartnerId: text(data.coupangPartnerId),
    sourcePath,
    categories,
  };
}

function readCatalogFile(file: string): GearCatalog {
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

export function loadGearCatalog(): GearCatalog {
  return readCatalogFile(resolveGearJsonPath());
}

export function listGearItems(catalog: GearCatalog = loadGearCatalog()): GearItem[] {
  return catalog.categories.flatMap((cat) => cat.items);
}

export function confirmedPartnerCard(): PartnerLinkCard | null {
  const card = CONFIRMED_PARTNER;
  if (isUnnamedGearTitle(card.nameKo)) return null;
  if (!card.whyKo.trim() || !isDisplayPhoto(card.imageUrl)) return null;
  if (!isOutboundPartnerHref(card.href)) return null;
  return {
    id: card.id,
    nameKo: card.nameKo,
    whyKo: card.whyKo,
    imageUrl: card.imageUrl,
    href: ONLY_PARTNER_HREF,
  };
}

/** Shipped reference slots. Empty URLs stay visible and are never links. Unnamed titles are omitted. */
export function referenceCards(catalog: GearCatalog): ReferenceCard[] {
  const cards: ReferenceCard[] = [];
  for (const item of listGearItems(catalog)) {
    if (isUnnamedGearTitle(item.nameKo)) continue;
    if (!item.whyKo.trim()) continue;
    if (!isAppGearImage(item.imageUrl)) continue;
    if (item.nameKo === CONFIRMED_PARTNER.nameKo) continue;
    cards.push({
      id: item.id,
      nameKo: item.nameKo,
      whyKo: item.whyKo,
      imageUrl: item.imageUrl,
    });
  }
  return cards;
}

/**
 * What the gear page shows. Reference cards come from the bundled catalog so a NAS
 * overlay titled only 운동 장비 cannot replace them or add a second outbound link.
 */
export function gearPageModel(): GearPageModel {
  const bundled = readCatalogFile(path.resolve(bundledGearJsonPath()));
  return {
    disclosure: GEAR_DISCLOSURE,
    partner: confirmedPartnerCard(),
    references: referenceCards(bundled),
  };
}
