"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function SetRow({
  setId,
  setNumber,
  display,
  reps,
  amrap,
  percent,
  percentBase,
  plates,
  noteKo,
  done,
  onStartRest,
}: {
  setId: number;
  setNumber: number;
  display: string | null;
  reps: number;
  amrap: boolean;
  percent: number | null;
  percentBase: string;
  plates: string | null;
  noteKo: string;
  done: boolean;
  onStartRest: (sec: number) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [localDone, setLocalDone] = useState(done);

  function toggle() {
    const next = !localDone;
    setLocalDone(next);
    start(async () => {
      await fetch("/api/sets/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setId, completed: next }),
      });
      if (next) onStartRest(90);
      router.refresh();
    });
  }

  const baseLabel = percentBase === "tm" ? "TM" : percentBase === "ten_rm" ? "10RM" : "1RM";

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`card tap flex w-full items-center gap-3 p-3 text-left ${
        localDone ? "opacity-60" : ""
      }`}
    >
      <span
        className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-lg font-black ${
          localDone ? "bg-[var(--ok)] text-[#04210f]" : "bg-[var(--bg-elev)] text-[var(--accent)]"
        }`}
      >
        {localDone ? "✓" : setNumber}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-black tracking-tight">
          {display ?? "—"}
          <span className="ml-2 text-lg font-bold text-[var(--muted)]">
            × {reps}
            {amrap ? "+" : ""}
          </span>
        </span>
        <span className="block text-xs text-[var(--muted)]">
          {percent != null ? `${percent}% ${baseLabel}` : "작업중량"}
          {plates ? ` · 한쪽 ${plates}` : ""}
          {noteKo ? ` · ${noteKo}` : ""}
        </span>
      </span>
    </button>
  );
}
