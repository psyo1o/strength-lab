import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { loadGearCatalog, visibleGearCategories } from "@/lib/gear/affiliates";

export const runtime = "nodejs";

export default async function GearPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const catalog = loadGearCatalog();
  const categories = visibleGearCategories(catalog);

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">장비</h1>
      <p className="mt-3 rounded-2xl border border-[var(--line)] bg-[var(--bg-elev)] p-4 text-sm leading-relaxed text-[var(--text)]">
        {catalog.disclosureKo}
      </p>

      {categories.map((cat) => (
        <section key={cat.id} id={`gear-${cat.id}`} className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">{cat.nameKo}</h2>
          <ul className="mt-2 space-y-2">
            {cat.items.map((item) => (
              <li key={item.id} className="card min-w-0 overflow-hidden p-4">
                {item.imageUrl ? (
                  // Affiliate CDNs vary; avoid next/image remote allowlists.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.imageUrl} alt={item.nameKo} className="mb-3 h-28 w-full max-w-full rounded-xl object-cover" />
                ) : null}
                <div className="break-words text-lg font-black">{item.nameKo}</div>
                {item.whyKo ? (
                  <p className="mt-1 break-words text-sm leading-relaxed text-[var(--muted)]">{item.whyKo}</p>
                ) : null}
                <a
                  href={item.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored nofollow"
                  className="btn-primary tap mt-3 flex w-full min-w-0 items-center justify-center break-words px-3 text-center no-underline"
                >
                  {item.merchant ? `${item.merchant}에서 보기` : "상품 보기"}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <Nav current="/gear" />
    </main>
  );
}
