export type WodFormat = "amrap" | "for_time" | "emom";
export type WodTier = "rx" | "scaled" | "beginner";
export type WodCategory = "benchmark" | "conditioning";
export type WodScoreType = "time_sec" | "rounds_reps";

export type WodMovement = {
  exerciseKey: string;
  nameKo: string;
  scheme: string;
  rxKg: number | null;
  rxKgF: number | null;
  rxNote: string;
};

export type WodScaling = {
  tier: WodTier;
  titleKo: string;
  bodyKo: string;
};

export type WodTemplate = {
  slug: string;
  nameKo: string;
  category: WodCategory;
  format: WodFormat;
  timeCapSec: number | null;
  targetRounds: number | null;
  prescriptionKo: string;
  equipmentKo: string;
  sourceNoteKo: string;
  boxHeightCm: number | null;
  boxHeightCmF: number | null;
  wallBallKg: number | null;
  wallBallKgF: number | null;
  wallBallTargetM: number | null;
  wallBallTargetMF: number | null;
  movements: WodMovement[];
  scaling: WodScaling[];
};

export const WOD_SUBS: Record<string, string[]> = {
  pull_up: ["밴드 풀업", "링 로우", "점프 풀업"],
  double_under: ["싱글언더 ×2", "싱글언더"],
  box_jump: ["스텝업", "낮은 박스"],
  thruster: ["덤벨 스러스터", "고블릿 스러스터"],
  burpee: ["스텝 버피", "업다운"],
  toes_to_bar: ["니레이즈", "V업"],
  wall_ball: ["고블릿 스쿼트", "메디신볼 쓰로"],
  kb_swing: ["러시안 스윙", "덤벨 스윙"],
  run: ["행", "짧은 런"],
  push_up: ["무릎 푸시업"],
  sit_up: ["크런치"],
  air_squat: ["박스 스쿼트"],
};

export function formatLabel(format: WodFormat): string {
  if (format === "amrap") return "AMRAP";
  if (format === "emom") return "EMOM";
  return "For Time";
}

export function categoryLabel(category: WodCategory): string {
  return category === "benchmark" ? "벤치마크" : "컨디셔닝";
}

export function tierLabel(tier: WodTier): string {
  if (tier === "scaled") return "Scaled";
  if (tier === "beginner") return "Beginner";
  return "Rx";
}

export function scoreTypeFor(format: WodFormat): WodScoreType {
  return format === "for_time" ? "time_sec" : "rounds_reps";
}

export function formatClock(sec: number): string {
  const n = Math.max(0, Math.floor(sec));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = String(n % 60).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${s}`;
  return `${m}:${s}`;
}

export function parseClock(text: string): number | null {
  const raw = text.trim();
  if (!raw) return null;
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 1) return Math.floor(parts[0]!);
  if (parts.length === 2) return Math.floor(parts[0]!) * 60 + Math.floor(parts[1]!);
  if (parts.length === 3) {
    return Math.floor(parts[0]!) * 3600 + Math.floor(parts[1]!) * 60 + Math.floor(parts[2]!);
  }
  return null;
}

export function wodTipKeys(template: Pick<WodTemplate, "movements">): string[] {
  const keys = template.movements.map((m) => m.exerciseKey);
  if (keys.includes("pull_up")) {
    keys.push("kipping_pull_up", "butterfly_pull_up");
  }
  return [...new Set(keys)];
}
