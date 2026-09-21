"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { EQUIPMENT_COPY, type EquipmentPrefs } from "@/lib/equipment-types";

function metersToCm(m: number | null): string {
  return m != null && m > 0 ? String(Number((m * 100).toFixed(1))) : "";
}

function cmToMeters(cm: string): number | null {
  if (!cm.trim()) return null;
  const n = Number(cm);
  return Number.isFinite(n) && n > 0 ? n / 100 : null;
}

export function EquipmentForm({ initial }: { initial: EquipmentPrefs }) {
  const router = useRouter();
  const [boxHeightCm, setBoxHeightCm] = useState(initial.boxHeightCm != null ? String(initial.boxHeightCm) : "");
  const [wallBallKg, setWallBallKg] = useState(initial.wallBallKg != null ? String(initial.wallBallKg) : "");
  const [wallBallTargetCm, setWallBallTargetCm] = useState(metersToCm(initial.wallBallTargetM));
  const [duRope, setDuRope] = useState(initial.duRope);
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const res = await fetch("/api/equipment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        boxHeightCm: boxHeightCm === "" ? null : Number(boxHeightCm),
        wallBallKg: wallBallKg === "" ? null : Number(wallBallKg),
        wallBallTargetM: cmToMeters(wallBallTargetCm),
        duRope,
      }),
    });
    setPending(false);
    setMsg(res.ok ? "저장했습니다." : "저장 실패");
    router.refresh();
  }

  return (
    <form id="equipment" onSubmit={(e) => void onSubmit(e)} className="card mt-6 space-y-3 p-4">
      <div className="text-sm font-bold text-[var(--accent)]">내 장비</div>
      <p className="text-sm leading-relaxed text-[var(--muted)]">{EQUIPMENT_COPY}</p>
      <p className="text-xs text-[var(--muted)]">비우면 WOD는 공개 Rx 기본값을 씁니다. 10ft = 305cm · 9ft = 274cm.</p>
      <label className="block">
        <span className="text-xs font-bold text-[var(--muted)]">박스 높이 (cm)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={boxHeightCm}
          onChange={(e) => setBoxHeightCm(e.target.value)}
          className="field mt-1"
          placeholder="61"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-[var(--muted)]">월볼 (kg)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={0.5}
          value={wallBallKg}
          onChange={(e) => setWallBallKg(e.target.value)}
          className="field mt-1"
          placeholder="9"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-[var(--muted)]">월볼 타깃 (cm)</span>
        <input
          type="number"
          inputMode="decimal"
          min={0}
          step={1}
          value={wallBallTargetCm}
          onChange={(e) => setWallBallTargetCm(e.target.value)}
          className="field mt-1"
          placeholder="305"
        />
      </label>
      <label className="block">
        <span className="text-xs font-bold text-[var(--muted)]">줄넘기 메모 (선택)</span>
        <input
          type="text"
          value={duRope}
          onChange={(e) => setDuRope(e.target.value)}
          className="field mt-1"
          placeholder="스피드 로프 · 길이"
        />
      </label>
      {msg ? (
        <p className={`text-sm font-bold ${msg.includes("실패") ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>{msg}</p>
      ) : null}
      <button type="submit" className="btn-primary tap w-full" disabled={pending}>
        {pending ? "저장 중…" : "내 장비 저장"}
      </button>
    </form>
  );
}
