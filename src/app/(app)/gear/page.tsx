import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { EquipmentForm } from "@/components/EquipmentForm";
import { loadGearCatalog } from "@/lib/gear/affiliates";
import { getUserEquipment } from "@/lib/equipment";

export const runtime = "nodejs";

export default async function GearPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const catalog = loadGearCatalog();

  return (
    <main className="px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">장비</h1>
      <p className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-elev)] p-4 text-sm leading-relaxed text-[var(--text)]">
        {catalog.disclosureKo}
      </p>
      {catalog.noteKo ? <p className="mt-3 text-sm text-[var(--muted)]">{catalog.noteKo}</p> : null}

      <EquipmentForm initial={getUserEquipment(user.id)} />

      {catalog.categories.map((cat) => (
        <section key={cat.id} id={`gear-${cat.id}`} className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">{cat.nameKo}</h2>
          <ul className="mt-2 space-y-2">
            {cat.items.map((item) => (
              <li key={item.id} className="card p-4">
                {item.imageUrl ? (
                  // Affiliate CDNs vary; avoid next/image remote allowlists.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.nameKo} className="mb-3 h-28 w-full rounded-xl object-cover" />
                ) : null}
                <div className="text-lg font-black">{item.nameKo}</div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{item.whyKo}</p>
                <div className="mt-2 text-xs font-bold text-[var(--muted)]">{item.merchant}</div>
                {item.configured ? (
                  <a
                    href={item.affiliateUrl}
                    target="_blank"
                    rel="noopener noreferrer sponsored nofollow"
                    className="btn-primary tap mt-3 flex w-full items-center justify-center no-underline"
                  >
                    {item.merchant}에서 보기
                  </a>
                ) : (
                  <div className="btn-ghost tap mt-3 flex w-full items-center justify-center text-[var(--muted)]">
                    링크 미설정
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Nav current="/gear" />
    </main>
  );
}
