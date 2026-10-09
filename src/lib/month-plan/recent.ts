import { getSqlite } from "../db/client";
import { getWodTemplate } from "../wod/templates";
import { patternOfKey } from "./pattern-keys";
import { isMetconStimulus, type MetconPattern, type RecentMetcon } from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

export function patternFromKeys(keys: string[]): MetconPattern {
  const tags = new Set<MetconPattern>();
  for (const key of keys) tags.add(patternOfKey(key));
  if (tags.size === 1) return [...tags][0]!;
  if (tags.has("engine") && tags.size > 1) return "engine";
  return tags.values().next().value ?? "gymnastic";
}

export function recentMetconPatterns(userId: number, nowMs = Date.now()): RecentMetcon[] {
  const since = nowMs - WEEK_MS;
  const wodRows = getSqlite()
    .prepare(
      `SELECT template_slug AS slug, completed_at AS at
       FROM wod_results WHERE user_id = ? AND completed_at >= ?
       ORDER BY completed_at DESC LIMIT 7`,
    )
    .all(userId, since) as { slug: string; at: number }[];
  const planRows = getSqlite()
    .prepare(
      `SELECT s.signature AS signature, s.completed_at AS at, p.plan_json AS planJson, s.day_key AS dayKey
       FROM month_plan_scores s
       JOIN month_plans p ON p.id = s.plan_id
       WHERE s.user_id = ? AND s.completed_at >= ?
       ORDER BY s.completed_at DESC LIMIT 7`,
    )
    .all(userId, since) as { signature: string; at: number; planJson: string; dayKey: string }[];

  const stamped: { at: number; pattern: MetconPattern; stimulus?: RecentMetcon["stimulus"] }[] = [];
  for (const row of wodRows) {
    const template = getWodTemplate(row.slug);
    if (!template) continue;
    stamped.push({ at: row.at, pattern: patternFromKeys(template.movements.map((m) => m.exerciseKey)) });
  }
  for (const row of planRows) {
    try {
      const week = JSON.parse(row.planJson) as {
        days?: { day: string; piece?: { pattern?: MetconPattern; stimulus?: unknown } | null }[];
      };
      const piece = week.days?.find((day) => day.day === row.dayKey)?.piece;
      if (!piece?.pattern) continue;
      stamped.push({
        at: row.at,
        pattern: piece.pattern,
        ...(isMetconStimulus(piece.stimulus) ? { stimulus: piece.stimulus } : {}),
      });
    } catch {
      continue;
    }
  }
  stamped.sort((a, b) => b.at - a.at);
  return stamped.slice(0, 7).map((row) => ({ pattern: row.pattern, ...(row.stimulus ? { stimulus: row.stimulus } : {}) }));
}

export type RecentMetconBan = {
  signatures: string[];
  names: string[];
};

/** Names and signatures scored in the last 30 days. Either one blocks a repeat when another candidate exists. */
export function recentMetconBans(userId: number, nowMs = Date.now()): RecentMetconBan {
  const since = nowMs - MONTH_MS;
  const rows = getSqlite()
    .prepare(
      `SELECT signature, piece_name_ko AS nameKo FROM month_plan_scores
       WHERE user_id = ? AND completed_at >= ?
       ORDER BY completed_at DESC`,
    )
    .all(userId, since) as { signature: string; nameKo: string }[];
  const signatures: string[] = [];
  const names: string[] = [];
  for (const row of rows) {
    if (row.signature.trim()) signatures.push(row.signature);
    if (row.nameKo.trim()) names.push(row.nameKo);
  }
  return { signatures, names };
}
