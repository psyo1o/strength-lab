import type { EngineHelp } from "@/lib/programming/admin-help";

const FACTS = [
  ["하는 일", "does"],
  ["누를 때", "when"],
  ["생기는 변화", "effect"],
  ["모델과 비용", "cost"],
  ["되돌리기", "undo"],
] as const;

export function EngineHelpBlock({ help }: { help: EngineHelp }) {
  return (
    <div className="mt-1">
      <p className="text-sm leading-relaxed text-[var(--muted)]">{help.short}</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-sm font-bold">자세한 설명</summary>
        <dl className="mt-2 space-y-2 text-sm leading-relaxed">
          {FACTS.map(([label, key]) => (
            <div key={key}>
              <dt className="font-bold">{label}</dt>
              <dd className="text-[var(--muted)]">{help[key]}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
