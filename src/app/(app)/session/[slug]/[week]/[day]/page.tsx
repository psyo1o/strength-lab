import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { loadSessionWorkout } from "@/lib/programs/session-load";
import { UnitToggle } from "@/components/UnitToggle";
import { WorkoutClient } from "@/components/WorkoutClient";
import { CompletenessBanner } from "@/components/CompletenessBanner";

export const runtime = "nodejs";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ slug: string; week: string; day: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { slug, week, day } = await params;
  const loaded = loadSessionWorkout({
    slug,
    week: Number(week),
    day: Number(day),
    userId: user.id,
    unit: user.unit,
  });
  if (!loaded) notFound();
  const { program, workout, tips, disclaimer } = loaded;

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={`/programs/${program.slug}`} className="text-sm font-bold text-[var(--accent)]">
            ← {program.name_ko}
          </Link>
          <h1 className="mt-1 text-2xl font-black">{workout.nameKo}</h1>
          <p className="text-sm text-[var(--muted)]">
            {week}주차 · {day}일
          </p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      <CompletenessBanner slug={program.slug} completeness={program.completeness} />
      {workout.notesKo ? <p className="mt-3 text-sm text-[var(--muted)]">{workout.notesKo}</p> : null}
      {workout.exercises.some((e) => e.sets.some((s) => s.percentBase !== "none" && s.weightKg == null)) ? (
        <p className="mt-3 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm">
          중량이 비어 있습니다.{" "}
          <Link href="/maxes" className="font-bold text-[var(--accent)]">
            1RM 또는 시작 중량을 먼저 저장
          </Link>
          하세요.
        </p>
      ) : null}
      <div className="mt-5">
        <WorkoutClient
          exercises={workout.exercises}
          tips={tips}
          disclaimer={disclaimer}
          unit={user.unit}
          sessionPath={`/session/${program.slug}/${week}/${day}`}
          programSlug={program.slug}
        />
      </div>
    </main>
  );
}
