import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes } from "@/lib/maxes";
import { getProgram, listPrograms } from "@/lib/programs/queries";
import { displayWeight } from "@/lib/calc/round";
import { dashboardProgress } from "@/lib/progress";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";

export const runtime = "nodejs";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const maxes = getUserMaxes(user.id);
  const programs = listPrograms();
  const current = user.currentProgram ? getProgram(user.currentProgram) : programs.find((p) => p.completeness === "full");
  const todayHref = user.lastSession || (current ? `/programs/${current.slug}` : "/programs");
  const highlight = ["squat", "bench", "deadlift", "ohp"] as const;
  const labels: Record<string, string> = {
    squat: "스쿼트",
    bench: "벤치",
    deadlift: "데드",
    ohp: "OHP",
  };
  const progress = dashboardProgress(user.id);

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold tracking-widest text-[var(--accent)]">STRENGTH LAB</p>
          <h1 className="text-3xl font-black">오늘</h1>
        </div>
        <UnitToggle unit={user.unit} />
      </div>

      <Link href={todayHref} className="card tap mt-6 block p-5">
        <div className="text-sm font-bold text-[var(--accent)]">오늘의 운동</div>
        <div className="mt-1 text-3xl font-black leading-tight">
          {current?.name_ko ?? "프로그램 고르기"}
        </div>
        <div className="mt-2 text-base text-[var(--muted)]">탭해서 세트 체크</div>
      </Link>

      <section className="card mt-4 p-5">
        <div className="text-sm font-bold text-[var(--accent)]">연속 운동</div>
        {progress.streakDays > 0 ? (
          <>
            <div className="mt-1 text-4xl font-black tabular-nums">{progress.streakDays}일</div>
            <p className="mt-1 text-sm text-[var(--muted)]">하루 한 세트만 해도 이어집니다.</p>
          </>
        ) : (
          <>
            <div className="mt-1 text-2xl font-black">아직 없음</div>
            <p className="mt-1 text-sm text-[var(--muted)]">오늘 세트를 완료하면 시작됩니다.</p>
          </>
        )}
      </section>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold">1RM</h2>
          <Link href="/maxes" className="text-sm font-bold text-[var(--accent)]">
            입력
          </Link>
        </div>
        <Link href="/maxes" className="grid grid-cols-4 gap-2">
          {highlight.map((k) => (
            <div key={k} className="card tap p-3 text-center">
              <div className="text-[10px] text-[var(--muted)]">{labels[k]}</div>
              <div className="text-xl font-black">
                {maxes[k] ? `${displayWeight(maxes[k], user.unit)}` : "—"}
              </div>
            </div>
          ))}
        </Link>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 font-bold">최고 기록</h2>
        {progress.prs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">본운동 세트를 완료하면 여기에 남습니다.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {progress.prs.map((pr) => (
              <div key={pr.key} className="card p-4">
                <div className="text-xs text-[var(--muted)]">{pr.label}</div>
                <div className="text-3xl font-black tabular-nums">{displayWeight(pr.weightKg, user.unit)}</div>
                <div className="text-xs text-[var(--muted)]">완료한 세트 최고</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6 pb-4">
        <h2 className="mb-2 font-bold">최근 세션</h2>
        {progress.recent.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">기록이 아직 없습니다.</p>
        ) : (
          <ul className="space-y-2">
            {progress.recent.map((s) => (
              <li key={`${s.date}-${s.programSlug}-${s.weekNumber}-${s.dayNumber}`} className="card p-4">
                <div className="text-xs font-bold text-[var(--accent)]">{s.dateLabel}</div>
                <div className="text-lg font-black">{s.programNameKo}</div>
                <div className="mt-1 text-sm text-[var(--muted)]">
                  {s.lifts.length
                    ? s.lifts
                        .map((l) =>
                          l.weightKg != null ? `${l.nameKo} ${displayWeight(l.weightKg, user.unit)}` : l.nameKo,
                        )
                        .join(" · ")
                    : "세트 완료"}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Nav current="/dashboard" />
    </main>
  );
}
