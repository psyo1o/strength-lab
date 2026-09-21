"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatWeight } from "@/lib/calc/round";
import type { Tip } from "@/lib/tip-copy";
import { TIP_SAFETY_FOOTER, tipHasVideo } from "@/lib/tip-copy";
import {
  formatClock,
  formatLabel,
  parseClock,
  scoreTypeFor,
  tierLabel,
  WOD_SUBS,
  type WodTemplate,
  type WodTier,
} from "@/lib/wod/types";
import { BottomSheet } from "./BottomSheet";
import { TipMedia } from "./TipMedia";
import { TipVideoButtons } from "./TipVideoButtons";

type HistoryRow = {
  id: number;
  completedAt: number;
  tier: WodTier;
  score: string;
};

function rxLine(m: WodTemplate["movements"][number], unit: "kg" | "lb"): string {
  const bits: string[] = [m.scheme];
  if (m.rxKg != null) {
    bits.push(m.rxKgF != null ? `${formatWeight(m.rxKg, unit)} / ${formatWeight(m.rxKgF, unit)}` : formatWeight(m.rxKg, unit));
  }
  if (m.rxNote) bits.push(m.rxNote);
  return bits.filter(Boolean).join(" · ");
}

export function WodClient({
  template,
  unit,
  prLabel,
  history,
  maxes,
  tips,
  disclaimer,
}: {
  template: WodTemplate;
  unit: "kg" | "lb";
  prLabel: string | null;
  history: HistoryRow[];
  maxes: Record<string, number>;
  tips: Record<string, Tip>;
  disclaimer: string;
}) {
  const router = useRouter();
  const [tier, setTier] = useState<WodTier>("rx");
  const scaling = template.scaling.find((s) => s.tier === tier) ?? template.scaling[0];
  const [scaleNotes, setScaleNotes] = useState(scaling?.bodyKo ?? "");
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [notesKo, setNotesKo] = useState("");
  const [rounds, setRounds] = useState(0);
  const [extraReps, setExtraReps] = useState(0);
  const [manualClock, setManualClock] = useState("");
  const [phase, setPhase] = useState<"idle" | "running" | "paused" | "done">("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [msg, setMsg] = useState("");
  const [pending, setPending] = useState(false);
  const [tipKey, setTipKey] = useState<string | null>(null);
  const [boxHeightCm, setBoxHeightCm] = useState(
    String(maxes.box_height_cm || template.boxHeightCm || ""),
  );
  const [wallBallKg, setWallBallKg] = useState(
    String(maxes.wall_ball || template.wallBallKg || ""),
  );
  const [wallBallTargetM, setWallBallTargetM] = useState(
    String(maxes.wall_ball_target_m || template.wallBallTargetM || ""),
  );

  useEffect(() => {
    setScaleNotes(template.scaling.find((s) => s.tier === tier)?.bodyKo ?? "");
  }, [tier, template.scaling]);

  useEffect(() => {
    if (phase !== "running") return;
    const t = setInterval(() => {
      if (startedAt == null) return;
      setElapsedMs(Date.now() - startedAt);
    }, 200);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  const elapsedSec = Math.floor(elapsedMs / 1000);
  const cap = template.timeCapSec;
  const capped = cap != null && elapsedSec >= cap;
  const remaining = cap != null ? Math.max(0, cap - elapsedSec) : null;
  const emomMinute = Math.min(
    template.targetRounds ?? 99,
    Math.floor(elapsedSec / 60) + (phase === "idle" ? 0 : 1),
  );
  const emomLeft = 60 - (elapsedSec % 60);
  const scoreKind = scoreTypeFor(template.format);

  const clock = useMemo(() => {
    if (template.format === "amrap" && remaining != null) return formatClock(remaining);
    if (template.format === "emom") return formatClock(phase === "idle" ? 60 : emomLeft === 60 && elapsedSec > 0 ? 0 : emomLeft);
    return formatClock(elapsedSec);
  }, [template.format, remaining, elapsedSec, emomLeft, phase]);

  useEffect(() => {
    if (phase !== "running") return;
    if (template.format === "amrap" && capped) {
      setPhase("paused");
    }
  }, [phase, capped, template.format]);

  const tip = tipKey ? tips[tipKey] : null;
  const extraPullTips =
    tipKey === "pull_up" ? [tips.kipping_pull_up, tips.butterfly_pull_up].filter(Boolean) : [];

  function start() {
    const base = phase === "paused" ? Date.now() - elapsedMs : Date.now();
    setStartedAt(base);
    setPhase("running");
    if (phase === "idle") setElapsedMs(0);
  }

  function pause() {
    setPhase("paused");
    if (startedAt != null) setElapsedMs(Date.now() - startedAt);
  }

  function reset() {
    setPhase("idle");
    setStartedAt(null);
    setElapsedMs(0);
  }

  async function complete() {
    const timeSec =
      scoreKind === "time_sec" ? parseClock(manualClock) ?? (elapsedSec > 0 ? elapsedSec : null) : null;
    if (scoreKind === "time_sec" && (timeSec == null || timeSec <= 0) && elapsedSec <= 0) {
      setMsg("시간을 재거나 수동으로 입력하세요.");
      return;
    }
    if (scoreKind === "rounds_reps" && rounds <= 0 && extraReps <= 0) {
      setMsg("라운드 또는 횟수를 남기세요.");
      return;
    }
    setPending(true);
    const substitutions = JSON.stringify(
      Object.entries(subs)
        .filter(([, to]) => to.trim())
        .map(([from, to]) => ({ from, to })),
    );
    const equipmentJson = JSON.stringify({
      boxHeightCm: boxHeightCm ? Number(boxHeightCm) : null,
      wallBallKg: wallBallKg ? Number(wallBallKg) : null,
      wallBallTargetM: wallBallTargetM ? Number(wallBallTargetM) : null,
      thrusterKg: maxes.thruster ?? null,
    });
    const res = await fetch("/api/wod/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateSlug: template.slug,
        tier,
        timeSec: timeSec ?? elapsedSec,
        rounds,
        extraReps,
        notesKo,
        scaleNotes,
        substitutions,
        equipmentJson,
      }),
    });
    setPending(false);
    if (!res.ok) {
      setMsg("저장 실패");
      return;
    }
    setPhase("done");
    setMsg("저장했습니다. 기록과 PR에 반영됩니다.");
    router.refresh();
  }

  const showBox = template.boxHeightCm != null || template.movements.some((m) => m.exerciseKey === "box_jump");
  const showWall = template.wallBallKg != null || template.movements.some((m) => m.exerciseKey === "wall_ball");

  return (
    <div className="pb-36">
      <div className="mt-4 grid grid-cols-3 gap-2">
        {(["rx", "scaled", "beginner"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`tap rounded-xl text-sm font-black ${
              tier === t ? "bg-[var(--accent)] text-[#1a1204]" : "btn-ghost"
            }`}
            onClick={() => setTier(t)}
          >
            {tierLabel(t)}
          </button>
        ))}
      </div>
      {scaling ? <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">{scaling.bodyKo}</p> : null}
      <label className="mt-3 block">
        <span className="text-xs font-bold text-[var(--muted)]">스케일 메모 (수정 가능)</span>
        <textarea
          value={scaleNotes}
          onChange={(e) => setScaleNotes(e.target.value)}
          rows={2}
          className="field mt-1 min-h-16 py-3 text-sm"
        />
      </label>

      <ul className="mt-4 space-y-2">
        {template.movements.map((m, i) => {
          const hasVideo = tipHasVideo(tips[m.exerciseKey]) || (m.exerciseKey === "pull_up" && (tipHasVideo(tips.kipping_pull_up) || tipHasVideo(tips.butterfly_pull_up)));
          return (
            <li key={`${m.exerciseKey}-${i}`} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-black">{m.nameKo}</div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{rxLine(m, unit)}</p>
                  {subs[m.exerciseKey] ? (
                    <p className="mt-1 text-sm font-bold text-[var(--accent)]">대체 · {subs[m.exerciseKey]}</p>
                  ) : null}
                </div>
                <TipVideoButtons hasVideo={hasVideo} onOpen={() => setTipKey(m.exerciseKey)} />
              </div>
              {(WOD_SUBS[m.exerciseKey] ?? []).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(WOD_SUBS[m.exerciseKey] ?? []).map((label) => {
                    const on = subs[m.exerciseKey] === label;
                    return (
                      <button
                        key={label}
                        type="button"
                        className={`tap min-h-11 rounded-full px-3 text-sm font-bold ${
                          on ? "bg-[var(--accent)] text-[#1a1204]" : "bg-[var(--bg-elev)] text-[var(--muted)]"
                        }`}
                        onClick={() =>
                          setSubs((prev) => ({
                            ...prev,
                            [m.exerciseKey]: on ? "" : label,
                          }))
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {showBox || showWall ? (
        <section className="card mt-4 space-y-3 p-4">
          <div className="text-sm font-bold text-[var(--accent)]">장비</div>
          {showBox ? (
            <label className="block">
              <span className="text-xs font-bold text-[var(--muted)]">박스 높이 (cm)</span>
              <input
                type="number"
                inputMode="decimal"
                value={boxHeightCm}
                onChange={(e) => setBoxHeightCm(e.target.value)}
                className="field mt-1"
              />
            </label>
          ) : null}
          {showWall ? (
            <>
              <label className="block">
                <span className="text-xs font-bold text-[var(--muted)]">월볼 (kg)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={wallBallKg}
                  onChange={(e) => setWallBallKg(e.target.value)}
                  className="field mt-1"
                />
              </label>
              <label className="block">
                <span className="text-xs font-bold text-[var(--muted)]">월볼 타깃 (m)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  value={wallBallTargetM}
                  onChange={(e) => setWallBallTargetM(e.target.value)}
                  className="field mt-1"
                />
              </label>
            </>
          ) : null}
        </section>
      ) : null}

      <section className="card mt-4 p-5 text-center">
        <div className="text-sm font-bold text-[var(--accent)]">
          {formatLabel(template.format)}
          {cap != null ? ` · 캡 ${formatClock(cap)}` : ""}
          {template.format === "emom" && template.targetRounds
            ? ` · ${emomMinute}/${template.targetRounds}분`
            : ""}
        </div>
        <div className="mt-2 text-7xl font-black tabular-nums leading-none">{clock}</div>
        {prLabel ? <p className="mt-3 text-sm text-[var(--muted)]">PR {prLabel}</p> : null}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <button
            type="button"
            className="btn-primary tap text-base"
            onClick={phase === "running" ? pause : start}
            disabled={phase === "done"}
          >
            {phase === "running" ? "일시정지" : phase === "paused" ? "계속" : "시작"}
          </button>
          <button type="button" className="btn-ghost tap text-base font-bold" onClick={reset} disabled={phase === "done"}>
            리셋
          </button>
          <button
            type="button"
            className="btn-ghost tap text-base font-bold"
            onClick={() => {
              if (cap != null) {
                setElapsedMs(cap * 1000);
                setPhase("paused");
              }
            }}
            disabled={!cap || phase === "done"}
          >
            캡
          </button>
        </div>
      </section>

      {scoreKind === "rounds_reps" ? (
        <section className="mt-4 grid grid-cols-2 gap-3">
          <label className="card p-4">
            <span className="text-xs font-bold text-[var(--muted)]">라운드</span>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="tap btn-ghost w-14 text-2xl font-black" onClick={() => setRounds((n) => Math.max(0, n - 1))}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={rounds}
                onChange={(e) => setRounds(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-transparent text-center text-4xl font-black tabular-nums outline-none"
              />
              <button type="button" className="tap btn-ghost w-14 text-2xl font-black" onClick={() => setRounds((n) => n + 1)}>
                +
              </button>
            </div>
          </label>
          <label className="card p-4">
            <span className="text-xs font-bold text-[var(--muted)]">추가 횟수</span>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" className="tap btn-ghost w-14 text-2xl font-black" onClick={() => setExtraReps((n) => Math.max(0, n - 1))}>
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={extraReps}
                onChange={(e) => setExtraReps(Math.max(0, Number(e.target.value) || 0))}
                className="w-full bg-transparent text-center text-4xl font-black tabular-nums outline-none"
              />
              <button type="button" className="tap btn-ghost w-14 text-2xl font-black" onClick={() => setExtraReps((n) => n + 1)}>
                +
              </button>
            </div>
          </label>
        </section>
      ) : (
        <label className="card mt-4 block p-4">
          <span className="text-xs font-bold text-[var(--muted)]">수동 기록 (분:초) · 타이머 대신 써도 됩니다</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="3:24"
            value={manualClock}
            onChange={(e) => setManualClock(e.target.value)}
            className="mt-2 w-full bg-transparent text-4xl font-black tabular-nums outline-none"
          />
        </label>
      )}

      <label className="mt-4 block">
        <span className="text-xs font-bold text-[var(--muted)]">메모</span>
        <textarea value={notesKo} onChange={(e) => setNotesKo(e.target.value)} rows={2} className="field mt-1 min-h-16 py-3 text-sm" />
      </label>

      {history.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">이 벤치마크 기록</h2>
          <ul className="mt-2 space-y-2">
            {history.map((row) => (
              <li key={row.id} className="card flex items-baseline justify-between gap-3 px-4 py-3">
                <span className="font-black tabular-nums">{row.score}</span>
                <span className="text-sm text-[var(--muted)]">
                  {tierLabel(row.tier)} · {new Date(row.completedAt).toLocaleDateString("ko-KR")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {msg ? (
        <p className={`mt-4 text-sm font-bold ${msg.includes("실패") || msg.includes("하세요") ? "text-[var(--danger)]" : "text-[var(--ok)]"}`}>
          {msg}
        </p>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-lg bg-[#0f1117]/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur">
        <button type="button" className="btn-primary tap w-full text-xl" disabled={pending || phase === "done"} onClick={() => void complete()}>
          {pending ? "저장 중…" : "WOD 완료"}
        </button>
      </div>

      <BottomSheet open={Boolean(tipKey)} title={tip?.name || tipKey || "팁"} onClose={() => setTipKey(null)}>
        {tip ? (
          <div className="space-y-3 text-base leading-relaxed">
            {(tip.youtubeLinks ?? []).length > 0 ? (
              (tip.youtubeLinks ?? []).map((link) => (
                <TipMedia
                  key={link.youtubeUrl}
                  youtubeUrl={link.youtubeUrl}
                  youtubeCredit={link.youtubeCredit}
                  label={link.label}
                />
              ))
            ) : (
              <TipMedia youtubeUrl={tip.youtubeUrl} youtubeCredit={tip.youtubeCredit} />
            )}
            {extraPullTips.map((extra) => (
              <TipMedia
                key={extra!.exerciseId || extra!.name}
                youtubeUrl={extra!.youtubeUrl}
                youtubeCredit={extra!.youtubeCredit}
                label={extra!.name}
              />
            ))}
            <p>
              <span className="font-black">큐 · </span>
              {tip.cue}
            </p>
            <p>
              <span className="font-black">실수 · </span>
              {tip.mistake}
            </p>
            <p>
              <span className="font-black">대안 · </span>
              {tip.alternative}
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-base leading-relaxed">
            <TipMedia />
            <p>이 동작 팁이 아직 없습니다.</p>
          </div>
        )}
        <p className="mt-4 text-xs font-bold leading-relaxed text-[var(--muted)]">{disclaimer || TIP_SAFETY_FOOTER}</p>
      </BottomSheet>
    </div>
  );
}
