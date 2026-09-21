import Link from "next/link";

const items = [
  { href: "/dashboard", label: "오늘" },
  { href: "/maxes", label: "1RM" },
  { href: "/wod", label: "WOD" },
  { href: "/programs", label: "프로그램" },
  { href: "/settings", label: "설정" },
];

export function Nav({ current }: { current?: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--line)] bg-[#0f1117]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-5">
        {items.map((it) => {
          const active =
            current === it.href ||
            (it.href !== "/dashboard" && current?.startsWith(it.href));
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`tap flex flex-col items-center justify-center py-2 text-sm font-bold ${
                active ? "text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              {it.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
