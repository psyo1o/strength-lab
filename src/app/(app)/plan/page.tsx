import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PlanDayList } from "@/components/PlanDayList";
import { TodaySessionCard } from "@/components/TodaySessionCard";
import { sharedToday, sharedWeekForUser } from "@/lib/month-plan/class-week";
import { orderedDays } from "@/lib/month-plan/store";

export const runtime = "nodejs";

export default async function PlanPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const plan = await sharedWeekForUser(user.id);
  const today = await sharedToday(user.id);

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">월간 계획</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        스쿼트, 프레스, 벤치, 데드는 저장한 1RM의 90%로 5/3/1 본세트를 만듭니다. 1RM이 없으면 무게를 적지 않습니다.
      </p>
      <TodaySessionCard today={today} />
      {plan ? (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">
            {plan.weekIndex}주 · {plan.weekStart} 주
          </h2>
          <PlanDayList planId={plan.id} weekStart={plan.weekStart} days={orderedDays(plan)} />
        </section>
      ) : null}
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="font-bold text-[var(--accent)]">
          지난 기록 보기
        </Link>
      </p>
      <Nav />
    </main>
  );
}
