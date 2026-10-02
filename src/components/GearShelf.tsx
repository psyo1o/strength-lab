import type { GearPageModel } from "@/lib/gear/affiliates";

export function GearShelf({ model }: { model: GearPageModel }) {
  return (
    <>
      <p className="gear-disclosure">{model.disclosure}</p>
      <ul className="mt-4 space-y-3">
        {model.partner ? (
          <li data-gear="partner" className="card min-w-0 p-4">
            {/* Confirmed product thumbnail. Plain img avoids a remote image allowlist. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={model.partner.imageUrl}
              alt={model.partner.nameKo}
              referrerPolicy="no-referrer"
              className="h-40 w-full max-w-full rounded-xl object-cover"
            />
            <div className="mt-3 break-words text-lg font-black">{model.partner.nameKo}</div>
            <p className="mt-1 break-words text-sm leading-relaxed text-[var(--muted)]">{model.partner.whyKo}</p>
            <a
              href={model.partner.href}
              target="_blank"
              rel="noopener noreferrer sponsored nofollow"
              className="btn-primary tap mt-3 flex w-full min-w-0 items-center justify-center break-words px-3 text-center no-underline"
            >
              쿠팡에서 보기
            </a>
          </li>
        ) : null}
        {model.references.map((item) => (
          <li key={item.id} data-gear="reference" className="card min-w-0 p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.imageUrl} alt={item.nameKo} className="h-40 w-full max-w-full rounded-xl object-cover" />
            <div className="mt-3 break-words text-lg font-black">{item.nameKo}</div>
            <p className="mt-1 break-words text-sm leading-relaxed text-[var(--muted)]">{item.whyKo}</p>
            <span className="gear-pending">아직 링크가 없어요</span>
          </li>
        ))}
      </ul>
    </>
  );
}
