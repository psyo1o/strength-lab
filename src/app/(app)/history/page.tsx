import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { recentCardCopy, recentSessions } from "@/lib/progress";
import { Nav } from "@/components/Nav";

export const runtime = "nodejs";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const sessions = recentSessions(user.id, 30);

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">기록</h1>
      {sessions.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {sessions.map((s) => {
            const copy = recentCardCopy(s);
            return (
              <li key={`${s.date}-${s.programSlug}-${s.weekNumber}-${s.dayNumber}`}>
                <Link
                  href={`/session/${s.programSlug}/${s.weekNumber}/${s.dayNumber}`}
                  className="card tap block p-4"
                >
                  <div className="text-lg font-black leading-tight">{copy.title}</div>
                  <p className="mt-1 truncate text-sm text-[var(--muted)]">{copy.line}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <Nav current="/dashboard" />
    </main>
  );
}
