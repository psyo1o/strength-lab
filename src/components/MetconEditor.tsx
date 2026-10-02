"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Move = { key: string; amount: string; nameKo: string };

function idOf(movement: Move): string {
  return `${movement.key}:${movement.amount}`;
}

export function MetconEditor({
  planId,
  day,
  choices,
  selected,
}: {
  planId: number;
  day: string;
  choices: Move[];
  selected: Move[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(() => selected.map(idOf));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function toggle(movement: Move) {
    const id = idOf(movement);
    setPicked((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  }

  async function save() {
    const movements = choices.filter((movement) => picked.includes(idOf(movement)));
    if (movements.length === 0) {
      setError("동작을 하나 이상 골라 주세요.");
      return;
    }
    setPending(true);
    setError("");
    const res = await fetch("/api/admin/metcon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        planId,
        day,
        movements: movements.map((movement) => ({ key: movement.key, amount: movement.amount })),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(body.error || "컨디셔닝을 바꾸지 못했어요.");
      return;
    }
    router.refresh();
  }

  return (
    <section className="card mt-6 p-4">
      <h2 className="text-lg font-black">컨디셔닝 바꾸기</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        이 날의 컨디셔닝이 맞지 않으면, 앱에 있는 동작만 골라 바꾸실 수 있어요. 웜업과 리프트는 그대로 둡니다.
      </p>
      <ul className="mt-3 space-y-2">
        {choices.map((movement) => {
          const id = idOf(movement);
          return (
            <li key={id}>
              <label className="flex min-w-0 items-start gap-3 text-sm font-bold">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.includes(id)}
                  onChange={() => toggle(movement)}
                />
                <span className="break-words">
                  {movement.nameKo}
                  <span className="font-normal text-[var(--muted)]"> · {movement.amount}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? <p className="mt-3 text-sm font-bold text-[var(--accent)]">{error}</p> : null}
      <button type="button" className="btn tap mt-4 w-full font-bold" disabled={pending} onClick={save}>
        이 동작으로 바꾸기
      </button>
    </section>
  );
}
