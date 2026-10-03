import { NextResponse } from "next/server";
import { getCurrentUser, readUserSex } from "@/lib/auth";
import { ensureClassWeek, sharedToday } from "@/lib/month-plan/class-week";
import { orderedDays } from "@/lib/month-plan/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const plan = await ensureClassWeek();
  const today = await sharedToday(user.id);
  return NextResponse.json({
    sex: readUserSex(user.id),
    plan: {
      id: plan.id,
      weekIndex: plan.weekIndex,
      weekStart: plan.weekStart,
      days: orderedDays(plan).map((day) => day.day),
    },
    today: { planId: today.planId, day: today.day.day, href: today.href },
  });
}

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const plan = await ensureClassWeek();
  const today = await sharedToday(user.id);
  return NextResponse.json({
    ok: true,
    planId: plan.id,
    weekIndex: plan.weekIndex,
    weekStart: plan.weekStart,
    href: `/plan/w/${plan.weekStart}`,
    today: { day: today.day.day, href: today.href },
  });
}
