import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { PlanDayView } from "@/components/PlanDayView";
import { comparesForDay, loadHistoryContext } from "@/lib/month-plan/history";
import { catalogMovementChoices } from "@/lib/month-plan/pieces";
import { getPlan, scoresForDay } from "@/lib/month-plan/store";
import { isDayKey } from "@/lib/month-plan/types";

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
    <PlanDayView
      planId={plan.id}
      weekIndex={plan.weekIndex}
      backHref={`/plan/${plan.id}`}
      day={day}
      isAdmin={user.isAdmin}
      compares={compares}
      scores={scores}
      choices={catalogMovementChoices(plan.sex)}
    />
  );
}
