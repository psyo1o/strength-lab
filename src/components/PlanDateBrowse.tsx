import Link from "next/link";
import type { PlanAdminStamp, PlanBrowse, GeneratedWeekLink } from "@/lib/month-plan/plan-browse";
import type { SessionBlock } from "@/lib/month-plan/types";

export function PlanAdminStampView({ admin }: { admin: PlanAdminStamp }) {
  return (
    <section className="card mt-4 space-y-1 p-4" aria-label="주 생성 정보">
      <h2 className="text-sm font-bold">주 상태</h2>
      <p className="text-sm leading-relaxed">상태 {admin.statusKo}</p>
      <p className="text-sm leading-relaxed">생성 시각 {admin.generatedAt ?? "없음"}</p>
      <p className="break-all text-sm leading-relaxed">프롬프트 버전 {admin.promptVersion ?? "없음"}</p>
      <p className="text-sm leading-relaxed">실패 사유 {admin.failureKo ?? "없음"}</p>
      <Link href={admin.wodHref} className="btn-ghost tap mt-2 flex items-center justify-center font-black">
        이 주 수정
      </Link>
    </section>
  );
}

export function PlanDateBar({ browse }: { browse: PlanBrowse }) {
  return (
    <div
      className="fixed inset-x-0 z-30 border-t border-[var(--line)] bg-[var(--bg)] px-3 py-2"
      style={{ bottom: "calc(var(--nav-bar) + env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto grid max-w-lg grid-cols-3 gap-2" aria-label="주 이동">
        <Link href={browse.prevHref} className="btn-ghost tap flex items-center justify-center px-2 text-center font-black">
          이전 주
        </Link>
        <Link href={browse.todayHref} className="btn-primary tap flex items-center justify-center px-2 text-center font-black">
          오늘
        </Link>
        <Link href={browse.nextHref} className="btn-ghost tap flex items-center justify-center px-2 text-center font-black">
          다음 주
        </Link>
      </div>
    </div>
  );
}

export function PlanWeekScreen({ browse }: { browse: PlanBrowse }) {
  return (
    <section className="mt-6">
      <h2 className="text-sm font-bold text-[var(--accent)]">
        {browse.weekIndex}주 · {browse.weekStart} 주
      </h2>
      <div className="mt-3 grid grid-cols-7 gap-1">
        {browse.days.map((day) => (
          <Link
            key={day.date}
            href={day.href}
            aria-current={day.selected ? "date" : undefined}
            className={`tap flex flex-col items-center justify-center rounded-xl border px-0.5 text-center ${
              day.selected ? "border-[var(--accent)] bg-[var(--bg-elev)] text-[var(--accent)]" : "border-[var(--line)]"
            }`}
          >
            <span className="text-xs font-bold">{day.labelKo.slice(0, 1)}</span>
            <span className="text-sm font-black tabular-nums">{day.date.slice(8, 10)}</span>
          </Link>
        ))}
      </div>
      <form action="/plan" method="get" className="mt-4 flex items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="text-sm font-bold">날짜</span>
          <input className="field mt-1" type="date" name="date" defaultValue={browse.date} />
        </label>
        <button className="btn-ghost tap shrink-0 px-4 font-black" type="submit">
          이동
        </button>
      </form>
      {browse.admin ? <PlanAdminStampView admin={browse.admin} /> : null}
      <ul className="mt-4 space-y-2">
        {browse.days.map((day) => (
          <li key={day.day}>
            <Link href={day.dayHref} className="card tap block min-w-0 p-4">
              <div className="break-words text-lg font-black">
                {day.labelKo} · {day.date}
              </div>
              <p className="mt-1 text-sm">상태 {day.statusKo}</p>
              <p className="text-sm text-[var(--muted)]">출처 {day.sourceKo}</p>
              {day.summaryKo ? <p className="mt-1 break-words text-sm text-[var(--muted)]">{day.summaryKo}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
      <PlanDateBar browse={browse} />
    </section>
  );
}

export function PlanDayStatus({
  labelKo,
  date,
  statusKo,
  sourceKo,
  blocks,
}: {
  labelKo: string;
  date: string;
  statusKo: string;
  sourceKo: string;
  blocks?: SessionBlock[] | null;
}) {
  return (
    <section className="mt-4">
      <h1 className="break-words text-3xl font-black">
        {labelKo} · {date}
      </h1>
      <p className="mt-2 text-base font-black">상태 {statusKo}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">출처 {sourceKo}</p>
      {blocks && blocks.length > 0 ? (
        <div className="mt-4 space-y-3">
          {blocks.map((block, index) => (
            <section key={`${block.role}-${index}`} className="card p-4">
              <div className="text-sm font-bold text-[var(--accent)]">{block.titleKo}</div>
              <p className="mt-2 whitespace-pre-wrap break-words text-base leading-relaxed">{block.bodyKo}</p>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function GeneratedWeekList({ weeks }: { weeks: GeneratedWeekLink[] }) {
  return (
    <section className="mt-6" aria-label="생성된 주">
      <h2 className="text-lg font-black">생성된 주</h2>
      {weeks.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">생성된 주가 없습니다.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {weeks.map((week) => (
            <li key={week.weekStart}>
              <Link href={week.href} className="card tap block p-4">
                <div className="text-lg font-black">{week.weekStart}</div>
                <p className="mt-1 text-sm">
                  상태 {week.statusKo} · 출처 {week.sourceKo}
                </p>
                <p className="break-all text-sm text-[var(--muted)]">프롬프트 버전 {week.promptVersion}</p>
                <p className="mt-1 text-sm font-bold text-[var(--accent)]">날짜별 보기</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
