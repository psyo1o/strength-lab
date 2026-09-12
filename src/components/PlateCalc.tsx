"use client";

import { useMemo, useState } from "react";
import { calculatePlates, defaultBar, formatPerSide } from "@/lib/calc/plates";

export function PlateCalc({ unit }: { unit: "kg" | "lb" }) {
  const [target, setTarget] = useState(unit === "kg" ? 100 : 225);
  const [bar, setBar] = useState(defaultBar(unit));

  const result = useMemo(() => calculatePlates(target, unit, bar), [target, unit, bar]);

  return (
    <div className="mt-6 space-y-4">
      <label className="block">
        <span className="text-sm text-[var(--muted)]">목표 중량 ({unit})</span>
        <input
          type="number"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="tap mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-4 text-2xl font-black"
        />
      </label>
      <label className="block">
        <span className="text-sm text-[var(--muted)]">바 무게 ({unit})</span>
        <input
          type="number"
          value={bar}
          onChange={(e) => setBar(Number(e.target.value))}
          className="tap mt-1 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-elev)] px-4 text-xl font-bold"
        />
      </label>
      <div className="card p-4">
        <div className="text-sm text-[var(--muted)]">로드 가능</div>
        <div className="text-4xl font-black">
          {result.loadable}
          {unit}
        </div>
        <div className="mt-3 text-sm">
          한쪽: <span className="font-bold">{formatPerSide(result.perSide, unit)}</span>
        </div>
        <ul className="mt-3 space-y-1 text-sm">
          {result.perSide.map((p) => (
            <li key={p.weight} className="flex justify-between">
              <span>
                {p.weight}
                {unit}
              </span>
              <span className="font-black">× {p.count}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
