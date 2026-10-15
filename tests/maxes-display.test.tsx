import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { memberLoad } from "../src/lib/calc/round";
import { commitMaxKg, presentStoredMax } from "../src/lib/max-display";
import { MaxesForm } from "../src/components/MaxesForm";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const STORED_KG = 200;

function field(unit: "kg" | "lb", storedKg: number | null) {
  return {
    key: "squat",
    nameKo: "스쿼트",
    value: presentStoredMax(storedKg, unit),
    storedKg,
    showStart: true,
    startValue: presentStoredMax(storedKg, unit),
    storedStartKg: storedKg,
  };
}

describe("1RM unit display", () => {
  it("shows the stored kilogram in the selected unit and keeps the full number", () => {
    expect(presentStoredMax.length).toBe(2);
    expect(presentStoredMax(STORED_KG, "kg")).toBe("200");
    expect(presentStoredMax(182.5, "kg")).toBe(String(memberLoad(182.5, "kg")));
    expect(presentStoredMax(null, "lb")).toBe("");
    expect(presentStoredMax(0, "kg")).toBe("");
    expect(presentStoredMax(undefined, "lb")).toBe("");

    const pounds = presentStoredMax(STORED_KG, "lb");
    expect(pounds).toBe(String(memberLoad(STORED_KG, "lb")));
    expect(pounds).toBe("441");
    expect(pounds).not.toMatch(/\./);

    const lbHtml = renderToStaticMarkup(
      <MaxesForm unit="lb" groups={[{ title: "파워리프팅", fields: [field("lb", STORED_KG)] }]} />,
    );
    expect(lbHtml).toContain(`value="${pounds}"`);
    expect(lbHtml).toContain(`title="${pounds}"`);
    expect(lbHtml).toContain(">lb<");
    expect(lbHtml).not.toContain(">kg<");
    expect(lbHtml).not.toMatch(/w-28|truncate|text-ellipsis|overflow-hidden|line-clamp/);
    expect(lbHtml).toContain("min-w-[8.5rem]");
    expect(lbHtml.match(new RegExp(`value="${pounds}"`, "g"))?.length).toBeGreaterThanOrEqual(2);

    const kgHtml = renderToStaticMarkup(
      <MaxesForm unit="kg" groups={[{ title: "파워리프팅", fields: [field("kg", STORED_KG)] }]} />,
    );
    expect(kgHtml).toContain('value="200"');
    expect(kgHtml).toContain(">kg<");
    expect(kgHtml).not.toContain(">lb<");
    expect(kgHtml).not.toContain(pounds);

    const wide = presentStoredMax(500, "lb");
    expect(wide).toBe("1102");
    const wideHtml = renderToStaticMarkup(
      <MaxesForm unit="lb" groups={[{ title: "파워리프팅", fields: [field("lb", 500)] }]} />,
    );
    expect(wideHtml).toContain('value="1102"');
    expect(wideHtml).toContain('title="1102"');

    expect(commitMaxKg(pounds, STORED_KG, "lb")).toBe(STORED_KG);
    expect(commitMaxKg("200", STORED_KG, "kg")).toBe(STORED_KG);
    expect(commitMaxKg("183", 182.5, "kg")).toBe(182.5);
    expect(commitMaxKg("", STORED_KG, "kg")).toBe(0);
    expect(commitMaxKg("225", null, "lb")).toBeCloseTo(225 * 0.45359237, 5);

    const page = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/maxes/page.tsx"), "utf8");
    const form = fs.readFileSync(path.join(process.cwd(), "src/components/MaxesForm.tsx"), "utf8");
    expect(page).toMatch(/unit=\{user\.unit\}/);
    expect(page).toMatch(/key=\{user\.unit\}/);
    expect(page).toMatch(/UnitToggle/);
    expect(page).toMatch(/presentStoredMax/);
    expect(page).not.toMatch(/unit="kg"/);
    expect(page).not.toMatch(/displayWeight\([^)]*"kg"/);
    expect(form).toMatch(/seenUnit !== unit/);
    expect(form).not.toMatch(/w-28/);
    expect(form).toMatch(/min-w-\[8\.5rem\]/);
  });
});
