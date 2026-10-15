"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { WeekCell } from "@/lib/wod-edit";

const DAY_KO: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

const SOURCE_KO: Record<WeekCell["source"], string> = {
  model: "model",
  head_coach: "head_coach",
  admin_edit: "admin_edit",
};

type Edition = { version: number; kind: string; editorId: number | null; editedAt: number; reason: string };

type DraftCell = {
  id: string;
  movement_id: string;
  quantity_option: string;
  note_ko: string;
};

function draftsFrom(cells: WeekCell[]): DraftCell[] {
  return cells.map((cell) => ({
    id: cell.id,
    movement_id: cell.movement_id,
    quantity_option: cell.quantity_option,
    note_ko: cell.note_ko,
  }));
}

export function WodWeekEditor({
  weekStart,
  version,
  catalogVersion,
  cells,
  editions,
}: {
  weekStart: string;
  version: number;
  catalogVersion: string;
  cells: WeekCell[];
  editions: Edition[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftCell[]>(() => draftsFrom(cells));
  const [reason, setReason] = useState("");
  useEffect(() => {
    setDraft(draftsFrom(cells));
  }, [version, weekStart, cells]);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  function update(id: string, patch: Partial<DraftCell>) {
    setDraft((current) => current.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell)));
  }

  async function send(body: Record<string, unknown>) {
    setPending(true);
    setError("");
    setWarnings([]);
    const res = await fetch("/api/admin/wod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; warnings?: string[] };
    setPending(false);
    if (Array.isArray(data.warnings)) setWarnings(data.warnings);
    if (!res.ok) {
      setError(data.error || "저장하지 못했어요.");
      return;
    }
    setReason("");
    router.refresh();
  }

  return (
    <section className="mt-6 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        {weekStart} · version {version} · catalog {catalogVersion}
      </p>
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        movement_id와 quantity_option만 고릅니다. 단위와 Rx는 카탈로그가 채웁니다. 자유 입력은 note_ko뿐입니다.
      </p>
      <ul className="space-y-3">
        {cells.map((cell, index) => {
          const row = draft[index];
          if (!row) return null;
          const options = cell.allowed;
          const quantities = options.find((option) => option.movement_id === row.movement_id)?.quantity_option ?? [];
          const quantityKnown = quantities.some((option) => option.id === row.quantity_option);
          return (
            <li key={cell.id} className="card space-y-3 p-4">
              <div className="text-sm font-bold">
                {DAY_KO[cell.day] ?? cell.day} · {cell.block} · {SOURCE_KO[cell.source]}
              </div>
              <label className="block">
                <span className="mb-1 block text-sm font-bold">movement_id</span>
                <select
                  className="field"
                  value={row.movement_id}
                  onChange={(event) => {
                    const movementId = event.target.value;
                    const nextQty = options.find((option) => option.movement_id === movementId)?.quantity_option[0]?.id;
                    update(cell.id, { movement_id: movementId, quantity_option: nextQty ?? row.quantity_option });
                  }}
                >
                  {options.map((option) => (
                    <option key={option.movement_id} value={option.movement_id}>
                      {option.name_ko}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-sm font-bold">quantity_option</span>
                <select
                  className="field"
                  value={row.quantity_option}
                  onChange={(event) => update(cell.id, { quantity_option: event.target.value })}
                >
                  {quantityKnown ? null : <option value={row.quantity_option}>현재</option>}
                  {quantities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-sm text-[var(--muted)]">
                단위 {cell.unit ?? "-"} · Rx {cell.load?.male ?? "-"} / {cell.load?.female ?? "-"}
              </p>
              <label className="block">
                <span className="mb-1 block text-sm font-bold">note_ko</span>
                <input className="field" value={row.note_ko} maxLength={80} onChange={(event) => update(cell.id, { note_ko: event.target.value })} />
              </label>
            </li>
          );
        })}
      </ul>
      <label className="block">
        <span className="mb-1 block text-sm font-bold">사유</span>
        <input className="field" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} />
      </label>
      {error ? <p className="text-sm font-bold text-[var(--accent)]">{error}</p> : null}
      {warnings.length ? (
        <ul className="text-sm text-[var(--muted)]">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="btn-ghost tap font-bold"
        disabled={pending}
        onClick={() =>
          void send({
            weekStart,
            baseVersion: version,
            reason_ko: reason,
            cells: draft,
          })
        }
      >
        이 주 저장
      </button>
      {editions.length ? (
        <div className="space-y-2">
          <h2 className="text-lg font-black">버전</h2>
          <ul className="space-y-2">
            {editions.map((edition) => (
              <li key={edition.version} className="card p-3 text-sm">
                <div>
                  version {edition.version} · {edition.kind}
                  {edition.reason ? ` · ${edition.reason}` : ""}
                </div>
                {edition.version < version ? (
                  <button
                    type="button"
                    className="btn-ghost tap mt-2 font-bold"
                    disabled={pending}
                    onClick={() =>
                      void send({
                        action: "revert",
                        weekStart,
                        baseVersion: version,
                        targetVersion: edition.version,
                        reason_ko: reason,
                      })
                    }
                  >
                    이 버전으로 되돌리기
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
