import fs from "node:fs";
import path from "node:path";

export type Tip = {
  cue: string;
  mistake: string;
  alternative: string;
  sheet: string;
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

export function tipFor(exerciseKey: string): Tip | null {
  const file = loadTips();
  return file.tips[exerciseKey] ?? null;
}

export function tipDisclaimer(): string {
  return loadTips().disclaimer;
}
