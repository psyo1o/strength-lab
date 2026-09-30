import type { WeightUnit } from "../calc/round";
import { getSqlite } from "../db/client";
import { formatKoDate, trainingDayKey } from "../progress";
import { listWodResults, type WodResult } from "../wod/queries";
import { getWodTemplate } from "../wod/templates";
import { daySummary } from "./build-week";
import { formatSetGroups, personalRankLabel, planCalendarDate, samePersonalGroup } from "./history-day";
import {
  liftComparison,
  metconComparison,
  namedComparison,
  scoreLabel,
  type HistoryCompare,
  type ScoreSnap,
} from "./compare";
import { pieceSignature } from "./signature";
import {
  listPlans,
  listPlanScores,
  planDayHref,
  scoresForDay,
  type PlanScore,
  type StoredPlan,
} from "./store";
import { topSetKg } from "./loads";
import type { DayKey, PlannedDay } from "./types";

export type HistoryScore = {
  id: string;
  at: number;
  label: string;
  notesKo: string;
};

export type HistoryItem = {
  key: string;
  at: number;
  href: string;
  title: string;
  line: string;
  kind: "plan" | "wod" | "session";
  compares: HistoryCompare[];
  scores: HistoryScore[];
};

type SessionLift = { exerciseKey: string; nameKo: string; weightKg: number | null };

type SessionGroup = {
  key: string;
  at: number;
  href: string;
  title: string;
  programNameKo: string;
  lifts: SessionLift[];
};

type Comparable = {
  id: string;
  at: number;
  snap: ScoreSnap;
  pieceKey: string;
  signature: string;
  named: boolean;
  nameKo: string;
  format: string;
};

function snapOf(score: { timeSec: number | null; rounds: number | null; extraReps: number | null }): ScoreSnap {
  return { timeSec: score.timeSec, rounds: score.rounds, extraReps: score.extraReps };
}

function hasSnap(score: ScoreSnap): boolean {
  return scoreLabel(score) !== "";
}

function formatFromSignature(signature: string): string {
  return signature.split("|")[0] || "for_time";
}

function wodComparable(result: WodResult): Comparable | null {
  const template = getWodTemplate(result.templateSlug);
  if (!template) return null;
  const signature = pieceSignature(
    template.format,
    template.movements.map((m) => ({ key: m.exerciseKey, amount: m.scheme })),
  );
  const snap = snapOf(result);
  if (!hasSnap(snap)) return null;
  return {
    id: `wr:${result.id}`,
    at: result.completedAt,
    snap,
    pieceKey: `named:${template.slug}`,
    signature,
    named: true,
    nameKo: template.nameKo,
    format: template.format,
  };
}

function planComparable(score: PlanScore, format: string): Comparable | null {
  const snap = snapOf(score);
  if (!hasSnap(snap)) return null;
  return {
    id: `ps:${score.id}`,
    at: score.completedAt,
    snap,
    pieceKey: score.pieceKey,
    signature: score.signature,
    named: score.named,
    nameKo: score.pieceNameKo,
    format: format || formatFromSignature(score.signature),
  };
}

function earlierMatch(
  pool: Comparable[],
  current: Comparable | null,
  query: { pieceKey: string; signature: string; named: boolean; at: number | null },
): Comparable | null {
  const candidates = pool.filter((row) => {
    if (current && row.id === current.id) return false;
    if (query.at != null && row.at > query.at) return false;
    if (query.named && row.pieceKey && row.pieceKey === query.pieceKey) return true;
    if (query.signature && row.signature === query.signature) return true;
    return false;
  });
  candidates.sort((a, b) => b.at - a.at);
  return candidates[0] ?? null;
}

function compareTo(current: Comparable | null, earlier: Comparable, preferNamed: boolean): HistoryCompare {
  const named = preferNamed && earlier.pieceKey === (current?.pieceKey ?? earlier.pieceKey) && earlier.named;
  if (named || (preferNamed && earlier.named && current == null)) {
    return namedComparison(earlier.nameKo, current?.snap ?? null, earlier.snap);
  }
  if (current && earlier.pieceKey === current.pieceKey && earlier.named) {
    return namedComparison(earlier.nameKo, current.snap, earlier.snap);
  }
  return metconComparison(earlier.format, current?.snap ?? null, earlier.snap);
}

export type HistoryContext = {
  plans: StoredPlan[];
  scores: PlanScore[];
  wods: Comparable[];
  sessions: SessionGroup[];
};

