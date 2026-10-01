import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GEAR_DISCLOSURE,
  isConfiguredAffiliateUrl,
  listGearItems,
  loadGearCatalog,
  resetGearCache,
  visibleGearCategories,
} from "../src/lib/gear/affiliates";

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

  it("ships 6–10 placeholder slots with a clear disclosure and no live partner IDs", () => {
    delete process.env.GEAR_JSON_PATH;
    const catalog = loadGearCatalog();
    expect(catalog.disclosureKo).toBe(GEAR_DISCLOSURE);
    expect(catalog.categories.map((c) => c.nameKo)).toEqual(["운동 장비"]);
    const items = listGearItems(catalog);
    expect(items.map((item) => item.nameKo)).toEqual([
      "바벨",
      "원판",
      "줄넘기",
      "월볼",
      "케틀벨",
      "로잉 머신",
      "스키 에르그",
      "팬바이크",
    ]);
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length).toBeLessThanOrEqual(10);
    expect(items.every((item) => item.nameKo && item.whyKo)).toBe(true);
    expect(items.every((item) => !item.configured)).toBe(true);
    expect(visibleGearCategories(catalog)).toEqual([]);
    const bundled = fs.readFileSync(path.join(process.cwd(), "data", "gear-affiliates.json"), "utf8");
    expect(bundled).toMatch(/추천 링크이며, 구매 시 운영자에게 수수료가 발생할 수 있습니다/);
    expect(bundled).not.toMatch(/CrossFit/i);
    expect(bundled).not.toMatch(/\bTJ\b/);
    expect(bundled).not.toMatch(/완치|힐링|치료제|재활치료/);
    expect(bundled).not.toMatch(/coupang\.com/i);
    expect(bundled).not.toMatch(/link\.coupang/i);
    expect(bundled).not.toMatch(/partners\.coupang/i);
  });

  it("treats empty, example.com, and javascript URLs as 미설정", () => {
    expect(isConfiguredAffiliateUrl("")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://example.com/gear-slot")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://shop.example.net/x")).toBe(false);
    expect(isConfiguredAffiliateUrl("javascript:alert(1)")).toBe(false);
    expect(isConfiguredAffiliateUrl("https://www.coupang.com/np/search?q=belt")).toBe(true);
  });

  it("reads NAS overlay JSON without inventing partner links", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-gear-"));
    const file = path.join(dir, "gear-affiliates.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        disclosureKo: GEAR_DISCLOSURE,
        categories: [
          {
            id: "rope",
            nameKo: "로프(DU)",
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
    expect(catalog.categories).toHaveLength(1);
    expect(catalog.categories[0].items[0].configured).toBe(true);
    expect(catalog.categories[0].items[0].affiliateUrl).toContain("coupang.com");
  });

  it("hides a product when its URL is missing, blank, or not a real link", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-gear-hide-"));
    const file = path.join(dir, "gear-affiliates.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        disclosureKo: GEAR_DISCLOSURE,
        categories: [
          {
            id: "workout",
            nameKo: "운동 장비",
            items: [
              {
                id: "barbell",
                nameKo: "바벨",
                whyKo: "바벨 운동.",
                affiliateUrl: "https://www.coupang.com/np/search?q=barbell",
                merchant: "쿠팡",
              },
              { id: "plates", nameKo: "원판", whyKo: "원판.", affiliateUrl: "" },
              { id: "jump-rope", nameKo: "줄넘기", whyKo: "줄넘기." },
              { id: "wall-ball", nameKo: "월볼", whyKo: "월볼.", affiliateUrl: "   " },
              { id: "kettlebell", nameKo: "케틀벨", whyKo: "케틀벨.", affiliateUrl: "https://example.com/kb" },
              { id: "rower", nameKo: "로잉 머신", whyKo: "로잉.", affiliateUrl: "javascript:alert(1)" },
            ],
          },
          {
            id: "empty",
            nameKo: "없는 링크",
            items: [{ id: "ski", nameKo: "스키 에르그", whyKo: "스키.", affiliateUrl: "" }],
          },
        ],
      }),
    );
    process.env.GEAR_JSON_PATH = file;
    resetGearCache();
    const catalog = loadGearCatalog();
    expect(listGearItems(catalog).map((item) => item.id)).toEqual([
      "barbell",
      "plates",
      "jump-rope",
      "wall-ball",
      "kettlebell",
      "rower",
      "ski",
    ]);
    const visible = visibleGearCategories(catalog);
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe("workout");
    expect(visible[0].items.map((item) => item.id)).toEqual(["barbell"]);
    expect(visible[0].items[0].affiliateUrl).toBe("https://www.coupang.com/np/search?q=barbell");
  });
});

describe("gear page and nav", () => {
  it("renders disclosure, only linked products, and a logged-in 장비 tab", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/gear/page.tsx"), "utf8");
    expect(page).toMatch(/disclosureKo/);
    expect(page).toMatch(/visibleGearCategories/);
    expect(page).toMatch(/target="_blank"/);
    expect(page).toMatch(/rel="noopener noreferrer sponsored nofollow"/);
    expect(page).not.toMatch(/링크 미설정/);
    expect(page).not.toMatch(/내 장비/);
    expect(page).not.toMatch(/CrossFit/i);
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
