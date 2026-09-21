import { getCurrentUser } from "@/lib/auth";
import { getUserMaxes, getUserStarts, START_WEIGHT_KEYS } from "@/lib/maxes";
import { buildMaxesGroups, canonicalOneRmKeysFromSeed, extraProgramMaxKeys, labelForMaxField } from "@/lib/maxes-fields";
import { canonicalOneRmFields } from "@/lib/tips";
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
  const starts = getUserStarts(user.id);
  const startSet = new Set<string>(START_WEIGHT_KEYS);
  const rows = getSqlite()
    .prepare(`SELECT key, name_ko, "group" FROM exercises`)
    .all() as { key: string; name_ko: string; group: string }[];
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  const specs = buildMaxesGroups({
    extraKeys: extraProgramMaxKeys(),
    canonicalOneRmFields: canonicalOneRmFields(),
    seedOneRmFields: canonicalOneRmKeysFromSeed(),
  });

  const toFields = (keys: readonly string[]) =>
    keys.map((key) => ({
      key,
      nameKo: labelForMaxField(key, byKey[key]?.name_ko),
      value: maxes[key] ? displayWeight(maxes[key], user.unit) : "",
      showStart: startSet.has(key),
      startValue: starts[key] ? displayWeight(starts[key], user.unit) : "",
    }));

  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black">1RM</h1>
          <p className="text-sm text-[var(--muted)]">저장은 항상 kg. 화면만 {user.unit}.</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            초보 프로그램(SS/StrongLifts/Madcow)용 첫 운동 무게예요. 1RM을 모르면 여기만 넣어도 됩니다. 모르면 비워도 OK.
          </p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      <MaxesForm
        unit={user.unit}
        groups={specs.map((g) => ({ title: g.title, fields: toFields(g.keys) }))}
      />
      <Nav current="/maxes" />
    </main>
  );
}
