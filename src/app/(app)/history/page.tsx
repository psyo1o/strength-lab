import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { recentCardCopy, recentSessions } from "@/lib/progress";
import { Nav } from "@/components/Nav";
import { getWodTemplate } from "@/lib/wod/templates";
import { listWodResults, wodCardCopy } from "@/lib/wod/queries";

export const runtime = "nodejs";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const sessions = recentSessions(user.id, 30).map((s) => {
    const copy = recentCardCopy(s);
    return {
      key: `s-${s.date}-${s.programSlug}-${s.weekNumber}-${s.dayNumber}`,
      at: s.latestAt,
      href: `/session/${s.programSlug}/${s.weekNumber}/${s.dayNumber}`,
      title: copy.title,
      line: copy.line,
    };
  });
  const wods = listWodResults(user.id, undefined, 30).map((row) => {
    const template = getWodTemplate(row.templateSlug);
    const copy = wodCardCopy(row, template?.nameKo ?? row.templateSlug);
    return {
      key: `w-${row.id}`,
      at: row.completedAt,
      href: `/wod/${row.templateSlug}`,
      title: copy.title,
      line: copy.line,
    };
  });
  const items = [...sessions, ...wods].sort((a, b) => b.at - a.at).slice(0, 40);

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">기록</h1>
      {items.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">아직 기록이 없습니다.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {items.map((s) => (
            <li key={s.key}>
              <Link href={s.href} className="card tap block min-w-0 p-4">
                <div className="break-words text-lg font-black leading-tight">{s.title}</div>
                <p className="mt-1 truncate text-sm text-[var(--muted)]" title={s.line}>
                  {s.line}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Nav current="/dashboard" />
    </main>
  );
}
