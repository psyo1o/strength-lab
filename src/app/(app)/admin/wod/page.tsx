import Link from "next/link";
import { notFound } from "next/navigation";
import { Nav } from "@/components/Nav";
import { WodWeekEditor } from "@/components/WodWeekEditor";
import { getCurrentUser } from "@/lib/auth";
import { listEditableWeeks, listWeekEditions, loadWeekEditor } from "@/lib/wod-edit";

export const runtime = "nodejs";

export default async function AdminWodPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await getCurrentUser();
  if (!user?.isAdmin || user.status !== "active") notFound();
  const params = await searchParams;
  const weeks = listEditableWeeks();
  const weekStart = params.week && weeks.some((week) => week.weekStart === params.week) ? params.week : (weeks[0]?.weekStart ?? "");
  const editor = weekStart ? loadWeekEditor(weekStart) : null;
  const editions = editor ? listWeekEditions(editor.weekStart) : [];
  return (
    <main className="min-w-0 px-4 pt-6">
      <Link href="/members" className="text-sm font-bold text-[var(--accent)]">
        ← 회원
      </Link>
      <h1 className="mt-2 text-2xl font-black">주간 운동 수정</h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        한 주를 통째로 저장합니다. 저장 버전과 다르면 거절합니다. 원본 주는 바꾸지 않고 새 버전만 쌓습니다.
      </p>
      {weeks.length ? (
        <ul className="mt-4 flex flex-wrap gap-2">
          {weeks.map((week) => (
            <li key={week.weekStart}>
              <Link
                href={`/admin/wod?week=${week.weekStart}`}
                className={`btn-ghost tap inline-block font-bold ${week.weekStart === weekStart ? "text-[var(--accent)]" : ""}`}
              >
                {week.weekStart}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm">저장된 주가 없어요.</p>
      )}
      {editor ? (
        <WodWeekEditor
          weekStart={editor.weekStart}
          version={editor.version}
          catalogVersion={editor.catalogVersion}
          cells={editor.cells}
          editions={editions}
        />
      ) : null}
      <Nav current="/members" />
    </main>
  );
}
