import type { ReactNode } from "react";

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col px-5 pt-10">
      <h1 className="text-3xl font-black">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-[var(--muted)]">{subtitle}</p> : null}
      <div className="mt-6 flex-1 pb-32">{children}</div>
    </main>
  );
}

export function BottomCta({
  label,
  pending,
  form,
  aboveNav,
}: {
  label: string;
  pending?: boolean;
  form: string;
  aboveNav?: boolean;
}) {
  return (
    <div
      className={`fixed inset-x-0 z-30 border-t border-[var(--line)] bg-[#0b0c10] px-5 pt-3 ${
        aboveNav ? "bottom-16 pb-3" : "bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      }`}
    >
      <div className="mx-auto max-w-lg">
        <button type="submit" form={form} className="btn-primary tap w-full" disabled={pending}>
          {pending ? "처리 중…" : label}
        </button>
      </div>
    </div>
  );
}
