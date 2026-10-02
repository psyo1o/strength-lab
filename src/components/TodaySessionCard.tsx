import Link from "next/link";
import type { ReactNode } from "react";
import {
  ROTATING_BENCHMARK_LABEL_KO,
  ROTATING_BENCHMARK_NOTE_KO,
  WEEK_PLAN_MISSING_KO,
  todaySessionModel,
} from "@/lib/month-plan/today-view";
import type { TodayPlan } from "@/lib/month-plan/store";

export function TodaySessionCard({ today }: { today: TodayPlan | null }) {
  const model = todaySessionModel(today);
  if (model.kind === "missing") {
    return (
      <section className="card mt-5 min-w-0 p-5">
        <div className="text-sm font-bold text-[var(--accent)]">오늘 WOD</div>
        <p className="mt-2 break-words text-base font-black">{WEEK_PLAN_MISSING_KO}</p>
      </section>
    );
  }

  return (
    <Link href={model.href} className="card tap mt-5 block min-w-0 p-5">
      <div className="text-sm font-bold text-[var(--accent)]">오늘 WOD</div>
      <div className="mt-1 break-words text-2xl font-black leading-tight">
        {model.weekIndex}주 · {model.labelKo}
      </div>
      {model.kind === "note" ? (
        <p className="mt-2 break-words text-sm text-[var(--muted)]">{model.noteKo}</p>
      ) : (
        <ol className="mt-3 space-y-3">
          {model.blocks.map((block) => (
            <li key={block.role}>
              <div className="break-words text-base font-black">{block.headingKo}</div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--muted)]">
                {block.bodyKo}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Link>
  );
}

export function RotatingBenchmarkCard({
  href,
  title,
  detail,
  extra,
}: {
  href: string;
  title: string;
  detail: string;
  extra?: ReactNode;
}) {
  return (
    <Link href={href} className="card tap mt-3 block min-w-0 p-5">
      <div className="text-sm font-bold text-[var(--accent)]">{ROTATING_BENCHMARK_LABEL_KO}</div>
      <p className="mt-1 text-sm text-[var(--muted)]">{ROTATING_BENCHMARK_NOTE_KO}</p>
      <div className="mt-1 break-words text-xl font-black leading-tight">{title}</div>
      <p className="mt-1 break-words text-sm text-[var(--muted)]">{detail}</p>
      {extra}
    </Link>
  );
}
