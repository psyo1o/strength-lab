"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ENGINE_DRY_ACTIONS,
  ENGINE_LIVE_ACTIONS,
  ENGINE_WRITE_ACTIONS,
  enginePanelText,
  engineRequestBody,
} from "@/lib/programming/admin-actions";
import { ENGINE_CASE_HELP, ENGINE_INTENSITY_HELP, engineHelp } from "@/lib/programming/admin-help";
import { EngineHelpBlock } from "@/components/EngineHelpBlock";
import { classWeekToTrain } from "@/lib/month-plan/calendar";

function addDays(start: string, days: number): string {
  return new Date(Date.parse(`${start}T00:00:00.000Z`) + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function classMondays(count = 4): string[] {
  const first = classWeekToTrain(Date.now());
  return Array.from({ length: count }, (_, index) => addDays(first, index * 7));
}

export function EngineAdminConsole({ classIntensity }: { classIntensity: number }) {
  const router = useRouter();
  const [actualCase, setActualCase] = useState<"" | "a" | "b">("");
  const [level, setLevel] = useState(String(classIntensity));
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [weeks, setWeeks] = useState<string[]>([]);
  const [chosenWeek, setChosenWeek] = useState("");

  useEffect(() => {
    const mondays = classMondays();
    setWeeks(mondays);
    setChosenWeek(mondays[0] ?? "");
  }, []);

  useEffect(() => {
    setLevel(String(classIntensity));
  }, [classIntensity]);

  async function run(action: string, weekStart?: string) {
    setPending(action + (weekStart ?? ""));
    setError("");
    const res = await fetch("/api/admin/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weekStart ? engineRequestBody(action, actualCase, weekStart) : engineRequestBody(action, actualCase)),
    });
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setPending("");
    const panel = enginePanelText(res.ok, body);
    setError(panel.error);
    setResult(panel.result);
    if (res.ok && panel.error.length === 0) router.refresh();
  }

  async function saveIntensity() {
    setPending("save-class-intensity");
    setError("");
    const res = await fetch("/api/admin/engine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save-class-intensity", level: Number(level) }),
    });
    const body = (await res.json().catch(() => null)) as { error?: string; class_intensity_level?: number } | null;
    setPending("");
    const panel = enginePanelText(res.ok, body);
    setError(panel.error);
    setResult(panel.result || (body?.class_intensity_level ? `클래스 강도 ${body.class_intensity_level}의 저장된 처방을 보여 줍니다. 다시 만들지 않습니다.` : ""));
    if (res.ok && panel.error.length === 0) router.refresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div>
        <p className="text-xs font-bold text-[var(--muted)]">클래스 강도</p>
        <p className="mt-1 text-sm leading-relaxed">4로 고정. Rx는 RPE 8 안팎, 완주하되 마지막 구간이 힘든 정도.</p>
        <label className="hidden">
          <span className="text-xs font-bold text-[var(--muted)]">클래스 강도</span>
          <select className="field mt-1" value={level} disabled onChange={(event) => setLevel(event.target.value)}>
            {[1, 2, 3, 4, 5].map((choice) => (
              <option key={choice} value={String(choice)}>
                {choice}
                {choice === 4 ? " (고정)" : ""}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn-primary tap mt-2 hidden w-full" disabled onClick={() => void saveIntensity()}>
          클래스 강도 저장
        </button>
        <EngineHelpBlock help={ENGINE_INTENSITY_HELP} />
      </div>
      {ENGINE_LIVE_ACTIONS.map(([action, label]) => (
        <div key={action}>
          <button type="button" className="btn-primary tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
            {pending === action ? "실행 중…" : label}
          </button>
          {action === "regenerate-week" ? (
            <div className="mt-2">
              <label className="block">
                <span className="text-xs font-bold text-[var(--muted)]">다시 만들 주</span>
                <select className="field mt-1" value={chosenWeek} onChange={(event) => setChosenWeek(event.target.value)}>
                  {weeks.map((week) => (
                    <option key={week} value={week}>
                      {week}
                      {week === weeks[0] ? " (이번 수업 주)" : week === weeks[1] ? " (다음 주)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-ghost tap mt-2 w-full"
                disabled={pending !== "" || chosenWeek.length === 0}
                onClick={() => void run("regenerate-week", chosenWeek)}
              >
                {pending === `regenerate-week${chosenWeek}` ? "실행 중…" : "선택한 주 다시 만들기"}
              </button>
            </div>
          ) : null}
          <EngineHelpBlock help={engineHelp(action)} />
        </div>
      ))}
      <div>
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
        <EngineHelpBlock help={ENGINE_CASE_HELP} />
      </div>
      {ENGINE_DRY_ACTIONS.map(([action, label]) => (
        <div key={action}>
          <button type="button" className="btn-ghost tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
            {pending === action ? "실행 중…" : label}
          </button>
          <EngineHelpBlock help={engineHelp(action)} />
        </div>
      ))}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        달 드라이런, 주 드라이런, 유사도 시험은 저장하지 않습니다. 모델 키는 화면에 나오지 않습니다. Case A와 Case B를 각각 주 드라이런으로 돌리면 실제 모델 입력과 출력을 비교할 수 있습니다.
      </p>
      <p className="text-sm font-bold">저장하는 시험</p>
      {ENGINE_WRITE_ACTIONS.map(([action, label]) => (
        <div key={action}>
          <button type="button" className="btn-primary tap w-full" disabled={pending !== ""} onClick={() => void run(action)}>
            {pending === action ? "실행 중…" : label}
          </button>
          <EngineHelpBlock help={engineHelp(action)} />
        </div>
      ))}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        모델 주 저장은 2099-08-03 시험 주만 기록합니다. 이번 수업 주는 바꾸지 않습니다. 운영 주 저장은 mode=production을 명시했을 때만 됩니다. 실패 후 폴백 저장은 이번 수업 주를 기록합니다. 수행 집계 시험과 한 달 평가 시험은 2099년 시험 행만 만들고, 끝나면 그 행과 시험 회원 점수를 지웁니다.
      </p>
      {error ? <p className="field-error">{error}</p> : null}
      {result ? (
        <pre className="card overflow-x-auto p-3 text-xs leading-relaxed whitespace-pre-wrap">{result}</pre>
      ) : null}
    </div>
  );
}
