import Link from "next/link";

const items = [
  { href: "/dashboard", label: "오늘" },
  { href: "/maxes", label: "1RM" },
  { href: "/wod", label: "WOD" },
  { href: "/programs", label: "프로그램" },
  { href: "/gear", label: "장비" },
  { href: "/settings", label: "설정" },
];

export function Nav({ current }: { current?: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[#0f1117]/95 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-6">
        {items.map((it) => {
          const active =
            current === it.href ||
            (it.href !== "/dashboard" && current?.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              title={it.label}
              className={`tap flex min-w-0 flex-col items-center justify-center px-0.5 py-2 text-center text-[11px] font-bold leading-tight ${
                active ? "text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              <span className="max-w-full">{it.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
