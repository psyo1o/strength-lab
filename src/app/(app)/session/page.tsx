import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

export default async function SessionIndex() {
  const user = await getCurrentUser();
  if (user?.lastSession) redirect(user.lastSession);
  if (user?.currentProgram) redirect(`/programs/${user.currentProgram}`);
  redirect("/programs/jim-wendler-531");
}
