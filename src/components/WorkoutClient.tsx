"use client";

import { useEffect, useMemo, useState } from "react";
import { calculatePlates, defaultBar, formatPerSide } from "@/lib/calc/plates";
import { juggernautWaveFromWeek } from "@/lib/calc/juggernaut";
import { displayWeight } from "@/lib/calc/round";
import type { ResolvedExercise } from "@/lib/programs/queries";
import type { Tip } from "@/lib/tip-copy";
import { TIP_SAFETY_FOOTER, tipHasVideo } from "@/lib/tip-copy";
import { BottomSheet } from "./BottomSheet";
import { RestTimer } from "./RestTimer";
import { TipMedia } from "./TipMedia";
import { TipVideoButtons } from "./TipVideoButtons";

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
  const weekFromPath = Number(sessionPath.split("/").filter(Boolean)[2]);
  const realizationWave = programSlug === "juggernaut" ? juggernautWaveFromWeek(weekFromPath) : null;
  const [amrapReps, setAmrapReps] = useState(5);
  const [hookMsg, setHookMsg] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lastSession: sessionPath, currentProgram: programSlug }),
    });
  }, [sessionPath, programSlug]);

  const current = flat[cursor] ?? flat[0];
  const askAmrap = Boolean(realizationWave && current?.set.amrap && current.exercise.role === "main");

  useEffect(() => {
    if (!current) return;
    setAmrapReps(current.set.reps || 1);
  }, [current?.set.id, current?.set.reps]);

  if (!current) return null;
  const tip = tips[current.exercise.exerciseKey];
  const hasVideo = tipHasVideo(tip);
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
        body: JSON.stringify({
        setId: id,
        completed: true,
        amrapReps: askAmrap ? amrapReps : undefined,
        weightKg: current.set.weightKg ?? null,
      }),
    })
      .then((r) => r.json())
      .then((data: { realization?: { newMaxKg?: number; exerciseKey?: string; wave?: string } | null }) => {
        if (data.realization?.newMaxKg) {
          setHookMsg(
            `${data.realization.exerciseKey} 1RM → ${data.realization.newMaxKg}kg (${data.realization.wave})`,
          );
        }
      })
      .catch(() => undefined);
    setRest({ running: true, seconds: current.set.restSec || 90 });
    const next = flat.findIndex((r, i) => i > cursor && !done[r.set.id] && r.set.id !== id);
    if (next >= 0) setCursor(next);
  }

  const plates =
    current.set.weightKg != null
      ? calculatePlates(displayWeight(current.set.weightKg, unit), unit, bar)
      : null;

  return (
    <div className="min-w-0 pb-fixed-session">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-bold text-[var(--accent)]">
            {ROLE[current.exercise.role] ?? current.exercise.role} · 세트 {current.index}/{current.total}
          </div>
          <h2 className="break-words text-3xl font-black leading-tight">{current.exercise.nameKo}</h2>
        </div>
        <TipVideoButtons hasVideo={hasVideo} onOpen={() => setTipOpen(true)} />
      </div>

      <button
        type="button"
        onClick={() => current.set.display && setPlateOpen(true)}
        className="card scroll-clear-cta mt-5 w-full min-w-0 p-5 text-left"
      >
        <div className="max-w-full break-words py-1 text-[clamp(2.5rem,14vw,3.75rem)] font-black leading-none tabular-nums tracking-tight">
          {current.set.display ?? "—"}
        </div>
        <div className="mt-2 text-3xl font-black text-[var(--muted)]">
          × {current.set.reps}
          {current.set.amrap ? "+" : ""}
        </div>
        <div className="mt-3 text-sm text-[var(--muted)]">{current.set.loadLabel}</div>
      </button>
      {askAmrap ? (
        <label className="mt-4 block rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] p-4">
          <span className="text-sm font-bold text-[var(--muted)]">실현 AMRAP 횟수 ({realizationWave})</span>
          <input
            type="number"
            min={1}
            step={1}
            value={amrapReps}
            onChange={(e) => setAmrapReps(Number(e.target.value) || 1)}
            className="mt-2 w-full bg-transparent text-4xl font-black tabular-nums outline-none"
          />
        </label>
      ) : null}
      {hookMsg ? <p className="mt-3 text-sm font-bold text-[var(--accent)]">{hookMsg}</p> : null}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[#0f1117]/95 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-2 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <RestTimer
            seconds={rest.seconds}
            running={rest.running}
            onStop={() => setRest((r) => ({ ...r, running: false }))}
          />
          <button type="button" className="btn-primary tap w-full px-3 text-xl" onClick={markDone}>
            {done[current.set.id] ? "완료 취소" : "완료 / 다음"}
          </button>
        </div>
      </div>

      <BottomSheet open={tipOpen} title={tip?.name || current.exercise.nameKo} onClose={() => setTipOpen(false)}>
        {tip ? (
          <div className="space-y-3 text-base leading-relaxed">
            {(tip.youtubeLinks ?? []).length > 0 ? (
              (tip.youtubeLinks ?? []).map((link) => (
                <TipMedia
                  key={link.youtubeUrl}
                  youtubeUrl={link.youtubeUrl}
                  youtubeCredit={link.youtubeCredit}
                  label={link.label}
                />
              ))
            ) : (
              <TipMedia youtubeUrl={tip.youtubeUrl} youtubeCredit={tip.youtubeCredit} />
            )}
            <p>
              <span className="font-black">큐 · </span>
              {tip.cue}
            </p>
            <p>
              <span className="font-black">실수 · </span>
              {tip.mistake}
            </p>
            <p>
              <span className="font-black">대안 · </span>
              {tip.alternative}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-base leading-relaxed">
            <TipMedia />
            <p>{current.exercise.tipsKo || "이 종목 팁이 아직 없습니다."}</p>
          </div>
        )}
        <p className="mt-4 text-xs font-bold leading-relaxed text-[var(--muted)]">
          {disclaimer || TIP_SAFETY_FOOTER}
        </p>
      </BottomSheet>

      <BottomSheet open={plateOpen} title="원판" onClose={() => setPlateOpen(false)}>
        {plates ? (
          <div>
            <div className="max-w-full break-words text-[clamp(2.25rem,12vw,3rem)] font-black tabular-nums">
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
                  <li key={p.weight} className="flex min-w-0 justify-between gap-3 text-3xl font-black tabular-nums">
                    <span>
                      {p.weight}
                      {unit}
                    </span>
                    <span>× {p.count}</span>
                  </li>
                ))
              )}
            </ul>
            <p className="mt-3 break-words text-sm text-[var(--muted)]">한쪽 {formatPerSide(plates.perSide, unit)}</p>
          </div>
        ) : (
          <p>1RM을 저장하면 원판이 계산됩니다.</p>
        )}
      </BottomSheet>
    </div>
  );
}
