import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes, MAX_GROUPS } from "@/lib/maxes";
import { displayWeight } from "@/lib/calc/round";
import { getSqlite } from "@/lib/db/client";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";
import { MaxesForm } from "@/components/MaxesForm";

export const runtime = "nodejs";

export default async function MaxesPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const maxes = getUserMaxes(user.id);
  const rows = getSqlite()
    .prepare(`SELECT key, name_ko, "group" FROM exercises WHERE is_max = 1`)
    .all() as { key: string; name_ko: string; group: string }[];
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  const toFields = (keys: readonly string[]) =>
    keys.filter((k, i) => keys.indexOf(k) === i).map((key) => ({
      key,
      nameKo: byKey[key]?.name_ko ?? key,
      value: maxes[key] ? displayWeight(maxes[key], user.unit) : "",
    }));

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black">1RM</h1>
          <p className="text-sm text-[var(--muted)]">저장은 항상 kg. 화면만 {user.unit}.</p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      <MaxesForm
        unit={user.unit}
        groups={[
          { title: "파워리프팅", fields: toFields(MAX_GROUPS.pl) },
          { title: "역도", fields: toFields(MAX_GROUPS.olympic) },
        ]}
      />
      <Nav current="/maxes" />
    </main>
  );
}
