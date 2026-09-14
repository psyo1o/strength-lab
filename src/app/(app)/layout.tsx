import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Footer } from "@/components/Footer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-20">
      {children}
      <Footer />
    </div>
  );
}
