import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes } from "@/lib/maxes";
import { listPrograms } from "@/lib/programs/queries";
import { displayWeight } from "@/lib/calc/round";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const maxes = getUserMaxes(user.id);
  const programs = listPrograms();
  const highlight = ["squat", "bench", "deadlift", "ohp"] as const;
  const labels: Record<string, string> = {
    squat: "스쿼트",
    bench: "벤치",
    deadlift: "데드",
    ohp: "OHP",
  };

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-widest text-[var(--accent)]">STRENGTH LAB</p>
          <h1 className="text-2xl font-black">오늘 뭐 하나요?</h1>
          <p className="text-sm text-[var(--muted)]">{user.email}</p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">1RM</h2>
          <Link href="/maxes" className="text-sm font-bold text-[var(--accent)]">
            수정
          </Link>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {highlight.map((k) => (
            <div key={k} className="card p-3 text-center">
              <div className="text-[10px] text-[var(--muted)]">{labels[k]}</div>
              <div className="text-lg font-black">
                {maxes[k] ? `${displayWeight(maxes[k], user.unit)}` : "—"}
                {maxes[k] ? <span className="text-[10px] text-[var(--muted)]"> {user.unit}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-3">
        <Link href="/session/wendler-531/1/4" className="card tap block p-4">
          <div className="text-xs font-bold text-[var(--accent)]">바로 시작</div>
          <div className="text-lg font-black">5/3/1 스쿼트 데이</div>
          <div className="text-sm text-[var(--muted)]">1주차 · 완전 작동 계산</div>
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/helper" className="card tap p-4 font-bold">
            1RM 계산
          </Link>
          <Link href="/plates" className="card tap p-4 font-bold">
            원판 계산
          </Link>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-2 font-bold">프로그램</h2>
        <div className="space-y-2">
          {programs.map((p) => (
            <Link key={p.slug} href={`/programs/${p.slug}`} className="card tap block p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold">{p.name_ko}</div>
                <Badge completeness={p.completeness} />
              </div>
              <div className="text-xs text-[var(--muted)]">{p.category}</div>
            </Link>
          ))}
        </div>
      </section>
      <Nav current="/dashboard" />
    </main>
  );
}

function Badge({ completeness }: { completeness: string }) {
  const map: Record<string, { t: string; c: string }> = {
    full: { t: "완전 작동", c: "text-[var(--ok)]" },
    working: { t: "진행 가능", c: "text-[var(--accent)]" },
    template: { t: "템플릿", c: "text-[var(--muted)]" },
  };
  const x = map[completeness] ?? map.template;
  return <span className={`text-xs font-extrabold ${x.c}`}>{x.t}</span>;
}
