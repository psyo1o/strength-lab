"use client";

import { useState } from "react";
import { SetRow } from "./SetRow";
import { RestTimer } from "./RestTimer";
import type { ResolvedExercise } from "@/lib/programs/queries";

const ROLE: Record<string, string> = {
  warmup: "워밍업",
  main: "본운동",
  bbb: "BBB",
  assistance: "보조",
  technique: "테크닉",
};

export function WorkoutClient({ exercises }: { exercises: ResolvedExercise[] }) {
  const [openTip, setOpenTip] = useState<string | null>(exercises[0]?.exerciseKey ?? null);
  const [rest, setRest] = useState({ running: false, seconds: 90 });

  return (
    <div className="space-y-6 pb-28">
      {exercises.map((ex) => (
        <section key={ex.id} className="space-y-2">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--accent)]">
                {ROLE[ex.role] ?? ex.role}
              </div>
              <h2 className="text-xl font-black">{ex.nameKo}</h2>
              {ex.notesKo ? <p className="text-sm text-[var(--muted)]">{ex.notesKo}</p> : null}
            </div>
            <button
              type="button"
              className="btn-ghost tap px-3 text-xs font-bold"
              onClick={() => setOpenTip(openTip === ex.exerciseKey ? null : ex.exerciseKey)}
            >
              팁
            </button>
          </div>
          {openTip === ex.exerciseKey && ex.tipsKo ? (
            <p className="card p-3 text-sm leading-relaxed text-[var(--text)]">{ex.tipsKo}</p>
          ) : null}
          <div className="space-y-2">
            {ex.sets.map((s) => (
              <SetRow
                key={s.id}
                setId={s.id}
                setNumber={s.setNumber}
                display={s.display}
                reps={s.reps}
                amrap={s.amrap}
                percent={s.percent}
                percentBase={s.percentBase}
                plates={s.plates}
                noteKo={s.noteKo}
                done={s.done}
                onStartRest={(sec) => setRest({ running: true, seconds: s.restSec || sec })}
              />
            ))}
          </div>
        </section>
      ))}
      <RestTimer
        seconds={rest.seconds}
        running={rest.running}
        onStop={() => setRest((r) => ({ ...r, running: false }))}
      />
    </div>
  );
}