function loadSessions(userId: number): SessionGroup[] {
  const rows = getSqlite()
    .prepare(
      `SELECT sl.completed_at AS completedAt, sl.weight_kg AS weightKg,
              pe.exercise_key AS exerciseKey,
              COALESCE(e.name_ko, pe.exercise_key) AS nameKo,
              p.slug AS slug, p.name_ko AS programNameKo,
              w.week_number AS weekNumber, d.day_number AS dayNumber
       FROM set_logs sl
       JOIN program_sets ps ON ps.id = sl.program_set_id
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug
       LEFT JOIN exercises e ON e.key = pe.exercise_key
       WHERE sl.user_id = ? AND sl.completed = 1
       ORDER BY sl.completed_at DESC`,
    )
    .all(userId) as {
    completedAt: number;
    weightKg: number | null;
    exerciseKey: string;
    nameKo: string;
    slug: string;
    programNameKo: string;
    weekNumber: number;
    dayNumber: number;
  }[];

  const groups = new Map<string, SessionGroup>();
  for (const row of rows) {
    const date = trainingDayKey(row.completedAt);
    const key = `session:${date}:${row.slug}:${row.weekNumber}:${row.dayNumber}`;
    let session = groups.get(key);
    if (!session) {
      session = {
        key,
        at: row.completedAt,
        href: `/session/${row.slug}/${row.weekNumber}/${row.dayNumber}`,
        title: `${row.nameKo} · ${formatKoDate(date)}`,
        programNameKo: row.programNameKo,
        lifts: [],
      };
      groups.set(key, session);
    }
    if (row.completedAt > session.at) session.at = row.completedAt;
    const lift = session.lifts.find((item) => item.exerciseKey === row.exerciseKey);
    if (!lift) session.lifts.push({ exerciseKey: row.exerciseKey, nameKo: row.nameKo, weightKg: row.weightKg });
    else if (row.weightKg != null && (lift.weightKg == null || row.weightKg > lift.weightKg)) lift.weightKg = row.weightKg;
  }
  return [...groups.values()];
}

export function loadHistoryContext(userId: number): HistoryContext {
  const wods = listWodResults(userId, undefined, 200)
    .map(wodComparable)
    .filter((row): row is Comparable => row != null);
  return {
    plans: listPlans(userId),
    scores: listPlanScores(userId),
    wods,
    sessions: loadSessions(userId),
  };
}

function planPool(ctx: HistoryContext): Comparable[] {
  const fromPlans = ctx.scores.map((score) => planComparable(score, formatFromSignature(score.signature))).filter((row): row is Comparable => row != null);
  return [...fromPlans, ...ctx.wods];
}

export function comparesForDay(ctx: HistoryContext, plan: StoredPlan, day: PlannedDay): HistoryCompare[] {
  const compares: HistoryCompare[] = [];
  const piece = day.piece;
  const dayScores = scoresForDay(ctx.scores, plan.id, day.day);
  const latest = dayScores[0] ?? null;
  if (piece?.signature) {
    const current = latest ? planComparable(latest, piece.format) : null;
    const earlier = earlierMatch(planPool(ctx), current, {
      pieceKey: piece.named ? `named:${piece.id}` : `sig:${piece.signature}`,
      signature: piece.signature,
      named: piece.named,
      at: latest?.completedAt ?? null,
    });
    if (earlier) {
      const sameNamed = piece.named && earlier.pieceKey === `named:${piece.id}`;
      compares.push(sameNamed ? namedComparison(piece.nameKo, current?.snap ?? null, earlier.snap) : metconComparison(piece.format, current?.snap ?? null, earlier.snap));
    }
  }
  const top = topSetKg(day.lift);
  if (top != null && day.lift) {
    const earlierPlan = ctx.plans.find((other) => {
      const older = other.createdAt < plan.createdAt || (other.createdAt === plan.createdAt && other.id < plan.id);
      if (!older) return false;
      const otherDay = other.week.days.find((row) => row.lift?.exerciseKey === day.lift?.exerciseKey);
      return topSetKg(otherDay?.lift) != null;
    });
    const earlierDay = earlierPlan?.week.days.find((row) => row.lift?.exerciseKey === day.lift?.exerciseKey);
    const earlierTop = topSetKg(earlierDay?.lift);
    if (earlierTop != null) compares.push(liftComparison(day.lift.nameKo, top, earlierTop));
  }
  return compares;
}

