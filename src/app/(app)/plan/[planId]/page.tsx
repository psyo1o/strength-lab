import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PlanDayList } from "@/components/PlanDayList";
import { getPlan, orderedDays } from "@/lib/month-plan/store";

export const runtime = "nodejs";

export default async function StoredPlanPage({ params }: { params: Promise<{ planId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { planId } = await params;
  const plan = getPlan(user.id, Number(planId));
  if (!plan) notFound();

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <Link href="/plan" className="text-sm font-bold text-[var(--accent)]">
        ← 월간 계획
      </Link>
      <h1 className="mt-2 text-2xl font-black">{plan.weekIndex}주 WOD</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">{plan.weekStart} 주. 만든 주는 바로 그 주의 계획입니다.</p>
      <PlanDayList planId={plan.id} days={orderedDays(plan)} />
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="font-bold text-[var(--accent)]">
          지난 기록 보기
        </Link>
      </p>
      <Nav />
    </main>
  );
}
