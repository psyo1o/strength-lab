"use client";

import { useMemo, useState } from "react";
import { epley1rm, percentChart } from "@/lib/calc/epley";
import { incrementFor, roundTo } from "@/lib/calc/round";

export function EpleyHelper({ unit }: { unit: "kg" | "lb" }) {
  const [weight, setWeight] = useState(unit === "kg" ? 100 : 225);
  const [reps, setReps] = useState(5);
  const inc = incrementFor(unit);
  const estimated = useMemo(() => roundTo(epley1rm(weight, reps), inc), [weight, reps, inc]);
  const rows = useMemo(
    () => percentChart(estimated).map((r) => ({ ...r, weight: roundTo(r.weight, inc) })),
    [estimated, inc],
  );

  return (
    <div className="mt-6 min-w-0 space-y-4 pb-8">
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="text-sm text-[var(--muted)]">무게 ({unit})</span>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
            className="tap mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-3 text-xl font-black"
          />
        </label>
        <label>
          <span className="text-sm text-[var(--muted)]">반복</span>
          <input
            type="number"
            min={1}
            max={20}
            value={reps}
            onChange={(e) => setReps(Number(e.target.value))}
            className="tap mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-3 text-xl font-black"
          />
        </label>
      </div>
      <div className="card p-4">
        <div className="text-sm text-[var(--muted)]">추정 1RM</div>
        <div className="text-4xl font-black">
          {estimated}
          {unit}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[var(--muted)]">
            <th className="py-2">%</th>
            <th>중량</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.percent} className="border-t border-[var(--line)]">
              <td className="py-2 font-bold">{r.percent}%</td>
              <td className="font-black">
                {r.weight}
                {unit}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
