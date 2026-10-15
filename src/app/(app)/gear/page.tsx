import { getCurrentUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";
import { GearShelf } from "@/components/GearShelf";
import { gearPageModel } from "@/lib/gear/affiliates";

export const runtime = "nodejs";

export default async function GearPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const model = gearPageModel();

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">장비</h1>
      <GearShelf model={model} />
      <Nav current="/gear" />
    </main>
  );
}
