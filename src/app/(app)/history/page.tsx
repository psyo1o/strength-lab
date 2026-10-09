import { getCurrentUser } from "@/lib/auth";
import { HistoryScreen } from "@/components/HistoryScreen";
import { Nav } from "@/components/Nav";
import { defaultHistoryDate } from "@/lib/month-plan/history-day";
import { listHistoryCards } from "@/lib/month-plan/history";
import { trainingDayKey } from "@/lib/progress";

export const runtime = "nodejs";

export default async function HistoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const cards = listHistoryCards(user.id, user.unit);
  const today = trainingDayKey(Date.now());
  const initialDate = defaultHistoryDate(
    [...new Set(cards.map((card) => card.date))],
    today,
  );

  return (
    <main className="min-w-0 px-4 pt-6 pb-8">
      <h1 className="text-2xl font-black">기록</h1>
      <HistoryScreen initialDate={initialDate} cards={cards} />
      <Nav current="/dashboard" />
    </main>
  );
}
