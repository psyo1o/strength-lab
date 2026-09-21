import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes } from "@/lib/maxes";
import { clientTipsFor, tipDisclaimer } from "@/lib/tips";
import { WodClient } from "@/components/WodClient";
import { WodEstimateCard } from "@/components/WodEstimateCard";
import { formatWodScore, listWodResults, wodPr } from "@/lib/wod/queries";
import { estimateWod } from "@/lib/wod/estimate";
import { getWodTemplate, toClientTemplate } from "@/lib/wod/templates";
import { categoryLabel, formatLabel, wodTipKeys } from "@/lib/wod/types";

export const runtime = "nodejs";

export default async function WodDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { slug } = await params;
  const template = getWodTemplate(slug);
  if (!template) notFound();
  const pr = wodPr(user.id, slug);
  const history = listWodResults(user.id, slug, 20).map((row) => ({
    id: row.id,
    completedAt: row.completedAt,
    tier: row.tier,
    score: formatWodScore(row),
  }));
  const tips = clientTipsFor(wodTipKeys(template));
  const maxes = getUserMaxes(user.id);
  const estimate = estimateWod(template.slug, maxes);

  return (
    <main className="px-4 pt-6">
      <Link href="/wod" className="text-sm font-bold text-[var(--accent)]">
        ← 벤치마크
      </Link>
      <p className="mt-2 text-sm font-bold text-[var(--accent)]">
        {categoryLabel(template.category)} · {formatLabel(template.format)}
      </p>
      <h1 className="mt-1 text-3xl font-black">{template.nameKo}</h1>
      <p className="mt-2 text-base leading-relaxed text-[var(--muted)]">{template.prescriptionKo}</p>
      {template.equipmentKo ? <p className="mt-1 text-sm text-[var(--muted)]">{template.equipmentKo}</p> : null}
      {estimate ? <WodEstimateCard estimate={estimate} /> : null}
      <WodClient
        template={toClientTemplate(template)}
        unit={user.unit}
        prLabel={pr ? formatWodScore(pr) : null}
        history={history}
        maxes={maxes}
        tips={tips}
        disclaimer={tipDisclaimer()}
      />
      <p className="pb-8 text-xs leading-relaxed text-[var(--muted)]">{template.sourceNoteKo}</p>
    </main>
  );
}
