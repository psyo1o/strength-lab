"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PieceFormat } from "@/lib/month-plan/types";

export function PlanScoreForm({
  planId,
  day,
  format,
}: {
  planId: number;
  day: string;
  format: PieceFormat;
}) {
  const router = useRouter();
  const timed = format === "for_time" || format === "intervals";
  const [clock, setClock] = useState("");
  const [rounds, setRounds] = useState(0);
  const [extraReps, setExtraReps] = useState(0);
  const [notesKo, setNotesKo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setPending(true);
    setError("");
    const res = await fetch("/api/month-plan/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planId, day, clock, rounds, extraReps, notesKo }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(body.error || "기록을 저장하지 못했습니다.");
      return;
    }
    setClock("");
    setRounds(0);
    setExtraReps(0);
    setNotesKo("");
    router.refresh();
  }

  return (
    <section className="card mt-4 p-4">
      <h2 className="text-sm font-bold text-[var(--accent)]">기록 추가</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">이전 기록은 그대로 둡니다.</p>
      {timed ? (
        <label className="mt-3 block">
          <span className="text-xs font-bold text-[var(--muted)]">시간 (분:초)</span>
          <input value={clock} onChange={(e) => setClock(e.target.value)} placeholder="12:40" className="field mt-1" inputMode="numeric" />
        </label>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label>
            <span className="text-xs font-bold text-[var(--muted)]">라운드</span>
            <input
              type="number"
              min={0}
              value={rounds}
              onChange={(e) => setRounds(Math.max(0, Number(e.target.value) || 0))}
              className="field mt-1"
            />
          </label>
          <label>
            <span className="text-xs font-bold text-[var(--muted)]">추가 횟수</span>
            <input
              type="number"
              min={0}
              value={extraReps}
              onChange={(e) => setExtraReps(Math.max(0, Number(e.target.value) || 0))}
              className="field mt-1"
            />
          </label>
        </div>
      )}
      <label className="mt-3 block">
        <span className="text-xs font-bold text-[var(--muted)]">메모</span>
        <textarea value={notesKo} onChange={(e) => setNotesKo(e.target.value)} rows={2} className="field mt-1 min-h-16 py-3 text-sm" />
      </label>
      {error ? <p className="field-error">{error}</p> : null}
      <button type="button" className="btn-primary tap mt-3 w-full" disabled={pending} onClick={() => void save()}>
        {pending ? "저장 중…" : "이 점수 저장"}
      </button>
    </section>
  );
}
