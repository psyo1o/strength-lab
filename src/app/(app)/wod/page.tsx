import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes } from "@/lib/maxes";
import { Nav } from "@/components/Nav";
import { WodEstimateLine } from "@/components/WodEstimateCard";
import { RX_DISCLAIMER, familyLabel, formatLabel, type WodFamily } from "@/lib/wod/types";
import { estimateWod } from "@/lib/wod/estimate";
import { getWodTemplate, loadWodFile, todayWodSlug } from "@/lib/wod/templates";
import { listWodBoard } from "@/lib/wod/queries";

export const runtime = "nodejs";

const FAMILY_ORDER: WodFamily[] = ["girls", "hero", "benchmark"];

type BoardRow = ReturnType<typeof listWodBoard>[number];

function BoardList({
  rows,
  maxes,
}: {
  rows: BoardRow[];
  maxes: ReturnType<typeof getUserMaxes>;
}) {
  return (
    <ul className="mt-2 space-y-2">
      {rows.map((row) => {
        const estimate = estimateWod(row.slug, maxes);
        return (
          <li key={row.slug}>
            <Link href={`/wod/${row.slug}`} className="card tap block p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-lg font-black">{row.nameKo}</div>
                <div className="text-sm font-bold tabular-nums text-[var(--muted)]">
                  {row.prLabel ? `PR ${row.prLabel}` : formatLabel(row.format)}
                </div>
              </div>
              <p className="mt-1 text-sm text-[var(--muted)]">{row.prescriptionKo}</p>
              {estimate ? <WodEstimateLine estimate={estimate} /> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function WodIndexPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const todaySlug = todayWodSlug();
  const today = getWodTemplate(todaySlug);
  const board = listWodBoard(user.id);
  const maxes = getUserMaxes(user.id);
  const todayEstimate = today ? estimateWod(today.slug, maxes) : null;
  const used = new Set<string>();
  const familySections = FAMILY_ORDER.map((family) => {
    const rows = board.filter((row) => row.family === family);
    rows.forEach((row) => used.add(row.slug));
    return { family, title: familyLabel(family), rows };
  }).filter((section) => section.rows.length > 0);
  const leftoverBench = board.filter((row) => row.category === "benchmark" && !used.has(row.slug));
  leftoverBench.forEach((row) => used.add(row.slug));
  const conditioning = board.filter((row) => !used.has(row.slug));
  const sourceNote = loadWodFile().sourceNoteKo;

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">WOD / 벤치마크</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">공개된 컨디셔닝 패턴입니다. 유료 박스 프로그램이 아니에요.</p>
      <p className="mt-1 text-xs font-bold text-[var(--muted)]">{RX_DISCLAIMER}</p>

      {today ? (
        <Link href={`/wod/${today.slug}`} className="card tap mt-5 block p-5">
          <div className="text-sm font-bold text-[var(--accent)]">오늘 WOD</div>
          <div className="mt-1 text-2xl font-black">
            {today.nameKo} · {formatLabel(today.format)}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">{today.prescriptionKo}</p>
          {todayEstimate ? <WodEstimateLine estimate={todayEstimate} /> : null}
        </Link>
      ) : null}

      {familySections.map((section) => (
        <section key={section.family} className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">{section.title}</h2>
          <BoardList rows={section.rows} maxes={maxes} />
        </section>
      ))}

      {leftoverBench.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">벤치마크</h2>
          <BoardList rows={leftoverBench} maxes={maxes} />
        </section>
      ) : null}

      {conditioning.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">컨디셔닝</h2>
          <BoardList rows={conditioning} maxes={maxes} />
        </section>
      ) : null}

      {sourceNote ? <p className="mt-6 text-xs leading-relaxed text-[var(--muted)]">{sourceNote}</p> : null}
      <Nav current="/wod" />
    </main>
  );
}
