import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Footer } from "@/components/Footer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto min-h-dvh w-full min-w-0 max-w-lg pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
      {children}
      <Footer />
    </div>
  );
}
