import { getSqlite } from "../db/client";
import { formatKoDate, trainingDayKey } from "../progress";
import { getWodTemplate, listWodTemplates, wodSlugAliases } from "./templates";
import { formatClock, scoreTypeFor, type WodFormat, type WodScoreType, type WodTier } from "./types";

export type { WodScoreType };

export type WodResult = {
  id: number;
  userId: number;
  templateSlug: string;
  completedAt: number;
  tier: WodTier;
  scoreType: WodScoreType;
  timeSec: number | null;
  rounds: number | null;
  extraReps: number | null;
  notesKo: string;
  scaleNotes: string;
  substitutions: string;
  equipmentJson: string;
};

export type WodResultInput = {
  templateSlug: string;
  tier: WodTier;
  timeSec?: number | null;
  rounds?: number | null;
  extraReps?: number | null;
  notesKo?: string;
  scaleNotes?: string;
  substitutions?: string;
  equipmentJson?: string;
  completedAt?: number;
};

function asTier(value: string): WodTier {
  return value === "scaled" || value === "beginner" ? value : "rx";
}

function rowToResult(row: {
  id: number;
  user_id: number;
  template_slug: string;
  completed_at: number;
  tier: string;
  score_type: string;
  time_sec: number | null;
  rounds: number | null;
  extra_reps: number | null;
  notes_ko: string | null;
  scale_notes: string | null;
  substitutions: string | null;
  equipment_json: string | null;
}): WodResult {
  return {
    id: row.id,
    userId: row.user_id,
    templateSlug: row.template_slug,
    completedAt: row.completed_at,
    tier: asTier(row.tier),
    scoreType: row.score_type === "rounds_reps" ? "rounds_reps" : "time_sec",
    timeSec: row.time_sec,
    rounds: row.rounds,
    extraReps: row.extra_reps,
    notesKo: row.notes_ko ?? "",
    scaleNotes: row.scale_notes ?? "",
    substitutions: row.substitutions ?? "",
    equipmentJson: row.equipment_json ?? "",
  };
}

export function formatWodScore(result: Pick<WodResult, "scoreType" | "timeSec" | "rounds" | "extraReps">): string {
  if (result.scoreType === "time_sec" && result.timeSec != null) {
    return formatClock(result.timeSec);
  }
  const rounds = result.rounds ?? 0;
  const reps = result.extraReps ?? 0;
  return reps > 0 ? `${rounds}R + ${reps}` : `${rounds}R`;
}

export function wodCardCopy(result: WodResult, nameKo: string): { title: string; line: string } {
  const dateLabel = formatKoDate(trainingDayKey(result.completedAt));
  const score = formatWodScore(result);
  const tier = result.tier === "scaled" ? "Scaled" : result.tier === "beginner" ? "Beginner" : "Rx";
  return {
    title: `${nameKo} · ${dateLabel}`,
    line: `${score} · ${tier}`,
  };
}

function scoreRank(result: WodResult): number | null {
  if (result.scoreType === "time_sec") {
    return result.timeSec != null && result.timeSec > 0 ? result.timeSec : null;
  }
  const rounds = result.rounds ?? 0;
  const reps = result.extraReps ?? 0;
  if (rounds <= 0 && reps <= 0) return null;
  return rounds * 1000 + reps;
}

export function betterWodResult(format: WodFormat, a: WodResult, b: WodResult): WodResult {
  const ra = scoreRank(a);
  const rb = scoreRank(b);
  if (ra == null) return b;
  if (rb == null) return a;
  const higherIsBetter = format === "amrap" || format === "emom";
  if (higherIsBetter) return ra >= rb ? a : b;
  return ra <= rb ? a : b;
}

export function saveWodResult(userId: number, input: WodResultInput): WodResult {
  const template = getWodTemplate(input.templateSlug);
  if (!template) throw new Error("wod not found");
  const scoreType = scoreTypeFor(template.format);
  const completedAt = input.completedAt ?? Date.now();
  const info = getSqlite()
    .prepare(
      `INSERT INTO wod_results (
         user_id, template_slug, completed_at, tier, score_type,
         time_sec, rounds, extra_reps, notes_ko, scale_notes, substitutions, equipment_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      userId,
      template.slug,
      completedAt,
      input.tier,
      scoreType,
      scoreType === "time_sec" ? input.timeSec ?? null : null,
      scoreType === "rounds_reps" ? input.rounds ?? 0 : null,
      scoreType === "rounds_reps" ? input.extraReps ?? 0 : null,
      input.notesKo ?? "",
      input.scaleNotes ?? "",
      input.substitutions ?? "",
      input.equipmentJson ?? "",
    );
  return getWodResult(Number(info.lastInsertRowid))!;
}

export function getWodResult(id: number): WodResult | null {
  const row = getSqlite()
    .prepare(
      `SELECT id, user_id, template_slug, completed_at, tier, score_type,
              time_sec, rounds, extra_reps, notes_ko, scale_notes, substitutions, equipment_json
       FROM wod_results WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        user_id: number;
        template_slug: string;
        completed_at: number;
        tier: string;
        score_type: string;
        time_sec: number | null;
        rounds: number | null;
        extra_reps: number | null;
        notes_ko: string | null;
        scale_notes: string | null;
        substitutions: string | null;
        equipment_json: string | null;
      }
    | undefined;
  return row ? rowToResult(row) : null;
}

export function listWodResults(userId: number, slug?: string, limit = 30): WodResult[] {
  const aliases = slug ? wodSlugAliases(slug) : [];
  const select = `SELECT id, user_id, template_slug, completed_at, tier, score_type,
              time_sec, rounds, extra_reps, notes_ko, scale_notes, substitutions, equipment_json
       FROM wod_results`;
  const sql = aliases.length
    ? `${select} WHERE user_id = ? AND template_slug IN (${aliases.map(() => "?").join(", ")})
       ORDER BY completed_at DESC LIMIT ?`
    : `${select} WHERE user_id = ?
       ORDER BY completed_at DESC LIMIT ?`;
  const rows = aliases.length
    ? (getSqlite().prepare(sql).all(userId, ...aliases, limit) as Parameters<typeof rowToResult>[0][])
    : (getSqlite().prepare(sql).all(userId, limit) as Parameters<typeof rowToResult>[0][]);
  return rows.map(rowToResult);
}

export function wodPr(userId: number, slug: string): WodResult | null {
  const template = getWodTemplate(slug);
  if (!template) return null;
  const rows = listWodResults(userId, slug, 50);
  if (!rows.length) return null;
  return rows.reduce((best, row) => betterWodResult(template.format, best, row));
}

export function listWodBoard(userId: number) {
  return listWodTemplates().map((template) => {
    const pr = wodPr(userId, template.slug);
    return {
      slug: template.slug,
      nameKo: template.nameKo,
      category: template.category,
      family: template.family,
      format: template.format,
      prescriptionKo: template.prescriptionKo,
      pr,
      prLabel: pr ? formatWodScore(pr) : null,
    };
  });
}

export function wodTrainingDayKeys(userId: number): string[] {
  const rows = getSqlite()
    .prepare("SELECT completed_at FROM wod_results WHERE user_id = ?")
    .all(userId) as { completed_at: number }[];
  const KST_MS = 9 * 60 * 60 * 1000;
  return [
    ...new Set(
      rows.map((r) => new Date(r.completed_at + KST_MS).toISOString().slice(0, 10)),
    ),
  ];
}
