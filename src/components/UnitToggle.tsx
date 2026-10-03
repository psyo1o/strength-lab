"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnitToggle({ unit }: { unit: "kg" | "lb" }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [override, setOverride] = useState<"kg" | "lb" | null>(null);
  if (override != null && unit === override) setOverride(null);
  const shown = override ?? unit;

  async function setUnit(next: "kg" | "lb") {
    if (next === shown || pending) return;
    setOverride(next);
    setPending(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unit: next }),
      });
      if (!res.ok) {
        setOverride(null);
        return;
      }
      router.refresh();
    } catch {
      setOverride(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="group"
      aria-label="단위"
      className="inline-flex h-14 w-[calc(7rem+2px)] shrink-0 overflow-hidden rounded-full border border-[var(--line)]"
    >
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          aria-pressed={shown === u}
          disabled={pending}
          onClick={() => void setUnit(u)}
          className={`tap inline-flex h-14 w-14 min-h-14 min-w-14 shrink-0 items-center justify-center px-0 text-sm font-extrabold ${
            shown === u ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
          }`}
        >
          {u}
        </button>
      ))}
    </div>
  );
}
