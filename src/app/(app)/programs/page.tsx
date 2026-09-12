import Link from "next/link";
import { listPrograms } from "@/lib/programs/queries";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

const BADGE: Record<string, string> = {
  full: "완전 작동",
  working: "진행 가능",
  template: "템플릿 전용",
};

export default async function ProgramsPage() {
  const programs = listPrograms();
  return (
    <main className="px-4 pt-6">
      <h1 className="text-2xl font-black">프로그램</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        완전 작동은 계산이 끝까지 됩니다. 템플릿은 주/일 골격만 있습니다.
      </p>
      <div className="mt-4 space-y-3">
        {programs.map((p) => (
          <Link key={p.slug} href={`/programs/${p.slug}`} className="card tap block p-4">
            <div className="text-xs font-bold text-[var(--accent)]">
              {p.category} · {BADGE[p.completeness]}
            </div>
            <div className="text-lg font-black">{p.name_ko}</div>
            <p className="mt-1 text-sm text-[var(--muted)]">{p.description_ko}</p>
          </Link>
        ))}
      </div>
      <Nav current="/programs" />
    </main>
  );
}
