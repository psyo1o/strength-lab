import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getProgram, listPrograms } from "@/lib/programs/queries";
import { formatWeight } from "@/lib/calc/round";
import { dashboardProgress, recentCardCopy } from "@/lib/progress";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const programs = listPrograms();
  const current = user.currentProgram
    ? getProgram(user.currentProgram)
    : programs.find((p) => p.completeness === "full");
  const todayHref = user.lastSession || (current ? `/programs/${current.slug}` : "/programs");
  const progress = dashboardProgress(user.id);
  const latest = progress.recent[0];
  const recentCopy = latest ? recentCardCopy(latest) : null;

  return (
    <main className="px-4 pt-6 pb-[calc(9.5rem+env(safe-area-inset-bottom))]">
      <p className="truncate text-base font-black">안녕 · {current?.name_ko ?? "프로그램 고르기"}</p>

      <Link href="/history" className="card tap mt-5 block p-5">
        <div className="text-sm font-bold text-[var(--accent)]">최근</div>
        {recentCopy ? (
          <>
            <div className="mt-1 text-xl font-black leading-tight">{recentCopy.title}</div>
            <p className="mt-1 truncate text-sm text-[var(--muted)]">{recentCopy.line}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-[var(--muted)]">아직 기록이 없습니다</p>
        )}
      </Link>

      <section className="card mt-3 p-5">
        <div className="text-sm font-bold text-[var(--accent)]">PR</div>
        <ul className="mt-2 space-y-1">
          {progress.prs.map((pr) => (
            <li key={pr.key} className="flex items-baseline justify-between gap-3 text-base">
              <span className="font-bold">{pr.label}</span>
              <span className="tabular-nums text-[var(--muted)]">
                {pr.weightKg > 0 ? formatWeight(pr.weightKg, user.unit) : "—"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card mt-3 p-5 text-center">
        <div className="text-sm font-bold text-[var(--accent)]">연속일</div>
        <div className="mt-1 text-6xl font-black tabular-nums leading-none">{progress.streakDays}</div>
        <p className="mt-2 text-lg font-black">일 연속</p>
      </section>

      <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-lg border-t border-[var(--line)] bg-[#0f1117]/95 px-4 py-3">
        <Link
          href={todayHref}
          className="btn-primary tap flex w-full items-center justify-center text-lg no-underline"
        >
          오늘 운동
        </Link>
      </div>
      <Nav current="/dashboard" />
    </main>
  );
}
