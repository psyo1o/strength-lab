export type Completeness = "full" | "working" | "template";

/** Olympic P1 shells — W1 may load, but they are not complete programs. */
export const TEMPLATE_INCOMPLETE_SLUGS = ["bob-takano", "catalyst", "torokhtiy", "lbeb"] as const;

export const PARTIAL_TEMPLATE_SLUGS = ["cowboy"] as const;

const TEMPLATE_SET = new Set<string>(TEMPLATE_INCOMPLETE_SLUGS);
const PARTIAL_SET = new Set<string>(PARTIAL_TEMPLATE_SLUGS);

export function isTemplateIncomplete(slug: string, completeness?: Completeness): boolean {
  return TEMPLATE_SET.has(slug) || completeness === "template";
}

export function isPartialTemplate(slug: string): boolean {
  return PARTIAL_SET.has(slug);
}

export function programBadge(slug: string, completeness: Completeness): string {
  if (slug === "jim-wendler-531" || completeness === "full") return "완전 작동";
  if (isPartialTemplate(slug)) return "템플릿 · 부분";
  if (isTemplateIncomplete(slug, completeness)) return "템플릿 · 불완전";
  return "진행 가능";
}

export function programBanner(slug: string, completeness: Completeness): string | null {
  if (slug === "jim-wendler-531" || completeness === "full") return null;
  if (isPartialTemplate(slug)) {
    return "부분 템플릿입니다. 원본 Cowboy Method / Wendler 시트가 아니며, 자동 진행 전체를 주장하지 않습니다. 완전 작동 기준은 5/3/1입니다.";
  }
  if (isTemplateIncomplete(slug, completeness)) {
    return "템플릿 · 불완전. 주/일 골격과 %1RM만 있습니다. 원본 주기화·자동 진행 전체를 재현하지 않습니다. 완전 작동 기준은 Wendler 5/3/1입니다.";
  }
  return null;
}
