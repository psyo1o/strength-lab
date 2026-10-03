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
  {
    id: "expodium-sticky-grip",
    nameKo: "엑스포디움 스티키 그립 마그네핏 손바닥보호대",
    whyKo: "풀업할 때 손바닥을 감싸 주는 그립입니다.",
    imageUrl:
      "https://t3c.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/d87b/87389830023858e5860601b4f2b29abba85ea64ed552ea4af836555e0ae4.jpg",
    href: "https://link.coupang.com/a/hv7zXg1dFA",
  },
  {
    id: "comma-leather-strap",
    nameKo: "ComMa 가죽 리프팅그립 스트랩",
    whyKo: "데드리프트처럼 악력이 먼저 떨어질 때 바를 고정하는 가죽 스트랩입니다.",
    imageUrl:
      "https://thumbnail13.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/a8b1/cc2152c64790337fe4ec4d8f2829ca6550bd333ea37ab36e08b2a73609f9.jpg",
    href: "https://link.coupang.com/a/hv7oMJ1Pcy",
  },
  {
    id: "muscle-guard-liquid-chalk",
    nameKo: "머슬가드 액상 탄마 초크 50ml",
    whyKo: "바를 잡기 전에 손에 발라 미끄러짐을 줄이는 액상 초크입니다.",
    imageUrl:
      "https://t5c.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/1314924535929358-744b330d-309a-40d3-b46b-d8cdbd35cdb1.jpg",
    href: "https://link.coupang.com/a/hv7AMsvX3Y",
  },
  {
    id: "zero-to-hero-lifting-shoes",
    nameKo: "제로투히어로 리프터 클래식 역도화",
    whyKo: "스쿼트와 저크에서 발목을 세워 주는 역도화입니다.",
    imageUrl:
      "https://thumbnail10.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/2023/03/16/14/6/51b283b4-985c-4ca5-83ad-00260c76defc.jpg",
    href: "https://link.coupang.com/a/hv7yMS2OgC",
  },
  {
    id: "gympro-ab-mat",
    nameKo: "짐프로 복근운동 AB매트",
    whyKo: "싯업할 때 허리 아래를 받치는 매트입니다.",
    imageUrl:
      "https://t4a.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/09cc/630664faf6bb507e185df6d23920cb4789834a54218bf3ff449bc07f4893.jpg",
    href: "https://link.coupang.com/a/hv7sHre5v2",
  },
  {
    id: "body-stone-wall-ball",
    nameKo: "바디스톤 월볼",
    whyKo: "벽에 던져 스쿼트와 던지기를 같이 하는 공입니다.",
    imageUrl:
      "https://thumbnail13.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/image_audit/stage/manual/f32d25e76d37b168abd6d17f73a5c40335bebaafec0238e672072fc7fd7b_1762144067407.jpg",
    href: "https://link.coupang.com/a/hv7xwiiFhs",
  },
  {
    id: "infinity-pullup-band",
    nameKo: "인피니티 풀업밴드",
    whyKo: "턱걸이 횟수가 부족할 때 체중을 덜어 주는 밴드입니다.",
    imageUrl:
      "https://thumbnail6.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/985d/c3adf0097a459fab966a44f824ee36fa4636848042eae68c88b3fa369525.png",
    href: "https://link.coupang.com/a/hv7xRR2jG8",
  },
  {
    id: "trovis-peanut-massage-ball",
    nameKo: "트로비스 라크로스볼 땅콩 마사지볼",
    whyKo: "운동 전후에 뭉친 부위를 눌러 푸는 공입니다.",
    imageUrl:
      "https://thumbnail12.coupangcdn.com/thumbnails/remote/212x212ex/image/vendor_inventory/a1c9/d820afe8852719cd49358636c4b57ba4da01ec77838491a9d97ff07cfe3c.jpg",
    href: "https://link.coupang.com/a/hv7y7CZyQS",
  },
  {
    id: "zero-to-hero-knee-sleeve-7mm",
    nameKo: "제로투히어로 네오프렌 무릎보호대 7mm",
    whyKo: "5mm보다 두꺼운 무릎 슬리브입니다.",
    imageUrl:
      "https://thumbnail4.coupangcdn.com/thumbnails/remote/212x212ex/image/retail/images/4725324948853996-4c974b68-d151-4d33-bde4-ca03510326df.jpg",
    href: "https://link.coupang.com/a/hv7yawkT4S",
  },
];

/** KRATOS card. Kept as the first confirmed partner. */
export const CONFIRMED_PARTNER: PartnerLinkCard = CONFIRMED_PARTNERS[0];

const ALLOWED_PARTNER_HREFS = new Set(CONFIRMED_PARTNERS.map((card) => card.href));
const ALLOWED_PARTNER_IMAGES = new Set(CONFIRMED_PARTNERS.map((card) => card.imageUrl));

/** Generic reference slots covered by a confirmed partner card, plus the removed pedal card. */
const SUPERSEDED_REFERENCE_IDS = new Set(["knee-pads", "wrist-brace", "lifting-straps", "pedal-toe-strap"]);

function isPedalToeStrap(item: { id: string; nameKo: string }): boolean {
  const id = item.id.toLowerCase().replace(/[\s_]+/g, "-");
  const name = item.nameKo.replace(/\s+/g, "");
  return id.includes("pedal") || id.includes("toe-strap") || id.includes("toestrap") || name.includes("페달") || name.includes("토스트랩");
}

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
    if (SUPERSEDED_REFERENCE_IDS.has(item.id) || isPedalToeStrap(item)) continue;
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
