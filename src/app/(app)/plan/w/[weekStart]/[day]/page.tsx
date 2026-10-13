import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PlanAdminStampView, PlanDateBar, PlanDayStatus } from "@/components/PlanDateBrowse";
import { PlanDayView } from "@/components/PlanDayView";
import { getClassPlanByStart, isClassWeekStart, listClassDayScores, presentClassWeek } from "@/lib/month-plan/class-week";
import { comparesForDay, loadHistoryContext } from "@/lib/month-plan/history";
import { getUserMaxes } from "@/lib/maxes";
import { knownMovementChoices } from "@/lib/month-plan/movement-choices";
import { intentForEditor, rankMovementChoices } from "@/lib/month-plan/movement-rank";
import { readClassDayBrowse } from "@/lib/month-plan/plan-browse";
import { scoresForDay } from "@/lib/month-plan/store";
import { isDayKey, type DayKey } from "@/lib/month-plan/types";
import { getProgrammingWeek } from "@/lib/programming/store";
import type { ConditioningDraft } from "@/lib/programming/types";

function conditioningFor(weekStart: string, day: DayKey): ConditioningDraft | null {
  try {
    return getProgrammingWeek(weekStart)?.draft.sessions.find((session) => session.day === day)?.conditioning ?? null;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const maxDuration = 300;

export default async function ClassDayPage({ params }: { params: Promise<{ weekStart: string; day: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.status !== "active") redirect("/pending");
  const { weekStart, day: dayKey } = await params;
  if (!isClassWeekStart(weekStart) || !isDayKey(dayKey)) notFound();
  // Opening a week address only reads. It does not create the week.
  const browse = readClassDayBrowse({ weekStart, day: dayKey, userId: user.id, isAdmin: user.isAdmin });
  const banner = (
    <>
      <p className="mt-3 text-sm font-black">상태 {browse.statusKo}</p>
      <p className="mt-1 text-sm text-[var(--muted)]">출처 {browse.sourceKo}</p>
      {browse.admin ? <PlanAdminStampView admin={browse.admin} /> : null}
    </>
  );
  const stored = getClassPlanByStart(weekStart);
  if (!stored || !browse.memberDay) {
    return (
      <main className="min-w-0 px-4 pt-6 pb-fixed-stack">
        <Link href={browse.backHref} className="tap inline-flex items-center text-sm font-bold text-[var(--accent)]">
          ← {browse.weekIndex}주
        </Link>
        <PlanDayStatus
          labelKo={browse.labelKo}
          date={browse.date}
          statusKo={browse.statusKo}
          sourceKo={browse.sourceKo}
          blocks={browse.adminFailedDay?.blocks ?? null}
        />
        {browse.admin ? <PlanAdminStampView admin={browse.admin} /> : null}
        <PlanDateBar browse={browse.week} />
        <Nav />
      </main>
    );
  }
  const presentedWeek = presentClassWeek(stored.week, getUserMaxes(user.id), user.unit);
  const day = presentedWeek.days.find((row) => row.day === dayKey);
  if (!day) notFound();
  const presented = { ...stored, week: presentedWeek };
  const ctx = loadHistoryContext(user.id);
  const compares = comparesForDay(ctx, presented, day, user.unit);
  const scores = scoresForDay(listClassDayScores(user.id, stored.id), stored.id, day.day);

  return (
    <PlanDayView
      planId={stored.id}
      weekIndex={browse.weekIndex}
      weekStart={stored.weekStart}
      backHref={browse.backHref}
      day={day}
      isAdmin={user.isAdmin}
      compares={compares}
      scores={scores}
      choices={rankMovementChoices(knownMovementChoices(stored.sex), intentForEditor(day, conditioningFor(stored.weekStart, day.day)))}
      unit={user.unit}
      banner={banner}
      dateBar={<PlanDateBar browse={browse.week} />}
    />
  );
}
