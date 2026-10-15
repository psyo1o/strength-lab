import { NextResponse } from "next/server";
import { getCurrentUser, readUserSex } from "@/lib/auth";
import { MemberAccessError } from "@/lib/generation-cap";
import { guardMemberRequest } from "@/lib/member-gate";
import { sharedToday, sharedWeekForUser } from "@/lib/month-plan/class-week";
import { orderedDays } from "@/lib/month-plan/store";

export const runtime = "nodejs";
export const maxDuration = 300;

async function open(userId: number) {
  const plan = await sharedWeekForUser(userId);
  const today = await sharedToday(userId);
  return { plan, today };
}

export async function GET(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { plan, today } = await open(user.id);
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
  } catch (error) {
    if (error instanceof MemberAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

export async function POST(req: Request) {
  const blocked = await guardMemberRequest(req);
  if (blocked) return blocked;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { plan, today } = await open(user.id);
    return NextResponse.json({
      ok: true,
      planId: plan.id,
      weekIndex: plan.weekIndex,
      weekStart: plan.weekStart,
      href: `/plan/w/${plan.weekStart}`,
      today: { day: today.day.day, href: today.href },
    });
  } catch (error) {
    if (error instanceof MemberAccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
