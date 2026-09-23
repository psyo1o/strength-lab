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
  const phasePickers = meta?.phases ?? meta?.classes ?? [];
  const pickers = phasePickers.length ? [{ id: "all", label: "전체", weekStart: 0 }, ...phasePickers] : [];
  const [pick, setPick] = useState("all");
  const [weekChip, setWeekChip] = useState<number | "all">("all");
  const start = pickers.find((p) => p.id === pick)?.weekStart ?? 0;
  const visible = useMemo(() => {
    if (!pickers.length || pick === "all" || start <= 0) return weeks;
    const next = phasePickers
      .map((p) => p.weekStart)
      .filter((n) => n > start)
      .sort((a, b) => a - b)[0];
    return weeks.filter((w) => w.week_number >= start && (next == null || w.week_number < next));
  }, [weeks, pickers.length, pick, start, phasePickers]);
  const shown = weekChip === "all" ? visible : visible.filter((w) => w.week_number === weekChip);
  const locked = new Set(meta?.unavailableWeeks ?? []);

  return (
    <div className="mt-6 space-y-5">
      {meta?.listedBlocks?.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
          {meta.listedBlocks.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      ) : null}
      {pickers.length ? (
        <div className="flex flex-wrap gap-2">
          {pickers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setPick(p.id);
                setWeekChip("all");
              }}
              className={`tap max-w-full whitespace-normal rounded-full px-4 py-2 text-center text-sm font-black leading-tight ${
                pick === p.id ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      ) : null}
      {weeks.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setWeekChip("all")}
            className={`tap max-w-full whitespace-normal rounded-full px-3 py-1.5 text-center text-xs font-black leading-tight ${
              weekChip === "all" ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
            }`}
          >
            모든 주
          </button>
          {visible.map((w) => {
            const isLocked = locked.has(w.week_number);
            return (
              <button
                key={w.id}
                type="button"
                onClick={() => setWeekChip(w.week_number)}
                title={isLocked ? "잠금 — 시드된 세션 없음" : undefined}
                className={`tap max-w-full whitespace-normal rounded-full px-3 py-1.5 text-center text-xs font-black leading-tight ${
                  weekChip === w.week_number
                    ? "bg-[var(--accent)] text-[#1a1204]"
                    : isLocked
                      ? "bg-[var(--bg-elev)] text-[var(--muted)] opacity-60 line-through"
                      : "bg-[var(--bg-elev)] text-[var(--muted)]"
                }`}
              >
                {w.week_number}주{isLocked ? " · 잠금" : ""}
              </button>
            );
          })}
        </div>
      ) : null}
      {shown.map((w) => {
        const days = daysByWeek[w.id] ?? [];
        const empty = days.length === 0;
        return (
          <section key={w.id}>
            <h2 className="break-words font-black">{w.name_ko}</h2>
            {w.notes_ko ? <p className="text-xs text-[var(--muted)]">{w.notes_ko}</p> : null}
            {empty ? (
              <p className="mt-2 rounded-xl border border-[var(--line)] bg-[#2a1d12] p-3 text-sm">
                이 주는 아직 없습니다.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {days.map((d) =>
                  d.notes_ko === "휴식" || d.name_ko.includes("휴식") ? (
                    <div key={d.id} className="card p-4 text-sm font-bold text-[var(--muted)]">
                      {d.name_ko}
                      <div className="text-xs font-normal">휴식일</div>
                    </div>
                  ) : (
                    <Link
                      key={d.id}
                      href={`/session/${slug}/${w.week_number}/${d.day_number}`}
                      className="card tap block min-w-0 break-words p-4 font-bold"
                    >
                      {d.name_ko}
                      {d.notes_ko ? (
                        <div className="text-xs font-normal text-[var(--muted)]">{d.notes_ko}</div>
                      ) : null}
                    </Link>
                  ),
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
