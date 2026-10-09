import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getClassPlanByStart, replaceClassWeek } from "@/lib/month-plan/class-week";
import { swapConditioningMovements } from "@/lib/month-plan/metcon-edit";
import { getPlan, replacePlanWeek } from "@/lib/month-plan/store";
import { isDayKey } from "@/lib/month-plan/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요해요." }, { status: 401 });
  if (!user.isAdmin) return NextResponse.json({ error: "관리자만 바꿀 수 있어요." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const planId = Number(body?.planId);
  const weekStart = typeof body?.weekStart === "string" ? body.weekStart : "";
  const day = typeof body?.day === "string" ? body.day : "";
  if (!isDayKey(day) || (!weekStart && !Number.isInteger(planId))) {
    return NextResponse.json({ error: "요청을 확인해 주세요." }, { status: 400 });
  }
  const plan = weekStart ? getClassPlanByStart(weekStart) : getPlan(user.id, planId);
  if (!plan) return NextResponse.json({ error: "이번 주 계획을 찾지 못했어요." }, { status: 404 });

  const picks = Array.isArray(body?.movements)
    ? body.movements.map((movement: { key?: unknown; amount?: unknown }) => ({
        key: typeof movement?.key === "string" ? movement.key : "",
        amount: typeof movement?.amount === "string" ? movement.amount : "",
      }))
    : [];
  const swapped = swapConditioningMovements(plan.week, day, plan.sex, picks);
  if ("error" in swapped) return NextResponse.json({ error: swapped.error }, { status: 400 });
  const saved = weekStart ? replaceClassWeek(weekStart, swapped.week) : replacePlanWeek(user.id, plan.id, swapped.week);
  if (!saved) return NextResponse.json({ error: "계획을 저장하지 못했어요." }, { status: 500 });
  const updated = weekStart ? getClassPlanByStart(weekStart) : getPlan(user.id, plan.id);
  const piece = updated?.week.days.find((row) => row.day === day)?.piece ?? null;
  return NextResponse.json({
    ok: true,
    movements: piece?.movements ?? [],
    signature: piece?.signature ?? "",
  });
}
