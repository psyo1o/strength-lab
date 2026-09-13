import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProgram, listPrograms } from "@/lib/programs/queries";
import { programBadge, programSubtitle } from "@/lib/programs/completeness-ux";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function ProgramsPage() {
  const user = await getCurrentUser();
  const programs = listPrograms();
  const pinned = user?.currentProgram ? getProgram(user.currentProgram) : undefined;
  const rest = programs.filter((p) => p.slug !== pinned?.slug);
  const pinnedSub = pinned ? programSubtitle(pinned.slug) : null;

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-3xl font-black">프로그램</h1>
      {pinned ? (
        <section className="mt-4">
          <div className="mb-2 text-sm font-bold text-[var(--accent)]">진행 중</div>
          <Link href={`/programs/${pinned.slug}`} className="card tap block p-5">
            <div className="text-xs font-bold text-[var(--ok)]">{programBadge(pinned.slug, pinned.completeness)}</div>
            {pinnedSub ? <div className="text-[11px] font-bold text-[var(--muted)]">{pinnedSub}</div> : null}
            <div className="text-2xl font-black">{pinned.name_ko}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">{pinned.description_ko}</p>
          </Link>
        </section>
      ) : null}
      <div className="mt-5 space-y-3">
        {rest.map((p) => {
          const sub = programSubtitle(p.slug);
          return (
          <Link key={p.slug} href={`/programs/${p.slug}`} className="card tap block p-5">
            <div className="text-xs font-bold text-[var(--accent)]">
              {p.category} · {programBadge(p.slug, p.completeness)}
            </div>
            {sub ? <div className="text-[11px] font-bold text-[var(--muted)]">{sub}</div> : null}
            <div className="text-xl font-black">{p.name_ko}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">{p.description_ko}</p>
          </Link>
          );
        })}
      </div>
      <Nav current="/programs" />
    </main>
  );
}
