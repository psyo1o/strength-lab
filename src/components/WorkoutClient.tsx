"use client";

import { useMemo, useState } from "react";
import { calculatePlates, formatPerSide } from "@/lib/calc/plates";
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
}: {
  exercises: ResolvedExercise[];
  tips: Record<string, Tip>;
  disclaimer: string;
  unit: "kg" | "lb";
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
  const [tipKey, setTipKey] = useState<string | null>(null);
  const [plateOpen, setPlateOpen] = useState(false);

  const current = flat[cursor] ?? flat[0];
  if (!current) return null;
  const tip = tips[current.exercise.exerciseKey];

  async function mark(completed: boolean) {
    const id = current.set.id;
    setDone((d) => ({ ...d, [id]: completed }));
    void fetch("/api/sets/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ setId: id, completed }),
    });
    if (completed) {
      setRest({ running: true, seconds: current.set.restSec || 90 });
      const next = flat.findIndex((r, i) => i > cursor && !done[r.set.id]);
      if (next >= 0) setCursor(next);
    }
  }

  const plates =
    current.set.weightKg != null
      ? calculatePlates(displayWeight(current.set.weightKg, unit), unit)
      : null;

  return (
    <div className="space-y-4 pb-36">
      <div className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
        {ROLE[current.exercise.role] ?? current.exercise.role} · {current.index}/{current.total}
      </div>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-3xl font-black leading-none">{current.exercise.nameKo}</h2>
        <button type="button" className="btn-ghost tap px-4 text-base font-black" onClick={() => setTipKey(current.exercise.exerciseKey)}>
          팁
        </button>
      </div>
      {current.exercise.notesKo ? <p className="text-sm text-[var(--muted)]">{current.exercise.notesKo}</p> : null}

      <button type="button" onClick={() => current.set.display && setPlateOpen(true)} className="card tap w-full p-5 text-left">
        <div className="text-5xl font-black tabular-nums">
          {current.set.display ?? "—"}
          <span className="ml-2 text-2xl text-[var(--muted)]">
            × {current.set.reps}
            {current.set.amrap ? "+" : ""}
          </span>
        </div>
        <div className="mt-2 text-sm text-[var(--muted)]">
          {current.set.percent != null
            ? `${current.set.percent}% ${current.set.percentBase === "tm" ? "TM" : current.set.percentBase === "ten_rm" ? "10RM" : "1RM"}`
            : "작업중량"}
          {current.set.plates ? ` · 한쪽 ${current.set.plates}` : ""}
          {current.set.noteKo ? ` · ${current.set.noteKo}` : ""}
        </div>
        <div className="mt-1 text-xs text-[var(--accent)]">탭하면 원판 구성</div>
      </button>

      <div className="space-y-2">
        {current.exercise.sets.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setCursor(flat.findIndex((r) => r.set.id === s.id))}
            className={`card tap flex w-full items-center gap-3 px-3 text-left ${
              s.id === current.set.id ? "border-[var(--accent)]" : ""
            } ${done[s.id] ? "opacity-60" : ""}`}
          >
            <span
              className={`flex h-14 w-14 items-center justify-center rounded-xl text-lg font-black ${
                done[s.id] ? "bg-[var(--ok)] text-[#04210f]" : "bg-[var(--bg-elev)] text-[var(--accent)]"
              }`}
            >
              {done[s.id] ? "✓" : i + 1}
            </span>
            <span className="text-xl font-black">
              {s.display ?? "—"} × {s.reps}
              {s.amrap ? "+" : ""}
            </span>
          </button>
        ))}
      </div>

      <RestTimer
        seconds={rest.seconds}
        running={rest.running}
        onStop={() => setRest((r) => ({ ...r, running: false }))}
      />

      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto flex max-w-lg gap-3 px-4">
        <button
          type="button"
          className="btn-ghost tap flex-1 text-base font-black"
          onClick={() => setCursor(Math.max(0, cursor - 1))}
        >
          이전
        </button>
        <button
          type="button"
          className="btn-primary tap flex-[2] text-base"
          onClick={() => mark(!done[current.set.id])}
        >
          {done[current.set.id] ? "취소" : "완료 / 다음"}
        </button>
      </div>

      <BottomSheet open={Boolean(tipKey)} title="운동 팁" onClose={() => setTipKey(null)}>
        {tip ? (
          <div className="space-y-3 text-sm leading-relaxed">
            <p>{tip.sheet}</p>
            <p>
              <span className="font-bold">큐: </span>
              {tip.cue}
            </p>
            <p>
              <span className="font-bold">실수: </span>
              {tip.mistake}
            </p>
            <p>
              <span className="font-bold">대안: </span>
              {tip.alternative}
            </p>
            <p className="text-xs text-[var(--muted)]">{disclaimer}</p>
          </div>
        ) : (
          <p>{current.exercise.tipsKo}</p>
        )}
      </BottomSheet>

      <BottomSheet open={plateOpen} title="원판" onClose={() => setPlateOpen(false)}>
        {plates ? (
          <div>
            <div className="text-4xl font-black">
              {plates.loadable}
              {unit}
            </div>
            <p className="mt-2 text-lg font-bold">한쪽 {formatPerSide(plates.perSide, unit)}</p>
            <ul className="mt-3 space-y-1">
              {plates.perSide.map((p) => (
                <li key={p.weight} className="flex justify-between text-lg font-black">
                  <span>
                    {p.weight}
                    {unit}
                  </span>
                  <span>× {p.count}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>중량을 먼저 계산하세요.</p>
        )}
      </BottomSheet>
    </div>
  );
}
