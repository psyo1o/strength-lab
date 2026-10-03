"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AthleteSex } from "@/lib/auth";
import { DAY_LABEL, DAY_ORDER, DEFAULT_TRAINING_DAYS, type DayKey, type WeekIndex } from "@/lib/month-plan/types";

const WEEKS: { week: WeekIndex; label: string }[] = [
  { week: 1, label: "1주 · 5회" },
  { week: 2, label: "2주 · 3회" },
  { week: 3, label: "3주 · 5/3/1" },
  { week: 4, label: "4주 · 딜로드" },
];

export function MonthPlanForm({ sex }: { sex: AthleteSex }) {
  const router = useRouter();
  const [week, setWeek] = useState<WeekIndex>(1);
  const [athleteSex, setAthleteSex] = useState<AthleteSex>(sex);
  const [days, setDays] = useState<DayKey[]>(DEFAULT_TRAINING_DAYS);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  function toggleDay(day: DayKey) {
    setDays((current) => (current.includes(day) ? current.filter((item) => item !== day) : [...current, day]));
  }

  async function createPlan() {
    setPending(true);
    setError("");
    const res = await fetch("/api/month-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekIndex: week, sex: athleteSex, trainingDays: days }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; planId?: number };
    setPending(false);
    if (!res.ok || !body.planId) {
      setError(body.error || "주를 만들지 못했습니다.");
      return;
    }
    router.push(`/plan/${body.planId}`);
    router.refresh();
  }

  return (
    <section className="card mt-5 p-4">
      <h2 className="text-sm font-bold text-[var(--accent)]">주 만들기</h2>
      <p className="mt-1 text-sm text-[var(--muted)]">만들면 바로 그 주의 WOD입니다. 확인 단계는 없습니다.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {WEEKS.map((item) => (
          <button
            key={item.week}
            type="button"
            onClick={() => setWeek(item.week)}
            className={`tap rounded-xl px-2 text-sm font-black ${
              week === item.week ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)]"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        <div className="text-xs font-bold text-[var(--muted)]">성별 · 월볼, 케틀벨, 박스 높이만</div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(
            [
              ["m", "남"],
              ["f", "여"],
              [null, "적지 않음"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setAthleteSex(value)}
              className={`tap rounded-xl text-sm font-black ${
                athleteSex === value ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-4">
        <div className="text-xs font-bold text-[var(--muted)]">운동 요일 · 토요일은 선택</div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {DAY_ORDER.map((day) => (
            <button
              key={day}
              type="button"
              disabled={day === "sun"}
              onClick={() => toggleDay(day)}
              className={`tap rounded-xl text-sm font-black ${
                day === "sun" ? "text-[var(--muted)]" : days.includes(day) ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)]"
              }`}
            >
              {DAY_LABEL[day].slice(0, 1)}
            </button>
          ))}
        </div>
      </div>
      {error ? <p className="field-error">{error}</p> : null}
      <button type="button" className="btn-primary tap mt-4 w-full" disabled={pending} onClick={() => void createPlan()}>
        {pending ? "만드는 중…" : "이번 주 WOD 만들기"}
      </button>
    </section>
  );
}