function prescriptionLine(day: PlannedDay): string {
  if (day.rest) return "휴식";
  if (day.lift?.missingOneRm) return "1RM 없음 · 무게 없음";
  if (day.lift) {
    const weights = day.lift.sets.map((set) => (set.weightKg == null ? "—" : `${set.weightKg}kg`));
    return `${day.lift.nameKo} ${weights.join(" / ")}`;
  }
  return day.piece?.nameKo ?? daySummary(day);
}

function sessionCompare(sessions: SessionGroup[], session: SessionGroup): HistoryCompare | null {
  const older = sessions.filter((row) => row.at < session.at).sort((a, b) => b.at - a.at);
  for (const lift of session.lifts) {
    if (lift.weightKg == null) continue;
    for (const prev of older) {
      const match = prev.lifts.find((row) => row.exerciseKey === lift.exerciseKey && row.weightKg != null);
      if (!match || match.weightKg == null) continue;
      return liftComparison(lift.nameKo, lift.weightKg, match.weightKg);
    }
  }
  return null;
}

export function listTrainingHistory(userId: number): HistoryItem[] {
  const ctx = loadHistoryContext(userId);
  const items: HistoryItem[] = [];

  for (const plan of ctx.plans) {
    for (const [index, day] of plan.week.days.entries()) {
      const logged = scoresForDay(ctx.scores, plan.id, day.day);
      const at = logged[0]?.completedAt ?? plan.createdAt + index;
      items.push({
        key: `plan:${plan.id}:${day.day}`,
        at,
        href: planDayHref(plan.id, day.day),
        title: `${plan.weekIndex}주 ${day.labelKo}${day.optional ? " · 선택" : ""}`,
        line: prescriptionLine(day),
        kind: "plan",
        compares: comparesForDay(ctx, plan, day),
        scores: logged.map((score) => ({
          id: `ps-${score.id}`,
          at: score.completedAt,
          label: scoreLabel(snapOf(score)),
          notesKo: score.notesKo,
        })),
      });
    }
  }

  const wodResults = listWodResults(userId, undefined, 200);
  for (const result of wodResults) {
    const current = wodComparable(result);
    const template = getWodTemplate(result.templateSlug);
    const earlier = current
      ? earlierMatch(
          ctx.wods.filter((row) => row.pieceKey === current.pieceKey),
          current,
          { pieceKey: current.pieceKey, signature: "", named: true, at: current.at },
        )
      : null;
    items.push({
      key: `wod:${result.id}`,
      at: result.completedAt,
      href: `/wod/${result.templateSlug}`,
      title: `${template?.nameKo ?? result.templateSlug} · ${formatKoDate(trainingDayKey(result.completedAt))}`,
      line: current ? scoreLabel(current.snap) : result.templateSlug,
      kind: "wod",
      compares: earlier && current ? [compareTo(current, earlier, true)] : [],
      scores: current
        ? [{ id: `wr-${result.id}`, at: result.completedAt, label: scoreLabel(current.snap), notesKo: result.notesKo }]
        : [],
    });
  }

  for (const session of ctx.sessions) {
    const weights = session.lifts
      .filter((lift) => lift.weightKg != null && lift.weightKg > 0)
      .map((lift) => `${lift.nameKo} ${lift.weightKg}kg`);
    const compare = sessionCompare(ctx.sessions, session);
    items.push({
      key: session.key,
      at: session.at,
      href: session.href,
      title: session.title,
      line: weights[0] ? `${weights.join(" · ")} · ${session.programNameKo}` : session.programNameKo,
      kind: "session",
      compares: compare ? [compare] : [],
      scores: [],
    });
  }

  return items.sort((a, b) => b.at - a.at || b.key.localeCompare(a.key)).slice(0, 250);
}

export type HistoryCompareRow = {
  labelKo: "같은 이름" | "같은 구성";
  date: string;
  score: string;
};

export type HistoryCard = {
  key: string;
  at: number;
  date: string;
  href: string;
  badge: "리프트" | "메트콘" | "벤치마크";
  name: string;
  summary: string;
  sets: string[];
  score: string | null;
  rankKo: string | null;
  compares: HistoryCompareRow[];
};

function rankValue(snap: ScoreSnap): { kind: "time" | "rounds"; value: number } | null {
  if (snap.timeSec != null && snap.timeSec >= 0 && scoreLabel(snap) !== "") return { kind: "time", value: snap.timeSec };
  const rounds = snap.rounds ?? 0;
  const reps = snap.extraReps ?? 0;
  if (rounds > 0 || reps > 0) return { kind: "rounds", value: rounds * 1000 + reps };
  return null;
}

