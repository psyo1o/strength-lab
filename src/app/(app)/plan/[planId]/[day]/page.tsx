import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PlanScoreForm } from "@/components/PlanScoreForm";
import { comparesForDay, loadHistoryContext } from "@/lib/month-plan/history";
import { MetconEditor } from "@/components/MetconEditor";
import { formatSetLine } from "@/lib/month-plan/loads";
import { conditioningEditable } from "@/lib/month-plan/metcon-edit";
import { catalogMovements } from "@/lib/month-plan/pieces";
import { getPlan, scoresForDay } from "@/lib/month-plan/store";
import { isDayKey } from "@/lib/month-plan/types";
import { scoreLabel } from "@/lib/month-plan/compare";
import { formatKoDate, trainingDayKey } from "@/lib/progress";

export const runtime = "nodejs";

export default async function PlanDayPage({ params }: { params: Promise<{ planId: string; day: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { planId, day: dayKey } = await params;
  if (!isDayKey(dayKey)) notFound();
  const plan = getPlan(user.id, Number(planId));
  if (!plan) notFound();
  const day = plan.week.days.find((row) => row.day === dayKey);
  if (!day) notFound();
  const ctx = loadHistoryContext(user.id);
  const compares = comparesForDay(ctx, plan, day);
  const scores = scoresForDay(ctx.scores, plan.id, day.day);

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <Link href={`/plan/${plan.id}`} className="text-sm font-bold text-[var(--accent)]">
        ← {plan.weekIndex}주
      </Link>
      <p className="mt-2 text-sm font-bold text-[var(--accent)]">
        {plan.weekIndex}주 · {day.labelKo}
        {day.optional ? " · 선택" : ""}
        {day.longPiece ? " · 긴 와드" : ""}
      </p>
      <h1 className="mt-1 break-words text-3xl font-black">{day.piece?.nameKo ?? day.lift?.nameKo ?? "휴식"}</h1>
      {day.optional ? (
        <p className="mt-2 text-sm text-[var(--muted)]">토요일은 선택입니다. 빠지면 월요일로 옮기지 않습니다.</p>
      ) : null}

      {compares.map((item) => (
        <section key={item.reason + item.reasonKo} className="card mt-4 p-4">
          <div className="text-xs font-bold text-[var(--muted)]">{item.reasonKo}</div>
          <p className="mt-1 break-words text-lg font-black">{item.summaryKo}</p>
        </section>
      ))}

      <div className="mt-4 space-y-3">
        {day.blocks.map((block) => (
          <section key={block.role} className={`card p-4 ${block.kept ? "" : "opacity-60"}`}>
            <div className="text-sm font-bold text-[var(--accent)]">
              {block.titleKo}
              {block.kept ? "" : " · 시간 없으면 뺌"}
              {block.role === "warmup" ? " · 8–12분" : block.minutes > 0 ? ` · ${block.minutes}분` : ""}
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">{block.bodyKo}</p>
            {block.strength ? (
              <ul className="mt-3 space-y-1">
                {block.strength.sets.map((set) => (
                  <li key={set.setIndex} className="font-black tabular-nums">
                    {formatSetLine(set)}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      {scores.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">이 날의 점수</h2>
          <ul className="mt-2 space-y-2">
            {scores.map((score) => (
              <li key={score.id} className="card px-4 py-3">
                <div className="font-black tabular-nums">{scoreLabel(score)}</div>
                <div className="text-sm text-[var(--muted)]">{formatKoDate(trainingDayKey(score.completedAt))}</div>
                {score.notesKo ? <p className="mt-1 text-sm">{score.notesKo}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {user.isAdmin && day.piece && conditioningEditable(plan.weekIndex, day) ? (
        <MetconEditor
          planId={plan.id}
          day={day.day}
          choices={catalogMovements(plan.sex)}
          selected={day.piece.movements}
        />
      ) : null}

      {day.piece ? <PlanScoreForm planId={plan.id} day={day.day} format={day.piece.format} /> : null}
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="font-bold text-[var(--accent)]">
          전체 기록
        </Link>
      </p>
      <Nav />
    </main>
  );
}
