import Link from "next/link";
import { notFound } from "next/navigation";
import { getProgram, listDays, listWeeks } from "@/lib/programs/queries";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function ProgramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const program = getProgram(slug);
  if (!program) notFound();
  const weeks = listWeeks(slug);

  return (
    <main className="px-4 pt-6">
      <Link href="/programs" className="text-sm font-bold text-[var(--accent)]">
        ← 목록
      </Link>
      <h1 className="mt-2 text-2xl font-black">{program.name_ko}</h1>
      {program.completeness === "template" ? (
        <p className="mt-2 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm">
          불완전 템플릿입니다. 주/일 골격과 %1RM 셸만 있으며 원본 주기화 전체를 재현하지 않습니다.
        </p>
      ) : null}
      <p className="mt-3 text-sm text-[var(--muted)]">{program.description_ko}</p>
      <div className="mt-6 space-y-5">
        {weeks.map((w) => {
          const days = listDays(w.id);
          return (
            <section key={w.id}>
              <h2 className="font-black">{w.name_ko}</h2>
              {w.notes_ko ? <p className="text-xs text-[var(--muted)]">{w.notes_ko}</p> : null}
              <div className="mt-2 space-y-2">
                {days.map((d) => (
                  <Link
                    key={d.id}
                    href={`/session/${slug}/${w.week_number}/${d.day_number}`}
                    className="card tap block p-4 font-bold"
                  >
                    {d.name_ko}
                    {d.notes_ko ? (
                      <div className="text-xs font-normal text-[var(--muted)]">{d.notes_ko}</div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <Nav current="/programs" />
    </main>
  );
}
