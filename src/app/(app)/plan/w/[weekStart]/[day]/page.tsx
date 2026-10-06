import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PlanDayView } from "@/components/PlanDayView";
import { ensureClassWeekForStart, isClassWeekStart, listClassDayScores, presentClassWeek } from "@/lib/month-plan/class-week";
import { comparesForDay, loadHistoryContext } from "@/lib/month-plan/history";
import { getUserMaxes } from "@/lib/maxes";
import { knownMovementChoices } from "@/lib/month-plan/movement-choices";
import { intentForEditor, rankMovementChoices } from "@/lib/month-plan/movement-rank";
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
  const { weekStart, day: dayKey } = await params;
  if (!isClassWeekStart(weekStart) || !isDayKey(dayKey)) notFound();
  const stored = await ensureClassWeekForStart(weekStart);
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
      weekIndex={stored.weekIndex}
      weekStart={stored.weekStart}
      backHref="/plan"
      day={day}
      isAdmin={user.isAdmin}
      compares={compares}
      scores={scores}
      choices={rankMovementChoices(knownMovementChoices(stored.sex), intentForEditor(day, conditioningFor(stored.weekStart, day.day)))}
      unit={user.unit}
    />
  );
}
