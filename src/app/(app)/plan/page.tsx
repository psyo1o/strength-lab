import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { PlanWeekScreen } from "@/components/PlanDateBrowse";
import { TodaySessionCard } from "@/components/TodaySessionCard";
import { isPlanDate, loadPlanScreen } from "@/lib/month-plan/plan-browse";

export const runtime = "nodejs";
export const maxDuration = 300;

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  if (user.status !== "active") redirect("/pending");
  const params = await searchParams;
  const query = typeof params.date === "string" && isPlanDate(params.date) ? params.date : null;
  // A date query only reads. Without one, the current class week is still ensured on first open.
  const { browse, today } = await loadPlanScreen({ date: query, userId: user.id, isAdmin: user.isAdmin });

  return (
    <main className="min-w-0 px-4 pt-6 pb-fixed-stack">
      <h1 className="text-2xl font-black">월간 계획</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        스쿼트, 프레스, 벤치, 데드 무게는 저장한 1RM으로만 계산합니다. 1RM이 없으면 무게를 적지 않습니다. 한 달의 방식은 그 달 블록에서 정합니다.
      </p>
      {today ? <TodaySessionCard today={today} /> : null}
      <PlanWeekScreen browse={browse} />
      <p className="mt-6 text-center text-sm">
        <Link href="/history" className="font-bold text-[var(--accent)]">
          지난 기록 보기
        </Link>
      </p>
      <Nav />
    </main>
  );
}
