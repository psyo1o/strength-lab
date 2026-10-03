import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GearShelf } from "../src/components/GearShelf";
import {
  CONFIRMED_PARTNER,
  CONFIRMED_PARTNERS,
  GEAR_DISCLOSURE,
  ONLY_PARTNER_HREF,
  gearPageModel,
  isConfiguredAffiliateUrl,
  isOutboundPartnerHref,
  listGearItems,
  loadGearCatalog,
  referenceCards,
  resetGearCache,
  type GearPageModel,
} from "../src/lib/gear/affiliates";

const PARTNER_HREFS = CONFIRMED_PARTNERS.map((card) => card.href);
const REJECTED_HREFS = [
  "https://link.coupang.com/a/hv64e818km",
  "https://link.coupang.com/a/hv63XFIVOu",
  "https://link.coupang.com/a/hv7vliIRVI",
];

function shelfHtml(model: GearPageModel = gearPageModel()): string {
  return renderToStaticMarkup(React.createElement(GearShelf, { model }));
}

describe("gear affiliates", () => {
  const prevPath = process.env.GEAR_JSON_PATH;
  const prevDb = process.env.DATABASE_PATH;

  afterEach(() => {
    resetGearCache();
    if (prevPath === undefined) delete process.env.GEAR_JSON_PATH;
    else process.env.GEAR_JSON_PATH = prevPath;
    if (prevDb === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prevDb;
  });

  it("ships reference cards with photos and keeps the partner id off every link", () => {
    delete process.env.GEAR_JSON_PATH;
    const catalog = loadGearCatalog();
    expect(catalog.disclosureKo).toBe(GEAR_DISCLOSURE);
    expect(catalog.coupangPartnerId).toBe("AF4475360");
    expect(catalog.categories.map((c) => c.nameKo)).toEqual(["참고"]);
    const items = listGearItems(catalog);
    expect(items.map((item) => item.nameKo)).toEqual(["리프팅 스트랩", "무릎 패드", "손목 보호대"]);
    expect(items.some((item) => /페달|토스트랩/.test(item.nameKo) || item.id === "pedal-toe-strap")).toBe(false);
    expect(items.every((item) => item.whyKo && item.imageUrl.startsWith("/gear/"))).toBe(true);
    expect(items.every((item) => !item.configured)).toBe(true);
    expect(items.every((item) => !item.affiliateUrl.includes("AF4475360"))).toBe(true);
    const bundled = fs.readFileSync(path.join(process.cwd(), "data", "gear-affiliates.json"), "utf8");
    expect(bundled).toMatch(/"coupangPartnerId": "AF4475360"/);
    expect(bundled).toMatch(/이 화면은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다/);
    expect(GEAR_DISCLOSURE).toBe("이 화면은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.");
    expect(bundled).not.toMatch(/CrossFit/i);
    expect(bundled).not.toMatch(/운동 장비/);
    expect(bundled).not.toMatch(/\bTJ\b/);
    expect(bundled).not.toMatch(/완치|힐링|치료제|재활치료/);
    expect(bundled).not.toMatch(/link\.coupang/i);
    expect(bundled).not.toMatch(/partners\.coupang/i);
    expect(bundled).not.toMatch(/coupang\.com\/np\/search/i);
  });

  it("treats empty, search, example.com, and the partner id as not a link", () => {
    expect(isConfiguredAffiliateUrl("")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://example.com/gear-slot")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://shop.example.net/x")).toBe(false);
    expect(isConfiguredAffiliateUrl("javascript:alert(1)")).toBe(false);
    expect(isConfiguredAffiliateUrl("AF4475360")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://www.coupang.com/np/search?q=belt")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://link.coupang.com/a/AF4475360")).toBe(false);
    expect(isOutboundPartnerHref(ONLY_PARTNER_HREF)).toBe(true);
    expect(isConfiguredAffiliateUrl(ONLY_PARTNER_HREF)).toBe(true);
    expect(ONLY_PARTNER_HREF).not.toContain("AF4475360");
    for (const href of PARTNER_HREFS) {
      expect(isOutboundPartnerHref(href)).toBe(true);
      expect(isConfiguredAffiliateUrl(href)).toBe(true);
      expect(href).not.toContain("AF4475360");
      expect(href).not.toContain("coupang.com/np/search");
    }
    for (const href of REJECTED_HREFS) {
      expect(isOutboundPartnerHref(href)).toBe(false);
      expect(isConfiguredAffiliateUrl(href)).toBe(false);
    }
    expect(new Set(PARTNER_HREFS).size).toBe(PARTNER_HREFS.length);
    expect(PARTNER_HREFS.filter((href) => href === ONLY_PARTNER_HREF)).toEqual([ONLY_PARTNER_HREF]);
  });

  it("reads NAS overlay JSON without keeping search or invented partner links", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-gear-"));
    const file = path.join(dir, "gear-affiliates.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        disclosureKo: GEAR_DISCLOSURE,
        coupangPartnerId: "AF4475360",
        categories: [
          {
            id: "rope",
            nameKo: "로프",
            items: [
              {
                id: "speed-rope",
                nameKo: "스피드 로프",
                whyKo: "더블언더 연습용.",
                affiliateUrl: "https://www.coupang.com/np/search?q=speed+rope",
                merchant: "쿠팡",
              },
            ],
          },
        ],
      }),
    );
    process.env.GEAR_JSON_PATH = file;
    resetGearCache();
    const catalog = loadGearCatalog();
    expect(catalog.sourcePath).toBe(file);
    expect(catalog.categories[0].items[0].configured).toBe(false);
    expect(catalog.categories[0].items[0].affiliateUrl).toBe("");
    expect(catalog.categories[0].items[0].affiliateUrl).not.toContain("AF4475360");
  });

  it("drops an unnamed 운동 장비 card and still shows the one confirmed link", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-gear-unnamed-"));
    const file = path.join(dir, "gear-affiliates.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        categories: [
          {
            id: "unknown",
            nameKo: "운동 장비",
            items: [
              {
                id: "generic",
                nameKo: "운동 장비",
                whyKo: "장비.",
                imageUrl: CONFIRMED_PARTNER.imageUrl,
                affiliateUrl: ONLY_PARTNER_HREF,
              },
              {
                id: "guess",
                nameKo: "바벨",
                whyKo: "바벨.",
                affiliateUrl: "https://www.coupang.com/np/search?q=barbell",
              },
            ],
          },
        ],
      }),
    );
    process.env.GEAR_JSON_PATH = file;
    resetGearCache();
    const model = gearPageModel();
    expect(model.disclosure).toBe(GEAR_DISCLOSURE);
    expect(model.partners).toEqual(CONFIRMED_PARTNERS);
    expect(model.partners[0]).toEqual(CONFIRMED_PARTNER);
    expect(model.references).toEqual([]);
    expect(model.references.some((item) => /페달|토스트랩/.test(item.nameKo))).toBe(false);
    expect(model.references.some((item) => item.nameKo === "운동 장비")).toBe(false);
    expect(model.references.some((item) => item.nameKo === "무릎 패드")).toBe(false);
    expect(model.references.some((item) => item.nameKo === "손목 보호대")).toBe(false);
    expect(model.references.some((item) => item.nameKo === "리프팅 스트랩")).toBe(false);
    const html = shelfHtml(model);
    expect(html).not.toContain("운동 장비");
    expect(html).not.toContain("페달 토스트랩");
    expect(html).not.toContain("토스트랩");
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(anchors).toEqual(PARTNER_HREFS);
    for (const card of CONFIRMED_PARTNERS) {
      expect(html).toContain(`href="${card.href}"`);
      expect(html).toContain(card.imageUrl);
    }
    expect(html).not.toContain("coupang.com/np/search");
    for (const href of REJECTED_HREFS) expect(html).not.toContain(href);
  });

  it("drops a pedal toe-strap card from the bundled page and from an overlay that replaces the catalog", () => {
    const bundled = shelfHtml();
    expect(bundled).not.toContain("페달");
    expect(bundled).not.toContain("토스트랩");
    expect(bundled).not.toContain("pedal-toe-strap");
    expect(gearPageModel().partners).toHaveLength(14);
    expect(gearPageModel().disclosure).toBe(GEAR_DISCLOSURE);
    expect(bundled.match(/hvCaduhQ8O/g)).toHaveLength(1);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-gear-pedal-"));
    const file = path.join(dir, "gear-affiliates.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        disclosureKo: "다른 고지",
        coupangPartnerId: "AF4475360",
        categories: [
          {
            id: "reference",
            nameKo: "참고",
            items: [
              {
                id: "pedal-toe-strap",
                nameKo: "페달 토스트랩",
                whyKo: "바이크 페달에 발을 고정하는 가죽 스트랩입니다.",
                imageUrl: "/gear/pedal-toe-strap.jpg",
                affiliateUrl: "",
                merchant: "쿠팡",
              },
              {
                id: "toe-strap-extra",
                nameKo: "토 스트랩",
                whyKo: "페달용 스트랩입니다.",
                imageUrl: "/gear/pedal-toe-strap.jpg",
                affiliateUrl: ONLY_PARTNER_HREF,
                merchant: "쿠팡",
              },
            ],
          },
        ],
      }),
    );
    process.env.GEAR_JSON_PATH = file;
    resetGearCache();
    const ignored = gearPageModel();
    expect(ignored.disclosure).toBe(GEAR_DISCLOSURE);
    expect(ignored.partners).toEqual(CONFIRMED_PARTNERS);
    expect(ignored.references).toEqual([]);
    const ignoredHtml = shelfHtml(ignored);
    expect(ignoredHtml).not.toContain("페달");
    expect(ignoredHtml).not.toContain("토스트랩");
    expect(ignoredHtml.match(/hvCaduhQ8O/g)).toHaveLength(1);

    const loaded = loadGearCatalog();
    expect(loaded.sourcePath).toBe(file);
    expect(referenceCards(loaded)).toEqual([]);
    const fromOverlay = shelfHtml({
      disclosure: GEAR_DISCLOSURE,
      partners: ignored.partners,
      references: referenceCards(loaded),
    });
    expect(fromOverlay).not.toContain("페달");
    expect(fromOverlay).not.toContain("토스트랩");
    expect(fromOverlay).not.toContain('data-gear="reference"');
  });
});

