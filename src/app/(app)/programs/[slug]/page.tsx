import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getProgram, listDays, listWeeks } from "@/lib/programs/queries";
import { Nav } from "@/components/Nav";
import { PinProgramButton } from "@/components/PinProgramButton";
import { ProgramWeekList } from "@/components/ProgramWeekList";
import { CompletenessBanner } from "@/components/CompletenessBanner";
import { programBadge, programSubtitle } from "@/lib/programs/completeness-ux";
import { helpOrDescription } from "@/lib/programs/copy-help";

export const runtime = "nodejs";

export default async function ProgramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await getCurrentUser();
  const program = getProgram(slug);
  if (!program) notFound();
  const weeks = listWeeks(slug);
  const subtitle = programSubtitle(program.slug);

  return (
    <main className="px-4 pt-6">
      <Link href="/programs" className="text-sm font-bold text-[var(--accent)]">
        ← 목록
      </Link>
      <h1 className="mt-2 text-2xl font-black">{program.name_ko}</h1>
      <p className="mt-1 text-xs font-bold text-[var(--accent)]">{programBadge(program.slug, program.completeness)}</p>
      {subtitle ? <p className="text-[11px] font-bold text-[var(--muted)]">{subtitle}</p> : null}
      <CompletenessBanner slug={program.slug} completeness={program.completeness} />
      <p className="mt-3 text-sm text-[var(--muted)]">{helpOrDescription(program.slug, program.description_ko)}</p>
      <PinProgramButton slug={program.slug} pinned={user?.currentProgram === program.slug} />
      <ProgramWeekList
        slug={program.slug}
        weeks={weeks}
        daysByWeek={Object.fromEntries(weeks.map((w) => [w.id, listDays(w.id)]))}
      />
      <Nav current="/programs" />
    </main>
  );
}
