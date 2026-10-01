import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { GEAR_DISCLOSURE, loadGearCatalog, visibleGearCategories } from "@/lib/gear/affiliates";

export const runtime = "nodejs";

export default async function GearPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const categories = visibleGearCategories(loadGearCatalog());

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">장비</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">{GEAR_DISCLOSURE}</p>

      {categories.map((cat) => (
        <section key={cat.id} id={`gear-${cat.id}`} className="mt-6">
          <h2 className="text-sm font-bold text-[var(--accent)]">{cat.nameKo}</h2>
          <ul className="mt-2 space-y-2">
            {cat.items.map((item) => (
              <li key={item.id} className="min-w-0">
                <a
                  href={item.affiliateUrl}
                  target="_blank"
                  rel="noopener noreferrer sponsored nofollow"
                  className="card tap flex min-h-14 w-full min-w-0 flex-col justify-center break-words p-4 text-[var(--text)] no-underline"
                >
                  {item.imageUrl ? (
                    // Affiliate CDNs vary; avoid next/image remote allowlists.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="mb-3 h-28 w-full max-w-full rounded-xl object-cover" />
                  ) : null}
                  <span className="text-lg font-black">{item.nameKo}</span>
                  {item.whyKo ? <span className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{item.whyKo}</span> : null}
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
