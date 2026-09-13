import { loadSeedFile } from "../db/seed";

/** Program detail copy: seed `copy.help` wins over stored description. */
export function helpOrDescription(slug: string, fallback: string): string {
  const hit = loadSeedFile().programs.find((p) => p.slug === slug);
  return hit?.copy?.help || fallback;
}
