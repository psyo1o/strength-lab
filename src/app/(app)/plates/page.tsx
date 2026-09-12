import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { UnitToggle } from "@/components/UnitToggle";
import { PlateCalc } from "@/components/PlateCalc";

export const runtime = "nodejs";

export default async function PlatesPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  return (
    <main className="px-4 pt-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-black">원판 계산</h1>
          <p className="text-sm text-[var(--muted)]">목표 중량을 로드 가능한 단위로 반올림합니다.</p>
        </div>
        <UnitToggle unit={user.unit} />
      </div>
      <PlateCalc unit={user.unit} />
      <Nav current="/settings" />
    </main>
  );
}
