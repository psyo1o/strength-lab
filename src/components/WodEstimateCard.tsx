import { ESTIMATE_LABEL, type WodEstimate } from "@/lib/wod/estimate";

export function WodEstimateCard({ estimate }: { estimate: WodEstimate }) {
  return (
    <section className="card mt-4 p-4">
      <div className="text-sm font-bold text-[var(--accent)]">{ESTIMATE_LABEL}</div>
      <div className="mt-1 break-words text-2xl font-black tabular-nums">{estimate.valueLabel}</div>
      {estimate.hintKo ? <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{estimate.hintKo}</p> : null}
    </section>
  );
}

export function WodEstimateLine({ estimate }: { estimate: WodEstimate }) {
  return (
    <p className="mt-1 break-words text-sm">
      <span className="font-bold text-[var(--accent)]">{ESTIMATE_LABEL}</span>
      <span className="ml-2 font-bold tabular-nums text-[var(--text)]">{estimate.valueLabel}</span>
    </p>
  );
}
