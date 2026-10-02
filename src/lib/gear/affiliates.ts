import fs from "node:fs";
import path from "node:path";

export const GEAR_DISCLOSURE =
  "이 화면은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.";

/** KRATOS short link. Never built from coupangPartnerId. */
export const ONLY_PARTNER_HREF = "https://link.coupang.com/a/hvCaduhQ8O";

const KRATOS_IMAGE =
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
  partners: PartnerLinkCard[];
  references: ReferenceCard[];
};

/**
 * Confirmed partner cards. Hardcoded so a NAS overlay at /data/gear-affiliates.json
 * cannot hide them or swap their photos. Each href and image URL is exact.
 */
export const CONFIRMED_PARTNERS: readonly PartnerLinkCard[] = [
  {
    id: "kratos-hook-grip-tape",
    nameKo: "KRATOS 접착식 훅 그립 테이프",
    whyKo: "바벨 풀 때 손에 감는 훅 그립 테이프입니다.",
    imageUrl: KRATOS_IMAGE,
    href: ONLY_PARTNER_HREF,
  },
  {
    id: "zero-to-hero-knee-sleeve",
    nameKo: "제로투히어로 네오프렌 무릎보호대 5mm 세트",
    whyKo: "스쿼트처럼 무릎에 부하가 큰 날에 무릎을 감싸 주는 5mm 슬리브입니다.",
    imageUrl:
      "https://t1a.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/2024/05/16/14/0/402caa09-b49b-4957-bc99-f18c6aa2d621.jpg",
    href: "https://link.coupang.com/a/hv61OWmYIC",
  },
  {
    id: "zamst-wrist-wrap",
    nameKo: "잠스트 리스트 랩 손목보호대, 1개, 블랙",
    whyKo: "스내치나 클린처럼 바가 손목에 실릴 때 손목을 고정하는 랩입니다.",
    imageUrl:
      "https://t3a.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/100692866906998-475b92b5-edd5-483b-874e-63fc46c8eea8.jpg",
    href: "https://link.coupang.com/a/hv63GB1HxI",
  },
  {
    id: "lever-belt-red-black",
    nameKo: "헬스 파워 리프팅 레버 역도 벨트, 레드블랙",
    whyKo: "무거운 스쿼트와 데드리프트에서 허리를 받치는 레버 벨트입니다.",
    imageUrl:
      "https://thumbnail3.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/image_audit/prod/e0f7a153-f99d-4c14-a652-4e15a7953f80_fixing_v2.png",
    href: "https://link.coupang.com/a/hv63PSZNxl",
  },
  {
    id: "winable-double-under-rope",
    nameKo: "윈어블 복싱 RPM 더블언더 줄넘기",
    whyKo: "더블언더를 돌릴 때 쓰는 와이어 줄넘기입니다.",
    imageUrl:
      "https://thumbnail7.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/110224658514384-deebec35-a4ae-4765-8cdb-71fcbc9e978c.jpg",
    href: "https://link.coupang.com/a/hv636AnV37",
  },
];

/** KRATOS card. Kept as the first confirmed partner. */
export const CONFIRMED_PARTNER: PartnerLinkCard = CONFIRMED_PARTNERS[0];

const ALLOWED_PARTNER_HREFS = new Set(CONFIRMED_PARTNERS.map((card) => card.href));
const ALLOWED_PARTNER_IMAGES = new Set(CONFIRMED_PARTNERS.map((card) => card.imageUrl));

/** Generic reference slots covered by a confirmed partner card. */
const SUPERSEDED_REFERENCE_IDS = new Set(["knee-pads", "wrist-brace"]);

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

/** True only for a confirmed partner short link. Partner ids and search URLs are not links. */
export function isOutboundPartnerHref(raw: string): boolean {
  return ALLOWED_PARTNER_HREFS.has(raw.trim());
}

export function isConfiguredAffiliateUrl(raw: string): boolean {
  return isOutboundPartnerHref(raw);
}

export function isAppGearImage(raw: string): boolean {
  return /^\/gear\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/.test(raw.trim());
}

export function isDisplayPhoto(raw: string): boolean {
  const url = raw.trim();
  return isAppGearImage(url) || ALLOWED_PARTNER_IMAGES.has(url);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function keptAffiliateUrl(raw: string): string {
  const url = raw.trim();
  return ALLOWED_PARTNER_HREFS.has(url) ? url : "";
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

export function confirmedPartnerCards(): PartnerLinkCard[] {
  return CONFIRMED_PARTNERS.filter((card) => {
    if (isUnnamedGearTitle(card.nameKo)) return false;
    if (!card.whyKo.trim() || !isDisplayPhoto(card.imageUrl)) return false;
    return isOutboundPartnerHref(card.href);
  }).map((card) => ({
    id: card.id,
    nameKo: card.nameKo,
    whyKo: card.whyKo,
    imageUrl: card.imageUrl,
    href: card.href,
  }));
}

/** Shipped reference slots. Empty URLs stay visible and are never links. Unnamed titles are omitted. */
export function referenceCards(catalog: GearCatalog): ReferenceCard[] {
  const cards: ReferenceCard[] = [];
  for (const item of listGearItems(catalog)) {
    if (isUnnamedGearTitle(item.nameKo)) continue;
    if (!item.whyKo.trim()) continue;
    if (!isAppGearImage(item.imageUrl)) continue;
    if (SUPERSEDED_REFERENCE_IDS.has(item.id)) continue;
    if (CONFIRMED_PARTNERS.some((card) => card.nameKo === item.nameKo)) continue;
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
 * What the gear page shows. Partner cards are the hardcoded confirmed list, so a NAS
 * overlay cannot hide them or drop their photos. Reference cards come from the bundled
 * catalog so an overlay titled only 운동 장비 cannot replace them or add another link.
 */
export function gearPageModel(): GearPageModel {
  const bundled = readCatalogFile(path.resolve(bundledGearJsonPath()));
  return {
    disclosure: GEAR_DISCLOSURE,
    partners: confirmedPartnerCards(),
    references: referenceCards(bundled),
  };
}
