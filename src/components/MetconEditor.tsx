"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatSharedMovement } from "@/lib/month-plan/shared-line";
import {
  APPLY_KO,
  addRow,
  askDelete,
  backspaceRep,
  choiceMatchesQuery,
  closeOpen,
  confirmDelete,
  draftFrom,
  draftMovements,
  editableRep,
  moveRow,
  openKeypad,
  openPick,
  pickMovement,
  rowAmount,
  typeDigit,
  type DraftState,
} from "@/lib/month-plan/metcon-draft";
import type { MovementChoice } from "@/lib/month-plan/types";

type Move = MovementChoice;

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "지움", "0", "확인"] as const;

export function MetconEditor({
  planId,
  weekStart,
  day,
  choices,
  selected,
}: {
  planId?: number;
  weekStart?: string;
  day: string;
  choices: Move[];
  selected: Move[];
}) {
  const router = useRouter();
  const selectedKey = selected.map((movement) => `${movement.key}:${movement.amount}`).join("|");
  const [state, setState] = useState<DraftState>(() => draftFrom(selected));
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setState(draftFrom(selected));
    setQuery("");
    setError("");
  }, [selectedKey, selected]);

  function cancel() {
    setState(draftFrom(selected));
    setQuery("");
    setError("");
  }

  async function apply() {
    const movements = draftMovements(state.rows);
    if ("error" in movements) {
      setError(movements.error);
      return;
    }
    setPending(true);
    setError("");
    const res = await fetch("/api/admin/metcon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(weekStart ? { weekStart } : { planId }),
        day,
        movements,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(body.error || "컨디셔닝을 바꾸지 못했어요.");
      return;
    }
    setState((current) => closeOpen({ ...current, confirmDelete: null }));
    router.refresh();
  }

  const visibleChoices = choices.filter((choice) => choiceMatchesQuery(choice, query));

  return (
    <section className="card mt-6 p-4" data-testid="metcon-editor">
      <h2 className="text-lg font-black">컨디셔닝 바꾸기</h2>
      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
        동작과 횟수를 고친 뒤 모두에게 적용을 누르면 이 날이 바뀝니다. 그 전에는 혼자 보는 초안입니다. 웜업과 리프트는 그대로 둡니다.
      </p>
      <ul className="mt-3 space-y-3">
        {state.rows.map((row, index) => {
          const amount = rowAmount(row);
          const shared = row.key && amount ? formatSharedMovement({ key: row.key, nameKo: row.nameKo, amount }) : "";
          const sexLine = shared.includes("남 ") && shared.includes("· 여 ") ? shared : "";
          const showRep = !row.key || Boolean(editableRep(row.template, row.key));
          const confirming = state.confirmDelete === index;
          return (
            <li key={`${index}-${row.key}`} className="rounded-xl bg-[var(--bg-elev)] p-3" data-testid="movement-row">
              {confirming ? (
                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    className="btn-primary tap font-black"
                    data-editor="confirm-delete"
                    onClick={() => setState((current) => confirmDelete(current))}
                  >
                    모두에게 빠집니다
                  </button>
                  <button type="button" className="btn-ghost tap font-bold" onClick={() => setState((current) => ({ ...current, confirmDelete: null }))}>
                    취소
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-stretch gap-2">
                  <button
                    type="button"
                    className="tap min-w-0 flex-1 rounded-xl bg-[var(--bg-card)] px-3 text-left text-base font-black"
                    data-editor="name"
                    onClick={() => {
                      setQuery("");
                      setState((current) => openPick(current, index));
                    }}
                  >
                    {row.nameKo || "동작 고르기"}
                  </button>
                  {showRep ? (
                    <button
                      type="button"
                      className="tap w-20 rounded-xl bg-[var(--bg-card)] text-2xl font-black tabular-nums"
                      data-editor="rep"
                      onClick={() => setState((current) => openKeypad(current, index))}
                    >
                      {row.reps || "횟수"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-ghost tap px-3 font-bold"
                    data-editor="up"
                    disabled={index === 0}
                    onClick={() => setState((current) => moveRow(current, index, -1))}
                  >
                    위로
                  </button>
                  <button
                    type="button"
                    className="btn-ghost tap px-3 font-bold"
                    data-editor="down"
                    disabled={index === state.rows.length - 1}
                    onClick={() => setState((current) => moveRow(current, index, 1))}
                  >
                    아래로
                  </button>
                  <button
                    type="button"
                    className="btn-ghost tap px-3 font-bold"
                    data-editor="delete"
                    onClick={() => setState((current) => askDelete(current, index))}
                  >
                    빼기
                  </button>
                </div>
              )}
              {sexLine ? <p className="mt-2 text-sm font-bold">{sexLine}</p> : null}
              {state.open?.index === index && state.open.mode === "pick" ? (
                <div className="mt-3">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="동작 이름"
                    className="field"
                    data-editor="pick-query"
                  />
                  {visibleChoices.length === 0 ? (
                    <p className="mt-2 text-sm font-bold">이미 있는 동작만 고를 수 있어요.</p>
                  ) : (
                    <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto" data-editor="pick-list">
                      {visibleChoices.map((choice) => (
                        <li key={choice.key}>
                          <button
                            type="button"
                            className="tap w-full rounded-xl bg-[var(--bg-card)] px-3 text-left text-base font-bold"
                            data-editor="pick"
                            onClick={() => {
                              setState((current) => pickMovement(current, choice));
                              setQuery("");
                            }}
                          >
                            {choice.nameKo}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}
              {state.open?.index === index && state.open.mode === "keypad" ? (
                <div className="mt-3" data-editor="keypad">
                  <p className="text-center text-4xl font-black tabular-nums">{row.reps || "—"}</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {DIGITS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="btn-ghost tap text-2xl font-black"
                        onClick={() => {
                          if (key === "확인") setState((current) => closeOpen(current));
                          else if (key === "지움") setState((current) => backspaceRep(current));
                          else setState((current) => typeDigit(current, key));
                        }}
                      >
                        {key}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <button type="button" className="btn-ghost tap mt-3 w-full font-bold" data-editor="add" onClick={() => setState((current) => addRow(current))}>
        동작 추가
      </button>
      {error ? <p className="mt-3 text-sm font-bold text-[var(--accent)]">{error}</p> : null}
      <button type="button" className="btn-primary tap mt-4 w-full font-black" data-editor="apply" disabled={pending} onClick={() => void apply()}>
        {pending ? "적용하는 중…" : APPLY_KO}
      </button>
      <button type="button" className="btn-ghost tap mt-2 w-full font-bold" data-editor="cancel" onClick={cancel}>
        취소
      </button>
    </section>
  );
}
