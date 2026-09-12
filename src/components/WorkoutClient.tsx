"use client";

import { useEffect, useMemo, useState } from "react";
import { calculatePlates, defaultBar, formatPerSide } from "@/lib/calc/plates";
import { displayWeight } from "@/lib/calc/round";
import type { ResolvedExercise } from "@/lib/programs/queries";
import type { Tip } from "@/lib/tips";
import { BottomSheet } from "./BottomSheet";
import { RestTimer } from "./RestTimer";

const ROLE: Record<string, string> = {
  warmup: "워밍업",
  main: "본운동",
  bbb: "BBB",
  assistance: "보조",
  technique: "테크닉",
};

type FlatSet = {
  exercise: ResolvedExercise;
  set: ResolvedExercise["sets"][number];
  index: number;
  total: number;
};

export function WorkoutClient({
  exercises,
  tips,
  disclaimer,
  unit,
  sessionPath,
  programSlug,
}: {
  exercises: ResolvedExercise[];
  tips: Record<string, Tip>;
  disclaimer: string;
  unit: "kg" | "lb";
  sessionPath: string;
  programSlug: string;
}) {
  const flat = useMemo<FlatSet[]>(() => {
    const rows: FlatSet[] = [];
    for (const ex of exercises) {
      ex.sets.forEach((s, i) => rows.push({ exercise: ex, set: s, index: i + 1, total: ex.sets.length }));
    }
    return rows;
  }, [exercises]);

  const [done, setDone] = useState<Record<number, boolean>>(() => {
    const init: Record<number, boolean> = {};
    for (const row of flat) if (row.set.done) init[row.set.id] = true;
    return init;
  });
  const [cursor, setCursor] = useState(() => Math.max(0, flat.findIndex((r) => !r.set.done)));
  const [rest, setRest] = useState({ running: false, seconds: 90 });
  const [tipOpen, setTipOpen] = useState(false);
  const [plateOpen, setPlateOpen] = useState(false);

  useEffect(() => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastSession: sessionPath, currentProgram: programSlug }),
    });
  }, [sessionPath, programSlug]);

  const current = flat[cursor] ?? flat[0];
  if (!current) return null;
  const tip = tips[current.exercise.exerciseKey];
  const bar = defaultBar(unit);

  function markDone() {
    const id = current.set.id;
    if (done[id]) {
      setDone((d) => ({ ...d, [id]: false }));
      void fetch("/api/sets/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId: id, completed: false }),
      });
      return;
    }
    setDone((d) => ({ ...d, [id]: true }));
    void fetch("/api/sets/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setId: id, completed: true }),
    });
    setRest({ running: true, seconds: current.set.restSec || 90 });
    const next = flat.findIndex((r, i) => i > cursor && !done[r.set.id] && r.set.id !== id);
    if (next >= 0) setCursor(next);
  }

  const plates =
    current.set.weightKg != null
      ? calculatePlates(displayWeight(current.set.weightKg, unit), unit, bar)
      : null;

  return (
    <div className="pb-36">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-bold text-[var(--accent)]">
            {ROLE[current.exercise.role] ?? current.exercise.role} · 세트 {current.index}/{current.total}
          </div>
          <h2 className="text-3xl font-black leading-tight">{current.exercise.nameKo}</h2>
        </div>
        <button
          type="button"
          aria-label="운동 팁"
          className="tap flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-elev)] text-2xl font-black text-[var(--accent)]"
          onClick={() => setTipOpen(true)}
        >
          ?
        </button>
      </div>

      <button
        type="button"
        onClick={() => current.set.display && setPlateOpen(true)}
        className="card mt-5 w-full p-6 text-left"
      >
        <div className="text-6xl font-black leading-none tabular-nums tracking-tight">
          {current.set.display ?? "—"}
        </div>
        <div className="mt-2 text-3xl font-black text-[var(--muted)]">
          × {current.set.reps}
          {current.set.amrap ? "+" : ""}
        </div>
        <div className="mt-3 text-sm text-[var(--muted)]">
          {current.set.percent != null
            ? `${current.set.percent}% ${current.set.percentBase === "tm" ? "TM" : current.set.percentBase === "ten_rm" ? "10RM" : "1RM"}`
            : "작업중량"}
        </div>
      </button>

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg bg-[#0f1117]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <RestTimer
          seconds={rest.seconds}
          running={rest.running}
          onStop={() => setRest((r) => ({ ...r, running: false }))}
        />
        <button type="button" className="btn-primary tap w-full text-xl" onClick={markDone}>
          {done[current.set.id] ? "완료 취소" : "완료 / 다음"}
        </button>
      </div>

      <BottomSheet open={tipOpen} title={current.exercise.nameKo} onClose={() => setTipOpen(false)}>
        <p className="text-base leading-relaxed">{tip?.sheet || current.exercise.tipsKo}</p>
        <p className="mt-4 text-xs text-[var(--muted)]">{disclaimer}</p>
      </BottomSheet>

      <BottomSheet open={plateOpen} title="원판" onClose={() => setPlateOpen(false)}>
        {plates ? (
          <div>
            <div className="text-5xl font-black tabular-nums">
              {plates.loadable}
              {unit}
            </div>
            <div className="mt-4 text-2xl font-black">
              바 {plates.bar}
              {unit}
            </div>
            <ul className="mt-4 space-y-2">
              {plates.perSide.length === 0 ? (
                <li className="text-xl font-bold text-[var(--muted)]">원판 없음</li>
              ) : (
                plates.perSide.map((p) => (
                  <li key={p.weight} className="flex justify-between text-3xl font-black tabular-nums">
                    <span>
                      {p.weight}
                      {unit}
                    </span>
                    <span>× {p.count}</span>
                  </li>
                ))
              )}
            </ul>
            <p className="mt-3 text-sm text-[var(--muted)]">한쪽 {formatPerSide(plates.perSide, unit)}</p>
          </div>
        ) : (
          <p>1RM을 저장하면 원판이 계산됩니다.</p>
        )}
      </BottomSheet>
    </div>
  );
}
