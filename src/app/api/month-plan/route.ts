import { NextResponse } from "next/server";
import { asAthleteSex, getCurrentUser, readUserSex } from "@/lib/auth";
import { currentWeekPlan, generatePlanForUser, orderedDays, todayPlanDay } from "@/lib/month-plan/store";
import { isDayKey, type DayKey } from "@/lib/month-plan/types";

export const runtime = "nodejs";

function trainingDays(value: unknown): DayKey[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const days = value.map((day) => String(day)).filter(isDayKey);
  return days.length ? days : undefined;
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const plan = currentWeekPlan(user.id);
  const today = todayPlanDay(user.id);
  return NextResponse.json({
    sex: readUserSex(user.id),
    plan: plan
      ? {
          id: plan.id,
          weekIndex: plan.weekIndex,
          weekStart: plan.weekStart,
          days: orderedDays(plan).map((day) => day.day),
        }
      : null,
    today: today ? { planId: today.planId, day: today.day.day, href: today.href } : null,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const weekIndex = Number(body.weekIndex);
  const sex = "sex" in body ? asAthleteSex(body.sex) : readUserSex(user.id);
  const created = generatePlanForUser(user.id, {
    weekIndex,
    sex,
    trainingDays: trainingDays(body.trainingDays),
  });
  if ("error" in created) return NextResponse.json({ error: created.error }, { status: 400 });
  const today = todayPlanDay(user.id);
  return NextResponse.json({
    ok: true,
    planId: created.id,
    weekIndex: created.weekIndex,
    weekStart: created.weekStart,
    href: `/plan/${created.id}`,
    today: today ? { day: today.day.day, href: today.href } : null,
  });
}
