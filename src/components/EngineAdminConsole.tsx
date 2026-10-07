"use client";

import { useState } from "react";
import { ENGINE_DRY_ACTIONS, ENGINE_WRITE_ACTIONS } from "@/lib/programming/admin-actions";

const ACTIONS = [
  ["generate-month", "이번 달 계획 만들기"],
  ["generate-next-week", "다음 주 만들기"],
  ["regenerate-week", "이 주 다시 만들기"],
  ["validate", "검증 실행"],
  ["fallback-test", "폴백 시험"],
  ["evaluate-month", "이번 달 평가"],
  ["generate-next-month", "다음 달 만들기"],
] as const;

export function EngineAdminConsole() {
  const [actualCase, setActualCase] = useState<"" | "a" | "b">("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  async function run(action: string) {
    setPending(action);
    setError("");
    const res = await fetch("/api/admin/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        actualCase: action === "dry-run-week" ? actualCase || null : null,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setPending("");
    if (!res.ok) {
      setError(body.error || "실행하지 못했습니다.");
      setResult("");
      return;
    }
    setResult(JSON.stringify(body, null, 2));
  }

  return (
    <div className="mt-4 space-y-3">
      {ACTIONS.map(([action, label]) => (
        <button key={action} type="button" className="btn-primary tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
          {pending === action ? "실행 중…" : label}
        </button>
      ))}
      <label className="block">
        <span className="text-xs font-bold text-[var(--muted)]">주 드라이런에 넣을 지난주 수행</span>
        <select
          className="field mt-1"
          value={actualCase}
          onChange={(event) => setActualCase(event.target.value as "" | "a" | "b")}
        >
          <option value="">저장된 실제 수행</option>
          <option value="a">Case A: 하체 볼륨·피로 높음</option>
          <option value="b">Case B: 하체 볼륨·피로 낮음</option>
        </select>
      </label>
      {ENGINE_DRY_ACTIONS.map(([action, label]) => (
        <button key={action} type="button" className="btn-ghost tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
          {pending === action ? "실행 중…" : label}
        </button>
      ))}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        달 드라이런, 주 드라이런, 유사도 시험은 저장하지 않습니다. 모델 키는 화면에 나오지 않습니다. Case A와 Case B를 각각 주 드라이런으로 돌리면 실제 모델 입력과 출력을 비교할 수 있습니다.
      </p>
      <p className="text-sm font-bold">저장하는 시험</p>
      {ENGINE_WRITE_ACTIONS.map(([action, label]) => (
        <button key={action} type="button" className="btn-primary tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
          {pending === action ? "실행 중…" : label}
        </button>
      ))}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        모델 주 저장과 실패 후 폴백 저장은 이번 수업 주를 기록합니다. 수행 집계 시험과 한 달 평가 시험은 2099년 시험 행만 만들고, 끝나면 그 행과 시험 회원 점수를 지웁니다.
      </p>
      {error ? <p className="field-error">{error}</p> : null}
      {result ? (
        <pre className="card overflow-x-auto p-3 text-xs leading-relaxed whitespace-pre-wrap">{result}</pre>
      ) : null}
    </div>
  );
}
