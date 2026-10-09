import Link from "next/link";
import { daySummary } from "@/lib/month-plan/build-week";
import type { PlannedDay } from "@/lib/month-plan/types";

export function PlanDayList({
  planId,
  days,
  weekStart,
}: {
  planId: number;
  days: PlannedDay[];
  weekStart?: string;
}) {
  return (
    <ul className="mt-4 space-y-2">
      {days.map((day) => (
        <li key={day.day}>
          <Link href={weekStart ? `/plan/w/${weekStart}/${day.day}` : `/plan/${planId}/${day.day}`} className="card tap block min-w-0 p-4">
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <div className="min-w-0 break-words text-lg font-black">
                {day.labelKo}
                {day.optional ? " · 선택" : ""}
                {day.longPiece ? " · 긴 와드" : ""}
              </div>
              <div className="shrink-0 text-xs font-bold text-[var(--accent)]">{day.rest ? "휴식" : "WOD"}</div>
            </div>
            <p className="mt-1 break-words text-sm text-[var(--muted)]">{daySummary(day)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