function rankLabelFor(pool: Comparable[], current: Comparable): string | null {
  const mine = rankValue(current.snap);
  if (!mine) return null;
  const peers = pool.filter((row) => {
    if (!samePersonalGroup(current, row)) return false;
    const value = rankValue(row.snap);
    return value != null && value.kind === mine.kind;
  });
  return personalRankLabel(
    mine.value,
    peers.map((row) => rankValue(row.snap)!.value),
    mine.kind,
  );
}

function movementSummary(names: string[]): string {
  return names.map((name) => name.trim()).filter(Boolean).join(" · ");
}

function compareRows(
  pool: Comparable[],
  current: { sourceId: string; compareBefore: number; pieceKey: string; signature: string; named: boolean },
): HistoryCompareRow[] {
  const hits = pool.filter((row) => {
    if (row.id === current.sourceId) return false;
    if (row.at >= current.compareBefore) return false;
    if (current.named && current.pieceKey && row.pieceKey === current.pieceKey) return true;
    if (current.signature && row.signature === current.signature) return true;
    return false;
  });
  hits.sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  return hits.map((row) => ({
    labelKo: current.named && current.pieceKey && row.pieceKey === current.pieceKey ? "같은 이름" : "같은 구성",
    date: trainingDayKey(row.at),
    score: scoreLabel(row.snap),
  }));
}

function calendarStamp(date: string, planId: number): number {
  return Date.parse(`${date}T00:00:00.000Z`) + planId;
}

type LoggedSet = {
  completedAt: number;
  weightKg: number | null;
  reps: number;
  amrap: boolean;
  setNumber: number;
  sortOrder: number;
  exerciseKey: string;
  nameKo: string;
  slug: string;
  weekNumber: number;
  dayNumber: number;
};

function loadLoggedSets(userId: number): LoggedSet[] {
  return getSqlite()
    .prepare(
      `SELECT sl.completed_at AS completedAt, sl.weight_kg AS weightKg,
              ps.reps AS reps, ps.amrap AS amrap, ps.set_number AS setNumber,
              pe.sort_order AS sortOrder, pe.exercise_key AS exerciseKey,
              COALESCE(e.name_ko, pe.exercise_key) AS nameKo,
              p.slug AS slug, w.week_number AS weekNumber, d.day_number AS dayNumber
       FROM set_logs sl
       JOIN program_sets ps ON ps.id = sl.program_set_id
       JOIN program_exercises pe ON pe.id = ps.exercise_id
       JOIN program_days d ON d.id = pe.day_id
       JOIN program_weeks w ON w.id = d.week_id
       JOIN programs p ON p.slug = w.program_slug
       LEFT JOIN exercises e ON e.key = pe.exercise_key
       WHERE sl.user_id = ? AND sl.completed = 1
       ORDER BY ps.set_number ASC, sl.id ASC`,
    )
    .all(userId) as LoggedSet[];
}

