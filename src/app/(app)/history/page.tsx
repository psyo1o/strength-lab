import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { listTrainingHistory } from "@/lib/month-plan/history";
import { formatKoDate, trainingDayKey } from "@/lib/progress";

export const runtime = "nodejs";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const items = listTrainingHistory(user.id);

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">기록</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">만든 WOD, 벤치마크, 프로그램 세션이 한 목록에 남습니다.</p>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="card tap block min-w-0 p-4">
                <div className="text-xs font-bold text-[var(--muted)]">{formatKoDate(trainingDayKey(item.at))}</div>
                <div className="mt-1 break-words text-lg font-black leading-tight">{item.title}</div>
                <p className="mt-1 break-words text-sm text-[var(--muted)]">{item.line}</p>
                {item.scores.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {item.scores.map((score) => (
                      <li key={score.id} className="text-sm font-black tabular-nums">
                        {score.label}
                        {score.notesKo ? <span className="ml-2 font-bold text-[var(--muted)]">{score.notesKo}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.compares.map((compare) => (
                  <div key={compare.reason + compare.summaryKo} className="mt-2">
                    <p className="break-words text-sm font-black text-[var(--ok)]">{compare.summaryKo}</p>
                    <p className="text-xs font-bold text-[var(--muted)]">{compare.reasonKo}</p>
                  </div>
                ))}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Nav current="/dashboard" />
    </main>
  );
}
