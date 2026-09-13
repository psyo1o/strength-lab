import { programBadge, programBanner, type Completeness } from "@/lib/programs/completeness-ux";

export function CompletenessBanner({ slug, completeness }: { slug: string; completeness: Completeness }) {
  const text = programBanner(slug, completeness);
  if (!text) return null;
  return (
    <p className="mt-2 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm" role="status">
      <span className="font-bold">{programBadge(slug, completeness)}</span> — {text}
    </p>
  );
}
