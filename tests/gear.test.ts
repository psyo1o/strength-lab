import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { GearShelf } from "../src/components/GearShelf";
import {
  CONFIRMED_PARTNER,
  GEAR_DISCLOSURE,
  ONLY_PARTNER_HREF,
  gearPageModel,
  isConfiguredAffiliateUrl,
  isOutboundPartnerHref,
  listGearItems,
  loadGearCatalog,
  resetGearCache,
  type GearPageModel,
} from "../src/lib/gear/affiliates";

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
    expect(items.map((item) => item.nameKo)).toEqual(["리프팅 스트랩", "무릎 패드", "손목 보호대", "페달 토스트랩"]);
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
    expect(model.partner).toEqual(CONFIRMED_PARTNER);
    expect(model.references.map((item) => item.nameKo)).toEqual([
      "리프팅 스트랩",
      "무릎 패드",
      "손목 보호대",
      "페달 토스트랩",
    ]);
    expect(model.references.some((item) => item.nameKo === "운동 장비")).toBe(false);
    const html = shelfHtml(model);
    expect(html).not.toContain("운동 장비");
    const anchors = [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((match) => match[1]);
    expect(anchors).toEqual([ONLY_PARTNER_HREF]);
    expect(html).toContain(`href="${ONLY_PARTNER_HREF}"`);
    expect(html).not.toContain("coupang.com/np/search");
  });
});

describe("gear page and nav", () => {
  it("renders the disclosure, one partner link, and unlinked reference cards", () => {
    const model = gearPageModel();
    expect(model.partner?.nameKo).toBe("KRATOS 접착식 훅 그립 테이프");
    expect(model.partner?.whyKo).toBe("바벨 풀 때 손에 감는 훅 그립 테이프입니다.");
    expect(model.partner?.href).toBe(ONLY_PARTNER_HREF);
    expect(model.partner?.imageUrl).toBe(CONFIRMED_PARTNER.imageUrl);
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
    const referenceAt = html.indexOf('data-gear="reference"');
    expect(disclosureAt).toBeGreaterThan(-1);
    expect(partnerAt).toBeGreaterThan(disclosureAt);
    expect(referenceAt).toBeGreaterThan(partnerAt);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer sponsored nofollow"');
    expect(html).toContain("쿠팡에서 보기");
    expect(html).not.toContain("클릭하세요");
    expect(html).not.toContain("지금 사세요");
    expect(html).not.toContain("AF4475360");
    expect(html).not.toMatch(/CrossFit/i);
    expect(html).not.toMatch(/<button/);

    const referenceChunks = html.split('data-gear="reference"').slice(1);
    expect(referenceChunks).toHaveLength(model.references.length);
    for (const chunk of referenceChunks) {
      const card = chunk.slice(0, chunk.indexOf("</li>"));
      expect(card).not.toContain("<a");
      expect(card).not.toContain("<button");
      expect(card).not.toContain("href=");
      expect(card).toContain("gear-pending");
      expect(card).toContain("준비 중");
      expect(card).toContain("<img");
    }
    const partnerCard = html.slice(partnerAt, referenceAt);
    expect(partnerCard).not.toContain("준비 중");
    expect(partnerCard).toContain("쿠팡에서 보기");

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