describe("gear page and nav", () => {
  it("renders the disclosure, confirmed partner links, and unlinked reference cards", () => {
    const model = gearPageModel();
    expect(model.partners.map((card) => card.href)).toEqual(PARTNER_HREFS);
    expect(model.partners[0]?.nameKo).toBe("KRATOS 접착식 훅 그립 테이프");
    expect(model.partners[0]?.whyKo).toBe("바벨 풀 때 손에 감는 훅 그립 테이프입니다.");
    expect(model.partners[0]?.href).toBe(ONLY_PARTNER_HREF);
    expect(model.partners[0]?.imageUrl).toBe(CONFIRMED_PARTNER.imageUrl);
    expect(model.partners.map((card) => card.nameKo)).toEqual([
      "KRATOS 접착식 훅 그립 테이프",
      "제로투히어로 네오프렌 무릎보호대 5mm 세트",
      "잠스트 리스트 랩 손목보호대, 1개, 블랙",
      "헬스 파워 리프팅 레버 역도 벨트, 레드블랙",
      "윈어블 복싱 RPM 더블언더 줄넘기",
      "엑스포디움 스티키 그립 마그네핏 손바닥보호대",
      "ComMa 가죽 리프팅그립 스트랩",
      "머슬가드 액상 탄마 초크 50ml",
      "제로투히어로 리프터 클래식 역도화",
      "짐프로 복근운동 AB매트",
      "바디스톤 월볼",
      "인피니티 풀업밴드",
      "트로비스 라크로스볼 땅콩 마사지볼",
      "제로투히어로 네오프렌 무릎보호대 7mm",
    ]);
    const wallBall = model.partners.find((card) => card.nameKo === "바디스톤 월볼");
    expect(wallBall?.whyKo).toBe("벽에 던져 스쿼트와 던지기를 같이 하는 공입니다.");
    expect(wallBall?.whyKo).not.toMatch(/20\s*(lb|kg)|파운드|킬로/i);
    expect(model.disclosure).toBe("이 화면은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.");
    const photos = model.references.map((item) => item.imageUrl);
    expect(new Set(photos).size).toBe(photos.length);
    for (const item of model.references) {
      const file = path.join(process.cwd(), "public", item.imageUrl);
      expect(fs.existsSync(file), item.imageUrl).toBe(true);
      expect(fs.statSync(file).size).toBeGreaterThan(5000);
    }

    const html = shelfHtml(model);
    const disclosureAt = html.indexOf(GEAR_DISCLOSURE);
    const partnerAt = html.indexOf('data-gear="partner"');
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(partnerAt).toBeGreaterThan(disclosureAt);
    expect(html).not.toContain('data-gear="reference"');
    expect(html).not.toContain("페달 토스트랩");
    expect(html).not.toContain("토스트랩");
    expect(html).not.toContain("아직 링크가 없어요");
    expect(html.match(/<a /g)).toHaveLength(PARTNER_HREFS.length);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer sponsored nofollow"');
    expect(html).toContain("쿠팡에서 보기");
    expect(html).not.toContain("클릭하세요");
    expect(html).not.toContain("지금 사세요");
    expect(html).not.toContain("AF4475360");
    expect(html).not.toMatch(/CrossFit/i);
    expect(html).not.toMatch(/<button/);
    expect(html).not.toContain("쿠폰");
    for (const href of REJECTED_HREFS) expect(html).not.toContain(href);
    expect(html).not.toMatch(/20\s*(lb|kg)/i);
    expect(html).not.toContain("20파운드");
    expect(html).not.toContain("20킬로");
    expect(html).not.toContain("무게는 적지 마세요");
    expect(html.match(/hvCaduhQ8O/g)).toHaveLength(1);
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(anchors).toEqual(PARTNER_HREFS);

    const referenceChunks = html.split('data-gear="reference"').slice(1);
    expect(model.references).toEqual([]);
    expect(referenceChunks).toHaveLength(0);
    for (const chunk of referenceChunks) {
      const card = chunk.slice(0, chunk.indexOf("</li>"));
      expect(card).not.toContain("<a");
      expect(card).not.toContain("<button");
      expect(card).not.toContain("href=");
      expect(card).toContain("gear-pending");
      expect(card).toContain("아직 링크가 없어요");
      expect(card).toContain("<img");
    }
    const partnerChunks = html.split('data-gear="partner"').slice(1);
    expect(partnerChunks).toHaveLength(model.partners.length);
    for (const chunk of partnerChunks) {
      const card = chunk.slice(0, chunk.indexOf("</li>"));
      expect(card).not.toContain("아직 링크가 없어요");
      expect(card).toContain("쿠팡에서 보기");
      expect(card).toContain("<img");
      expect(card.match(/<a /g)).toHaveLength(1);
    }

    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/gear/page.tsx"), "utf8");
    const titleAt = page.indexOf("<h1");
    const shelfAt = page.indexOf("<GearShelf");
    const navAt = page.indexOf("<Nav");
    expect(titleAt).toBeGreaterThan(-1);
    expect(shelfAt).toBeGreaterThan(titleAt);
    expect(navAt).toBeGreaterThan(shelfAt);
    expect(page).not.toMatch(/CrossFit/i);
    expect(page).not.toMatch(/AF4475360/);
    expect(page).not.toMatch(/href=/);
    const nav = fs.readFileSync(path.join(process.cwd(), "src/components/Nav.tsx"), "utf8");
    expect(nav).toMatch(/href: "\/gear"/);
    expect(nav).toMatch(/label: "장비"/);
    expect(nav).toMatch(/grid-cols-6/);
    expect(nav).toMatch(/tap /);
    const seed = fs.readFileSync(path.join(process.cwd(), "src/lib/db/seed.ts"), "utf8");
    expect(seed).not.toMatch(/DELETE FROM set_logs\b/);
    const entry = fs.readFileSync(path.join(process.cwd(), "docker-entrypoint.sh"), "utf8");
    expect(entry).toMatch(/gear-affiliates\.json/);
    expect(entry).toMatch(/\[ ! -f \/data\/gear-affiliates.json \]/);
    const deploy = fs.readFileSync(path.join(process.cwd(), "DEPLOY-CI.md"), "utf8");
    expect(deploy).toMatch(/gear-affiliates\.json/);
    expect(deploy).toMatch(/가짜 쿠팡 파트너 ID를 만들지 마세요/);
  });
});
