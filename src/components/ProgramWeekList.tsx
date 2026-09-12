"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { P1_META } from "@/lib/programs/p1-meta";

type Week = { id: number; week_number: number; name_ko: string; notes_ko: string };
type Day = { id: number; day_number: number; name_ko: string; notes_ko: string };

export function ProgramWeekList({
  slug,
  weeks,
  daysByWeek,
}: {
  slug: string;
  weeks: Week[];
  daysByWeek: Record<number, Day[]>;
}) {
  const meta = P1_META[slug];
  const pickers = meta?.phases ?? meta?.classes ?? [];
  const [pick, setPick] = useState(pickers[0]?.id ?? "");
  const start = pickers.find((p) => p.id === pick)?.weekStart ?? 1;
  const visible = useMemo(() => {
    if (!pickers.length) return weeks;
    const next = pickers
      .map((p) => p.weekStart)
      .filter((n) => n > start)
      .sort((a, b) => a - b)[0];
    return weeks.filter((w) => w.week_number >= start && (next == null || w.week_number < next));
  }, [weeks, pickers, start]);

  return (
    <div className="mt-6 space-y-5">
      {pickers.length ? (
        <div className="flex flex-wrap gap-2">
          {pickers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPick(p.id)}
              className={`tap rounded-full px-4 py-2 text-sm font-black ${
                pick === p.id ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      {visible.map((w) => {
        const blocked = meta?.unavailableWeeks?.includes(w.week_number);
        const days = daysByWeek[w.id] ?? [];
        return (
          <section key={w.id}>
            <h2 className="font-black">{w.name_ko}</h2>
            {w.notes_ko ? <p className="text-xs text-[var(--muted)]">{w.notes_ko}</p> : null}
            {blocked ? (
              <p className="mt-2 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm">
                이 주는 아직 없습니다.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {days.map((d) => (
                  <Link
                    key={d.id}
                    href={`/session/${slug}/${w.week_number}/${d.day_number}`}
                    className="card tap block p-4 font-bold"
                  >
                    {d.name_ko}
                    {d.notes_ko ? (
                      <div className="text-xs font-normal text-[var(--muted)]">{d.notes_ko}</div>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
