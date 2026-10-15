import { getSqlite } from "../db/client";

/** Class intensity stored for the next generation. Member and box can override later. */
export const CLASS_INTENSITY_KEY = "class_intensity_level";
export const CLASS_INTENSITY_DEFAULT = 3;
export const CLASS_INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;

export function parseClassIntensity(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  if (!Number.isInteger(number) || number < 1 || number > 5) return null;
  return number;
}

/** Later settings win in this order: member, box, class, then 3. */
export function resolveClassIntensity(input: { member?: unknown; box?: unknown; classLevel?: unknown } = {}): number {
  return (
    parseClassIntensity(input.member) ??
    parseClassIntensity(input.box) ??
    parseClassIntensity(input.classLevel) ??
    CLASS_INTENSITY_DEFAULT
  );
}

export function readStoredClassIntensity(): number {
  try {
    const row = getSqlite().prepare("SELECT value FROM app_meta WHERE key = ?").get(CLASS_INTENSITY_KEY) as { value: string } | undefined;
    return resolveClassIntensity({ classLevel: row?.value });
  } catch {
    return CLASS_INTENSITY_DEFAULT;
  }
}

export function writeStoredClassIntensity(level: unknown): number {
  const parsed = parseClassIntensity(level);
  if (parsed == null) throw new Error("클래스 강도는 1부터 5까지입니다.");
  getSqlite()
    .prepare("INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(CLASS_INTENSITY_KEY, String(parsed));
  return parsed;
}
