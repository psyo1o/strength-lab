import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";
import { EpleyHelper } from "@/components/EpleyHelper";

export const runtime = "nodejs";

export default async function HelperPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <main className="min-w-0 px-4 pt-6">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-black">1RM 헬퍼</h1>
          <p className="break-words text-sm text-[var(--muted)]">Epley: 무게 × (1 + 반복/30)</p>
        </div>
        <div className="shrink-0">
          <UnitToggle unit={user.unit} />
        </div>
      </div>
      <EpleyHelper unit={user.unit} />
      <Nav current="/settings" />
    </main>
  );
}
