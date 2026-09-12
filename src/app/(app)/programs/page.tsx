import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProgram, listPrograms } from "@/lib/programs/queries";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

const BADGE: Record<string, string> = {
  full: "완전 작동",
  working: "진행 가능",
  template: "템플릿 전용",
};

export default async function ProgramsPage() {
  const user = await getCurrentUser();
  const programs = listPrograms();
  const pinned = user?.currentProgram ? getProgram(user.currentProgram) : undefined;
  const rest = programs.filter((p) => p.slug !== pinned?.slug);

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-3xl font-black">프로그램</h1>
      {pinned ? (
        <section className="mt-4">
          <div className="mb-2 text-sm font-bold text-[var(--accent)]">진행 중</div>
          <Link href={`/programs/${pinned.slug}`} className="card tap block p-5">
            <div className="text-xs font-bold text-[var(--ok)]">{BADGE[pinned.completeness]}</div>
            <div className="text-2xl font-black">{pinned.name_ko}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">{pinned.description_ko}</p>
          </Link>
        </section>
      ) : null}
      <div className="mt-5 space-y-3">
        {rest.map((p) => (
          <Link key={p.slug} href={`/programs/${p.slug}`} className="card tap block p-5">
            <div className="text-xs font-bold text-[var(--accent)]">
              {p.category} · {BADGE[p.completeness]}
            </div>
            <div className="text-xl font-black">{p.name_ko}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">{p.description_ko}</p>
          </Link>
        ))}
      </div>
      <Nav current="/programs" />
    </main>
  );
}