function sessionLiftCards(userId: number, unit: WeightUnit): HistoryCard[] {
  const groups = new Map<string, LoggedSet[]>();
  for (const row of loadLoggedSets(userId)) {
    const date = trainingDayKey(row.completedAt);
    const key = `session:${date}:${row.slug}:${row.weekNumber}:${row.dayNumber}:${row.exerciseKey}`;
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const cards: HistoryCard[] = [];
  for (const [key, rows] of groups) {
    rows.sort((a, b) => a.setNumber - b.setNumber || a.completedAt - b.completedAt);
    const first = rows[0]!;
    const date = trainingDayKey(Math.min(...rows.map((row) => row.completedAt)));
    cards.push({
      key,
      at: Math.min(...rows.map((row) => row.completedAt)) + first.sortOrder,
      date,
      href: `/session/${first.slug}/${first.weekNumber}/${first.dayNumber}`,
      badge: "리프트",
      name: first.nameKo,
      summary: "",
      sets: formatSetGroups(
        rows.map((row) => ({ reps: row.reps, amrap: Boolean(row.amrap), weightKg: row.weightKg })),
        unit,
      ),
      score: null,
      rankKo: null,
      compares: [],
    });
  }
  return cards;
}

function planCards(ctx: HistoryContext, pool: Comparable[], unit: WeightUnit): HistoryCard[] {
  const cards: HistoryCard[] = [];
  for (const plan of ctx.plans) {
    for (const day of plan.week.days) {
      if (day.rest) continue;
      const date = planCalendarDate(plan.weekStart, day.day as DayKey);
      const href = planDayHref(plan.id, day.day);
      if (day.lift) {
        cards.push({
          key: `plan:${plan.id}:${day.day}:lift`,
          at: calendarStamp(date, plan.id),
          date,
          href,
          badge: "리프트",
          name: day.lift.nameKo,
          summary: "",
          sets: formatSetGroups(day.lift.sets, unit),
          score: null,
          rankKo: null,
          compares: [],
        });
      }
      if (!day.piece?.signature && !day.piece) continue;
      const piece = day.piece;
      if (!piece) continue;
      const summary = movementSummary(piece.movements.map((move) => move.nameKo));
      const badge = piece.named ? "벤치마크" : "메트콘";
      const identity = {
        pieceKey: piece.named ? `named:${piece.id}` : `sig:${piece.signature}`,
        signature: piece.signature,
        named: piece.named,
      };
      const logged = scoresForDay(ctx.scores, plan.id, day.day);
      if (logged.length === 0) {
        cards.push({
          key: `plan:${plan.id}:${day.day}:metcon`,
          at: calendarStamp(date, plan.id) + 1,
          date,
          href,
          badge,
          name: piece.nameKo,
          summary,
          sets: [],
          score: null,
          rankKo: null,
          compares: compareRows(pool, { sourceId: `plan:${plan.id}:${day.day}:metcon`, compareBefore: plan.createdAt, ...identity }),
        });
        continue;
      }
      for (const score of logged) {
        const snap = snapOf(score);
        const current = planComparable(score, piece.format);
        cards.push({
          key: `plan:${plan.id}:${day.day}:score:${score.id}`,
          at: score.completedAt,
          date: trainingDayKey(score.completedAt),
          href,
          badge,
          name: score.pieceNameKo || piece.nameKo,
          summary,
          sets: [],
          score: scoreLabel(snap) || null,
          rankKo: current ? rankLabelFor(pool, current) : null,
          compares: compareRows(pool, {
            sourceId: `ps:${score.id}`,
            compareBefore: score.completedAt,
            pieceKey: score.pieceKey,
            signature: score.signature,
            named: score.named,
          }),
        });
      }
    }
  }
  return cards;
}

function wodCards(userId: number, pool: Comparable[]): HistoryCard[] {
  const cards: HistoryCard[] = [];
  for (const result of listWodResults(userId, undefined, 200)) {
    const template = getWodTemplate(result.templateSlug);
    const current = wodComparable(result);
    const summary = movementSummary((template?.movements ?? []).map((move) => move.nameKo));
    const badge = template && (template.category === "benchmark" || template.family) ? "벤치마크" : "메트콘";
    cards.push({
      key: `wod:${result.id}`,
      at: result.completedAt,
      date: trainingDayKey(result.completedAt),
      href: `/wod/${result.templateSlug}`,
      badge,
      name: template?.nameKo ?? result.templateSlug,
      summary,
      sets: [],
      score: current ? scoreLabel(current.snap) || null : null,
      rankKo: current ? rankLabelFor(pool, current) : null,
      compares: current
        ? compareRows(pool, {
            sourceId: current.id,
            compareBefore: current.at,
            pieceKey: current.pieceKey,
            signature: current.signature,
            named: true,
          })
        : [],
    });
  }
  return cards;
}

/** One card per lift or metcon. Comparisons stay on the metcon card they belong to. */
export function listHistoryCards(userId: number, unit: WeightUnit): HistoryCard[] {
  const ctx = loadHistoryContext(userId);
  const pool = planPool(ctx);
  const cards = [...planCards(ctx, pool, unit), ...wodCards(userId, pool), ...sessionLiftCards(userId, unit)];
  return cards.sort((a, b) => a.date.localeCompare(b.date) || a.at - b.at || a.key.localeCompare(b.key));
}

export function namedWodComparison(userId: number, slug: string): HistoryCompare | null {
  const mine = loadHistoryContext(userId)
    .wods.filter((row) => row.pieceKey === `named:${slug}`)
    .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
  const latest = mine[0];
  const earlier = mine[1];
  if (!latest || !earlier) return null;
  return namedComparison(latest.nameKo, latest.snap, earlier.snap);
}
