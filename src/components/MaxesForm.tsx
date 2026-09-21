"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Field = {
  key: string;
  nameKo: string;
  value: number | string;
  startValue?: number | string;
  showStart?: boolean;
};

function validate(value: string, unit: "kg" | "lb"): string {
  if (value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "숫자를 입력하세요.";
  if (n < 0) return "0 이상이어야 합니다.";
  if (unit === "kg" && n > 0 && n < 20) return "바(20kg)보다 작습니다.";
  if (unit === "lb" && n > 0 && n < 45) return "바(45lb)보다 작습니다.";
  if (unit === "kg" && n > 600) return "값이 너무 큽니다.";
  if (unit === "lb" && n > 1300) return "값이 너무 큽니다.";
  return "";
}

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
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const g of groups) {
      for (const f of g.fields) {
        init[f.key] = f.value === "" ? "" : String(f.value);
        if (f.showStart) init[`${f.key}__start`] = f.startValue === "" || f.startValue == null ? "" : String(f.startValue);
      }
    }
    return init;
  });

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      const err = validate(v, unit);
      if (err) e[k] = err;
    }
    return e;
  }, [values, unit]);

  const hasError = Object.keys(errors).length > 0;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (hasError) {
      setMsg("빨간 칸을 고친 뒤 저장하세요.");
      return;
    }
    const keys = new Set<string>();
    for (const g of groups) for (const f of g.fields) keys.add(f.key);
    const entries = [...keys].map((exerciseKey) => ({
      exerciseKey,
      value: Number(values[exerciseKey] || 0),
      startValue: values[`${exerciseKey}__start`] === "" || values[`${exerciseKey}__start`] == null
        ? null
        : Number(values[`${exerciseKey}__start`]),
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
    <form onSubmit={onSubmit} className="mt-6 space-y-6 pb-28">
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-2 font-bold">{g.title}</h2>
          <div className="space-y-2">
            {g.fields.map((f) => (
              <label key={f.key} className="card block px-3 py-3">
                <span className="text-lg font-bold">{f.nameKo}</span>
                <span className="mt-2 flex flex-wrap items-center justify-end gap-3">
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--muted)]">1RM</span>
                    <input
                      name={f.key}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step={unit === "lb" ? 5 : 2.5}
                      value={values[f.key] ?? ""}
                      onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
                      className="tap w-28 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 text-right text-3xl font-black"
                    />
                    <span className="text-sm text-[var(--muted)]">{unit}</span>
                  </span>
                  {f.showStart ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-bold text-[var(--muted)]">시작 중량</span>
                      <input
                        name={`${f.key}__start`}
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={unit === "lb" ? 5 : 2.5}
                        value={values[`${f.key}__start`] ?? ""}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [`${f.key}__start`]: e.target.value }))
                        }
                        className="tap w-28 rounded-lg border border-[var(--line)] bg-[var(--bg-elev)] px-3 text-right text-3xl font-black"
                      />
                      <span className="text-sm text-[var(--muted)]">{unit}</span>
                    </span>
                  ) : null}
                </span>
                {errors[f.key] ? <p className="mt-1 text-sm text-[var(--danger)]">{errors[f.key]}</p> : null}
                {errors[`${f.key}__start`] ? (
                  <p className="mt-1 text-sm text-[var(--danger)]">{errors[`${f.key}__start`]}</p>
                ) : null}
              </label>
            ))}
          </div>
        </section>
      ))}
      {msg ? (
        <p className={`text-sm ${msg.includes("실패") || msg.includes("고친") ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {msg}
        </p>
      ) : null}
      <div className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg px-4 pb-2">
        <button className="btn-primary tap w-full text-lg" disabled={pending || hasError}>
          {pending ? "저장 중…" : "1RM / 시작 중량 저장"}
        </button>
      </div>
    </form>
  );
}
