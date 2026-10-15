import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Legacy URL. Named benchmarks live on the WOD board. */
export default function BenchmarksPage() {
  redirect("/wod");
}
