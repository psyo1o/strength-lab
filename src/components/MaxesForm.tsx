"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Field = { key: string; nameKo: string; value: number | string };

export function MaxesForm({
  unit,
  groups,
}: {
  unit: "kg" | "lb";
  groups: { title: string; fields: Field[] }[];
}) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const entries = [...fd.entries()].map(([exerciseKey, v]) => ({
      exerciseKey,
      value: Number(v),
    }));
    setPending(true);
    const res = await fetch("/api/maxes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unit, entries }),
    });
    setPending(false);
    setMsg(res.ok ? "저장했습니다." : "저장 실패");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-6 pb-8">
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-2 font-bold">{g.title}</h2>
          <div className="space-y-2">
            {g.fields.map((f) => (
              <label key={f.key} className="card flex items-center justify-between gap-3 px-3 py-2">
                <span className="font-bold">{f.nameKo}</span>
                <span className="flex items-center gap-2">
                  <input
                    name={f.key}
                    type="number"
                    min={0}
                    step={unit === "lb" ? 5 : 2.5}
                    defaultValue={f.value === "" ? "" : f.value}
                    className="tap w-28 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 text-right text-lg font-black"
                  />
                  <span className="text-sm text-[var(--muted)]">{unit}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}
      {msg ? <p className="text-sm text-[var(--ok)]">{msg}</p> : null}
      <button className="btn-primary tap w-full" disabled={pending}>
        {pending ? "저장 중…" : "1RM 저장"}
      </button>
    </form>
  );
}
