export type Completeness = "full" | "working" | "template";

export function programBadge(slug: string, completeness: Completeness): string {
  if (slug === "jim-wendler-531" || completeness === "full") return "완전 작동";
  if (completeness === "template") return "템플릿 · 불완전";
  return "진행 가능";
}

export function programBanner(slug: string, completeness: Completeness): string | null {
  if (slug === "jim-wendler-531" || completeness === "full") return null;
  if (completeness === "template") {
    return "템플릿 · 불완전. 일부 주에 세션이 없습니다. 시드된 주/일만 진행할 수 있습니다. 완전 작동 기준은 Wendler 5/3/1입니다.";
  }
  return null;
}
