import Link from "next/link";
import { Nav } from "@/components/Nav";
import { PlanScoreForm } from "@/components/PlanScoreForm";
import { MetconEditor } from "@/components/MetconEditor";
import { formatSetLine } from "@/lib/month-plan/loads";
import { conditioningEditable } from "@/lib/month-plan/metcon-edit";
import type { PlanScore } from "@/lib/month-plan/store";
import type { PieceMovement, PlannedDay, WeekIndex } from "@/lib/month-plan/types";
import { scoreLabel, type HistoryCompare } from "@/lib/month-plan/compare";
import { formatKoDate, trainingDayKey } from "@/lib/progress";

export function PlanDayView({
  planId,
  weekIndex,
  weekStart,
  backHref,
  day,
  isAdmin,
  compares,
  scores,
  choices,
}: {
  planId: number;
  weekIndex: WeekIndex;
  weekStart?: string;
  backHref: string;
  day: PlannedDay;
  isAdmin: boolean;
  compares: HistoryCompare[];
  scores: PlanScore[];
  choices: PieceMovement[];
}) {
  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <Link href={backHref} className="text-sm font-bold text-[var(--accent)]">
        ← {weekIndex}주
      </Link>
      <p className="mt-2 text-sm font-bold text-[var(--accent)]">
        {weekIndex}주 · {day.labelKo}
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

      {isAdmin && day.piece && conditioningEditable(weekIndex, day) ? (
        <MetconEditor
          planId={planId}
          weekStart={weekStart}
          day={day.day}
          choices={choices}
          selected={day.piece.movements}
        />
      ) : null}

      {day.piece ? (
        <PlanScoreForm planId={planId} weekStart={weekStart} day={day.day} format={day.piece.format} />
      ) : null}
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="font-bold text-[var(--accent)]">
          전체 기록
        </Link>
      </p>
      <Nav />
    </main>
  );
}
