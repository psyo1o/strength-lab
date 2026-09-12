import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getDay, getProgram, getWeekId, resolveWorkout } from "@/lib/programs/queries";
import { UnitToggle } from "@/components/UnitToggle";
import { WorkoutClient } from "@/components/WorkoutClient";
import { tipDisclaimer, tipFor } from "@/lib/tips";

export const runtime = "nodejs";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ slug: string; week: string; day: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { slug, week, day } = await params;
  const program = getProgram(slug);
  const weekId = getWeekId(slug, Number(week));
  if (!program || !weekId) notFound();
  const dayRow = getDay(weekId, Number(day));
  if (!dayRow) notFound();
  const workout = resolveWorkout({ dayId: dayRow.id, userId: user.id, unit: user.unit });
  if (!workout) notFound();

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/programs/${slug}`} className="text-sm font-bold text-[var(--accent)]">
            ← {program.name_ko}
          </Link>
          <h1 className="mt-1 text-2xl font-black">{workout.nameKo}</h1>
          <p className="text-sm text-[var(--muted)]">
            {week}주차 · {day}일
          </p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      {program.completeness === "template" ? (
        <p className="mt-3 rounded-xl bg-[#2a1d12] p-3 text-sm">불완전 템플릿 — 참고용 골격입니다.</p>
      ) : null}
      {workout.notesKo ? <p className="mt-3 text-sm text-[var(--muted)]">{workout.notesKo}</p> : null}
      {workout.exercises.some((e) => e.sets.some((s) => s.percentBase !== "none" && s.weightKg == null)) ? (
        <p className="mt-3 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm">
          중량이 비어 있습니다.{" "}
          <Link href="/maxes" className="font-bold text-[var(--accent)]">
            1RM 또는 시작중량을 먼저 저장
          </Link>
          하세요.
        </p>
      ) : null}
      <div className="mt-5">
        <WorkoutClient
          exercises={workout.exercises}
          tips={Object.fromEntries(
            workout.exercises
              .map((e) => [e.exerciseKey, tipFor(e.exerciseKey)] as const)
              .filter((row): row is [string, NonNullable<ReturnType<typeof tipFor>>] => row[1] != null),
          )}
          disclaimer={tipDisclaimer()}
          unit={user.unit}
          sessionPath={`/session/${slug}/${week}/${day}`}
          programSlug={program.slug}
        />
      </div>
    </main>
  );
}
