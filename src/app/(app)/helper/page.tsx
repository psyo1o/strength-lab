import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";
import { EpleyHelper } from "@/components/EpleyHelper";

export const runtime = "nodejs";

export default async function HelperPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black">1RM 헬퍼</h1>
          <p className="text-sm text-[var(--muted)]">Epley: 무게 × (1 + 반복/30)</p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      <EpleyHelper unit={user.unit} />
      <Nav current="/settings" />
    </main>
  );
}
