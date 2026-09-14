export type Completeness = "full" | "working" | "template";

/** Seed coverage labels. Not stored on the programs row; used only for badge/subtitle. */
export const PROGRAM_COVERAGE: Record<string, string> = {
  "bob-takano": "seeded_sample_not_full_cycle",
  catalyst: "seeded_sample_not_full_cycle",
  cowboy: "w1-13_full_sets",
  juggernaut: "w1-16_full_sets_plus_peaking",
  lbeb: "public-lbeb-12w-olympic",
};

const SAMPLE_CYCLE_SLUGS = new Set(["bob-takano", "catalyst", "torokhtiy"]);

export function coverageOf(slug: string, coverage?: string | null): string | undefined {
  return coverage || PROGRAM_COVERAGE[slug];
}

/**
 * Badge text. `seeded_sample_not_full_cycle` is NOT incomplete.
 * Locked empty weeks (`excel-w1-6-only`) stay 템플릿 · 불완전.
 */
export function programBadge(
  slug: string,
  completeness: Completeness,
  coverage?: string | null,
): string {
  const cov = coverageOf(slug, coverage);
  if (slug === "jim-wendler-531" || completeness === "full") return "완전 작동";
  if (cov === "excel-w1-6-only") return "템플릿 · 불완전";
  if (SAMPLE_CYCLE_SLUGS.has(slug) || cov === "seeded_sample_not_full_cycle") return "진행 가능";
  if (completeness === "working") return "진행 가능";
  if (completeness === "template") return "템플릿 · 불완전";
  return "진행 가능";
}

/** One-line note under the badge. Usable cycles do not say 불완전. */
export function programSubtitle(_slug: string, _coverage?: string | null): string | null {
  return null;
}

export function programBanner(
  slug: string,
  completeness: Completeness,
  coverage?: string | null,
): string | null {
  if (programBadge(slug, completeness, coverage) !== "템플릿 · 불완전") return null;
  return "템플릿 · 불완전. 일부 주에 세션이 없습니다. 시드된 주/일만 진행할 수 있습니다. 완전 작동 기준은 Wendler 5/3/1입니다.";
}
