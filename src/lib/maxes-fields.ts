import fs from "node:fs";
import path from "node:path";
import { P1_META } from "./programs/p1-meta";

/** Powerlifting 1RM keys. `power_clean` is olympic-only so it never duplicates here. */
export const MAX_GROUP_PL = ["squat", "bench", "deadlift", "ohp", "front_squat", "barbell_row"] as const;

/** Olympic 1RM keys. Shared lifts (power_clean) live here, not in PL. */
export const MAX_GROUP_OLYMPIC = [
  "snatch",
  "clean_jerk",
  "clean",
  "jerk",
  "power_clean",
  "power_snatch",
  "power_jerk",
  "muscle_snatch",
  "push_press",
  "ohs",
] as const;

/** Conditioning 1RMs only. Box/wall-ball gear lives in user_equipment, not here. */
export const MAX_GROUP_WOD = ["thruster", "kb_swing", "bodyweight"] as const;
export const MAX_GROUP_WOD_EQUIP = ["box_height_cm", "wall_ball_target_m"] as const;
export const WOD_RAW_MAX_KEYS = new Set<string>(MAX_GROUP_WOD_EQUIP);

export const MAX_GROUPS = {
  pl: MAX_GROUP_PL,
  olympic: MAX_GROUP_OLYMPIC,
  wod: MAX_GROUP_WOD,
};

/** Distinct Korean labels so similar lifts are not read as typos/dupes. */
export const MAX_LABELS: Record<string, string> = {
  squat: "스쿼트",
  bench: "벤치프레스",
  deadlift: "데드리프트",
  ohp: "오버헤드프레스 (스트릭트)",
  front_squat: "프론트 스쿼트",
  barbell_row: "바벨로우",
  snatch: "스네치",
  clean_jerk: "클린앤저크 (경합)",
  clean: "클린 (스쿼트클린)",
  jerk: "저크 (스플릿)",
  power_clean: "파워클린",
  power_snatch: "파워스네치",
  power_jerk: "파워저크",
  muscle_snatch: "머슬스네치",
  push_press: "푸쉬프레스 (레그 드라이브)",
  ohs: "오버헤드스쿼트",
  rehab_target: "재활 목표 동작",
  thruster: "스러스터",
  kb_swing: "케틀벨 스윙",
  bodyweight: "체중",
};

export type MaxesGroupSpec = { title: string; keys: string[] };

export function uniqueKeys(keys: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export function extraProgramMaxKeys(): string[] {
  return uniqueKeys(Object.values(P1_META).flatMap((m) => (m.extraOneRmFields ?? []).map((f) => f.key)));
}

export function extraProgramMaxLabel(key: string): string | undefined {
  for (const meta of Object.values(P1_META)) {
    const hit = meta.extraOneRmFields?.find((f) => f.key === key);
    if (hit?.label) return hit.label;
  }
  return undefined;
}

export function labelForMaxField(key: string, fallback?: string): string {
  return MAX_LABELS[key] ?? extraProgramMaxLabel(key) ?? fallback ?? key;
}

/** First-seen wins: PL, then olympic, then extras / canonical leftovers. */
export function buildMaxesGroups(opts?: {
  extraKeys?: string[];
  canonicalOneRmFields?: string[];
  seedOneRmFields?: string[];
}): MaxesGroupSpec[] {
  const used = new Set<string>();
  const take = (keys: readonly string[]) =>
    uniqueKeys(keys).filter((key) => {
      if (used.has(key)) return false;
      used.add(key);
      return true;
    });

  const extras = opts?.extraKeys ?? extraProgramMaxKeys();
  const leftovers = uniqueKeys([...(opts?.canonicalOneRmFields ?? []), ...(opts?.seedOneRmFields ?? []), ...extras]);

  return [
    { title: "파워리프팅", keys: take(MAX_GROUP_PL) },
    { title: "역도", keys: take(MAX_GROUP_OLYMPIC) },
    { title: "컨디셔닝", keys: take([...MAX_GROUP_WOD]) },
    { title: "프로그램 추가 1RM", keys: take(leftovers) },
  ].filter((g) => g.keys.length > 0);
}

export function allMaxesKeys(groups: MaxesGroupSpec[] = buildMaxesGroups()): string[] {
  return groups.flatMap((g) => g.keys);
}

export function canonicalOneRmKeysFromSeed(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "seed.json"), "utf8")) as {
      oneRmFields?: Record<string, unknown>;
    };
    return Object.keys(raw.oneRmFields ?? {});
  } catch {
    return [];
  }
}
