import fs from "node:fs";
import path from "node:path";

export type Tip = {
  cue: string;
  mistake: string;
  alternative: string;
  sheet: string;
  name?: string;
  exerciseId?: string;
};

type TipFile = {
  disclaimer: string;
  tips: Record<string, Tip>;
};

let cached: TipFile | null = null;

export function loadTips(): TipFile {
  if (cached) return cached;
  const file = path.join(process.cwd(), "data", "exercise-tips.ko.json");
  cached = JSON.parse(fs.readFileSync(file, "utf8")) as TipFile;
  return cached;
}

const TIP_ALIASES: Record<string, string> = {
  squat: "back_squat",
  back_squat: "squat",
  bench: "bench_press",
  bench_press: "bench",
  rdl: "stiff_leg_deadlift",
  clean: "squat_clean",
  clean_jerk: "split_jerk",
  jerk: "split_jerk",
  snatch: "squat_snatch",
};

export function tipFor(exerciseKey: string): Tip | null {
  const file = loadTips();
  return file.tips[exerciseKey] ?? file.tips[TIP_ALIASES[exerciseKey]] ?? null;
}

export function tipDisclaimer(): string {
  return loadTips().disclaimer;
}
