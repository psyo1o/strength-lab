/** Track distances. A lap is 400m. A mile is 1600m, four laps. */
export const TRACK_LAP_M = 400;
export const MILE_M = 1600;

const RUN_LABEL: Record<string, string> = {
  "400m": "400m (트랙 1바퀴)",
  "800m": "800m (트랙 2바퀴)",
  "1200m": "1200m (트랙 3바퀴)",
  "1600m": "1600m (트랙 4바퀴)",
};

export function runDistanceLabel(amount: string): string | null {
  const base = amount.split(" ")[0] ?? amount;
  return RUN_LABEL[base] ?? null;
}
