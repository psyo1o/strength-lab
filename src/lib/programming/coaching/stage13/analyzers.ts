import { DAY_ORDER, type DayKey } from "../../../month-plan/types";
import { similarityMatch, TIME_DOMAIN_RANGES, toStructure } from "../../rules";
import type { SessionDraft, Stimulus, StoredStructure, WeeklyIntentPlan } from "../../types";
import { COACHING_POLICY, type RepetitionIntent } from "./policy";
import { parsedAmount } from "./units";

export type Band = "LOW" | "MEDIUM" | "HIGH";

function bandFromScore(score: number): Band {
  if (score >= COACHING_POLICY.similarity_threshold) return "HIGH";
  if (score >= 2) return "MEDIUM";
  return "LOW";
}

function patternOf(key: string): string {
  if (["thruster", "air_squat", "front_squat", "squat", "lunge", "wall_ball", "box_jump", "pistol"].includes(key)) return "squat";
  if (["deadlift", "kb_swing", "kettlebell"].includes(key)) return "hinge";
  if (["clean", "snatch", "power_clean", "power_snatch", "hang_power_clean"].includes(key)) return "olympic";
  if (["pull_up", "kipping_pull_up", "ring_row", "toes_to_bar"].includes(key)) return "vertical_pull";
  if (["push_up", "db_press", "dip", "ring_dip"].includes(key)) return "horizontal_push";
  if (["row", "ski", "fan_bike", "bike", "double_under", "run"].includes(key)) return "cyclic";
  if (["handstand", "hspu", "muscle_up", "burpee", "sit_up"].includes(key)) return "gymnastics";
  return "mixed";
}

export function analyzeMovementHistory(input: {
  sessions: readonly SessionDraft[];
  recent: readonly StoredStructure[];
}): Array<{ key: string; recent: number; this_week: number }> {
  const counts = new Map<string, { recent: number; this_week: number }>();
  const bump = (key: string, field: "recent" | "this_week") => {
    const row = counts.get(key) ?? { recent: 0, this_week: 0 };
    row[field] += 1;
    counts.set(key, row);
  };
  for (const prior of input.recent) {
    for (const movement of prior.movements) bump(movement.key, "recent");
  }
  for (const session of input.sessions) {
    for (const movement of session.conditioning?.movements ?? []) bump(movement.key, "this_week");
  }
  return [...counts.entries()].map(([key, row]) => ({ key, ...row }));
}

export function analyzeMovementPatterns(input: {
  sessions: readonly SessionDraft[];
  recent: readonly StoredStructure[];
}): Array<{ pattern: string; recent: number; this_week: number }> {
  const counts = new Map<string, { recent: number; this_week: number }>();
  const bump = (pattern: string, field: "recent" | "this_week") => {
    const row = counts.get(pattern) ?? { recent: 0, this_week: 0 };
    row[field] += 1;
    counts.set(pattern, row);
  };
  for (const prior of input.recent) {
    for (const movement of prior.movements) bump(patternOf(movement.key), "recent");
  }
  for (const session of input.sessions) {
    for (const movement of session.conditioning?.movements ?? []) bump(patternOf(movement.key), "this_week");
  }
  return [...counts.entries()].map(([pattern, row]) => ({ pattern, ...row }));
}

export type StructureHit = {
  day: string;
  compared_day: string;
  scope: "same_week" | "recent";
  score: number;
  threshold: number;
  matched: string[];
  reason: string;
};

export function analyzeStructureSimilarity(input: {
  sessions: readonly SessionDraft[];
  recent: readonly StoredStructure[];
}): StructureHit[] {
  const current = input.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const hits: StructureHit[] = [];
  const push = (left: StoredStructure, right: StoredStructure, scope: StructureHit["scope"]) => {
    const match = similarityMatch(left, right);
    if (match.score <= 0) return;
    hits.push({
      day: left.day,
      compared_day: right.day,
      scope,
      score: match.score,
      threshold: COACHING_POLICY.similarity_threshold,
      matched: match.matched,
      reason: match.matched.join(", ") || "no shared feature",
    });
  };
  for (let index = 0; index < current.length; index += 1) {
    for (let other = index + 1; other < current.length; other += 1) push(current[index]!, current[other]!, "same_week");
    for (const prior of input.recent) push(current[index]!, prior, "recent");
  }
  return hits;
}

export function analyzeStimulus(sessions: readonly SessionDraft[], recent: readonly StoredStructure[]) {
  const current = sessions.map((session) => session.conditioning?.stimulus).filter((row): row is Stimulus => row != null);
  const prior = recent.map((row) => row.stimulus).filter((row): row is Stimulus => row != null);
  return {
    this_week: current,
    recent: prior,
    repeated_in_week: current.filter((item, index) => current.indexOf(item) !== index),
  };
}

export function timeDomainOf(minutes: number): string {
  if (minutes < 5) return "<5";
  if (minutes <= 10) return "5-10";
  if (minutes <= TIME_DOMAIN_RANGES.short.max) return "10-12";
  if (minutes < TIME_DOMAIN_RANGES.long.min) return "13-29";
  if (minutes <= TIME_DOMAIN_RANGES.long.max) return "30-40";
  return "40+";
}

export function analyzeTimeDomain(sessions: readonly SessionDraft[], recent: readonly StoredStructure[]) {
  const current = sessions
    .filter((session) => session.conditioning)
    .map((session) => ({ day: session.day, domain: timeDomainOf(session.conditioning?.duration_min ?? 0) }));
  const prior = recent.map((row) => timeDomainOf(row.duration_min));
  return { this_week: current, recent: prior };
}

export function analyzeVolume(sessions: readonly SessionDraft[]) {
  return sessions
    .filter((session) => !session.rest && session.conditioning)
    .map((session) => {
      let reps = 0;
      let calories = 0;
      let distance = 0;
      const byPattern: Record<string, number> = {};
      for (const movement of session.conditioning?.movements ?? []) {
        const parsed = parsedAmount(movement.amount);
        const pattern = patternOf(movement.key);
        if (parsed.unit === "cal") calories += parsed.value;
        else if (parsed.unit === "m") distance += parsed.value;
        else reps += parsed.value;
        byPattern[pattern] = (byPattern[pattern] ?? 0) + parsed.value;
      }
      const minutes = session.conditioning?.duration_min ?? 0;
      return {
        day: session.day,
        sets: session.strength?.sets.length ?? 0,
        reps,
        calories,
        distance_m: distance,
        duration_min: minutes,
        density_per_min: minutes > 0 ? Math.round((reps + calories) / minutes) : 0,
        pattern_volume: byPattern,
      };
    });
}

export function analyzeIntensity(sessions: readonly SessionDraft[], recent: readonly StoredStructure[]) {
  const current = sessions
    .filter((session) => session.conditioning)
    .map((session) => ({
      day: session.day,
      intensity: session.conditioning?.intensity ?? null,
      volume: session.conditioning?.volume ?? null,
    }));
  const prior = recent.map((row) => row.intensity);
  return { this_week: current, recent: prior };
}

export type ProgressionLabel = "INTENTIONAL_PROGRESSION" | "ACCIDENTAL_REPETITION" | "DISTINCT";

export function analyzeProgression(input: { sessions: readonly SessionDraft[]; plan?: WeeklyIntentPlan | null }): Array<{
  day: string;
  label: ProgressionLabel;
  repetition_intent: RepetitionIntent;
  reason: string;
}> {
  const structures = input.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const labels = new Map<string, { label: ProgressionLabel; repetition_intent: RepetitionIntent; reason: string }>();
  for (const session of input.sessions) {
    if (!session.rest) {
      const intent = input.plan?.days.find((day) => day.day === session.day);
      const repetition_intent: RepetitionIntent = session.conditioning?.benchmark
        ? "benchmark"
        : intent?.progression_required
          ? "progression"
          : intent?.primary_training === "gymnastics_skill"
            ? "skill_practice"
            : "none";
      labels.set(session.day, { label: "DISTINCT", repetition_intent, reason: "no matching comparison" });
    }
  }
  for (let index = 0; index < structures.length; index += 1) {
    for (let other = index + 1; other < structures.length; other += 1) {
      const left = structures[index]!;
      const right = structures[other]!;
      const leftSession = input.sessions.find((session) => session.day === left.day);
      const rightSession = input.sessions.find((session) => session.day === right.day);
      const sameLift = Boolean(leftSession?.strength?.lift && leftSession.strength.lift === rightSession?.strength?.lift);
      const leftSets = JSON.stringify(leftSession?.strength?.sets ?? []);
      const rightSets = JSON.stringify(rightSession?.strength?.sets ?? []);
      const score = similarityMatch(left, right).score;
      const sameMoves =
        left.movements.map((movement) => movement.key).sort().join("|") ===
        right.movements.map((movement) => movement.key).sort().join("|");
      const progressing = input.plan?.days.some(
        (day) => (day.day === left.day || day.day === right.day) && day.progression_required && day.strength_lift === leftSession?.strength?.lift,
      );
      if (sameLift && leftSets !== rightSets) {
        const row = { label: "INTENTIONAL_PROGRESSION" as const, repetition_intent: "progression" as const, reason: "same lift, different loading" };
        labels.set(left.day, row);
        labels.set(right.day, row);
        continue;
      }
      if (sameLift && progressing && score < COACHING_POLICY.similarity_threshold) {
        const row = {
          label: "INTENTIONAL_PROGRESSION" as const,
          repetition_intent: "method_requirement" as const,
          reason: "progression required and the structure changed",
        };
        labels.set(left.day, row);
        labels.set(right.day, row);
        continue;
      }
      if (sameMoves && score >= COACHING_POLICY.similarity_threshold && left.intensity === right.intensity && !progressing) {
        const leftIntent = labels.get(left.day)?.repetition_intent ?? "none";
        const rightIntent = labels.get(right.day)?.repetition_intent ?? "none";
        if (leftIntent !== "none" || rightIntent !== "none") continue;
        const row = {
          label: "ACCIDENTAL_REPETITION" as const,
          repetition_intent: "none" as const,
          reason: "same movements, structure, and intensity without a progression reason",
        };
        labels.set(left.day, row);
        labels.set(right.day, row);
      }
    }
  }
  return [...labels.entries()].map(([day, row]) => ({ day, ...row }));
}

export type InteractionRow = {
  dimension: "movement" | "pattern" | "stimulus" | "structure" | "intensity" | "volume" | "recovery" | "time_domain";
  level: Band;
  days: string[];
  detail: string;
};

export function analyzeWeekInteraction(sessions: readonly SessionDraft[]): InteractionRow[] {
  const structures = sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  const rows: InteractionRow[] = [];
  const pair = (dimension: InteractionRow["dimension"], level: Band, days: string[], detail: string) => {
    rows.push({ dimension, level, days, detail });
  };
  let structureHigh: string[] = [];
  let structureScore = 0;
  for (let index = 0; index < structures.length; index += 1) {
    for (let other = index + 1; other < structures.length; other += 1) {
      const match = similarityMatch(structures[index]!, structures[other]!);
      if (match.score > structureScore) {
        structureScore = match.score;
        structureHigh = [structures[index]!.day, structures[other]!.day];
      }
    }
  }
  pair("structure", bandFromScore(structureScore), structureHigh, `same-week structure score ${structureScore}`);
  const stimuli = new Map<string, string[]>();
  for (const row of structures) {
    if (!row.stimulus) continue;
    const days = stimuli.get(row.stimulus) ?? [];
    days.push(row.day);
    stimuli.set(row.stimulus, days);
  }
  const stimulusRepeat = [...stimuli.values()].filter((days) => days.length > 1);
  pair(
    "stimulus",
    stimulusRepeat.some((days) => days.length >= 3) ? "HIGH" : stimulusRepeat.length ? "MEDIUM" : "LOW",
    stimulusRepeat[0] ?? [],
    stimulusRepeat.length ? "stimulus repeats inside the week" : "stimuli differ",
  );
  const domains = new Map<string, string[]>();
  for (const row of structures) {
    const domain = timeDomainOf(row.duration_min);
    const days = domains.get(domain) ?? [];
    days.push(row.day);
    domains.set(domain, days);
  }
  const domainRepeat = [...domains.values()].filter((days) => days.length > 2);
  pair("time_domain", domainRepeat.length ? "MEDIUM" : "LOW", domainRepeat[0] ?? [], "time domain spread");
  const intensities = structures.filter((row) => row.intensity === "heavy").map((row) => row.day);
  pair("intensity", intensities.length >= 3 ? "HIGH" : intensities.length === 2 ? "MEDIUM" : "LOW", intensities, "heavy conditioning days");
  const volumes = structures.filter((row) => row.volume === "high").map((row) => row.day);
  pair("volume", volumes.length >= 3 ? "HIGH" : volumes.length === 2 ? "MEDIUM" : "LOW", volumes, "high volume days");
  const moveCounts = new Map<string, string[]>();
  for (const row of structures) {
    for (const movement of row.movements) {
      const days = moveCounts.get(movement.key) ?? [];
      days.push(row.day);
      moveCounts.set(movement.key, days);
    }
  }
  const repeatedMove = [...moveCounts.entries()].filter(([, days]) => days.length > 1);
  pair(
    "movement",
    repeatedMove.some(([, days]) => days.length >= 3) ? "HIGH" : repeatedMove.length ? "MEDIUM" : "LOW",
    repeatedMove[0]?.[1] ?? [],
    repeatedMove.length ? `${repeatedMove[0]?.[0]} repeats` : "movement names differ",
  );
  const patternCounts = new Map<string, string[]>();
  for (const row of structures) {
    for (const movement of row.movements) {
      const pattern = patternOf(movement.key);
      const days = patternCounts.get(pattern) ?? [];
      days.push(row.day);
      patternCounts.set(pattern, days);
    }
  }
  const repeatedPattern = [...patternCounts.entries()].filter(([, days]) => new Set(days).size > 2);
  pair(
    "pattern",
    repeatedPattern.length ? "MEDIUM" : "LOW",
    repeatedPattern[0]?.[1] ?? [],
    repeatedPattern.length ? `${repeatedPattern[0]?.[0]} pattern clusters` : "patterns are spread",
  );
  pair("recovery", "LOW", [], "recovery spacing is scored by the recovery analyzer");
  return rows;
}

export function analyzeRecentVariation(input: {
  sessions: readonly SessionDraft[];
  recent: readonly StoredStructure[];
}): Array<{ dimension: string; level: Band }> {
  const current = input.sessions.map(toStructure).filter((row): row is StoredStructure => row != null);
  if (current.length === 0 || input.recent.length === 0) {
    return ["movement", "pattern", "structure", "stimulus", "time_domain", "volume", "intensity", "density", "equipment", "session_role"].map(
      (dimension) => ({ dimension, level: "LOW" as const }),
    );
  }
  let structure = 0;
  let movement = 0;
  let stimulus = 0;
  let domain = 0;
  let volume = 0;
  let intensity = 0;
  let equipment = 0;
  for (const row of current) {
    for (const prior of input.recent) {
      structure = Math.max(structure, similarityMatch(row, prior).score);
      const shared = row.movements.filter((movement) => prior.movements.some((item) => item.key === movement.key)).length;
      movement = Math.max(movement, shared);
      if (row.stimulus && row.stimulus === prior.stimulus) stimulus = Math.max(stimulus, 2);
      if (timeDomainOf(row.duration_min) === timeDomainOf(prior.duration_min)) domain = Math.max(domain, 2);
      if (row.volume === prior.volume) volume = Math.max(volume, 2);
      if (row.intensity === prior.intensity) intensity = Math.max(intensity, 2);
      if ([...row.equipment].sort().join("|") === [...prior.equipment].sort().join("|")) equipment = Math.max(equipment, 2);
    }
  }
  const level = (score: number, highAt: number): Band => (score >= highAt ? "HIGH" : score >= 2 ? "MEDIUM" : "LOW");
  return [
    { dimension: "movement", level: level(movement, 2) },
    { dimension: "pattern", level: level(movement, 2) },
    { dimension: "structure", level: bandFromScore(structure) },
    { dimension: "stimulus", level: level(stimulus, 4) },
    { dimension: "time_domain", level: level(domain, 4) },
    { dimension: "volume", level: level(volume, 4) },
    { dimension: "intensity", level: level(intensity, 4) },
    { dimension: "density", level: "LOW" },
    { dimension: "equipment", level: level(equipment, 4) },
    { dimension: "session_role", level: "LOW" },
  ];
}

export type RecoveryStatus = "SAFE" | "CONCERN" | "HIGH_RISK";

export function analyzeRecovery(sessions: readonly SessionDraft[]): { status: RecoveryStatus; reasons: string[] } {
  const reasons: string[] = [];
  const byDay = new Map(sessions.map((session) => [session.day, session]));
  for (let index = 0; index < DAY_ORDER.length - 1; index += 1) {
    const today = byDay.get(DAY_ORDER[index]!);
    const next = byDay.get(DAY_ORDER[index + 1]!);
    if (!today || !next || today.rest || next.rest) continue;
    const todayLower = today.strength?.lift === "squat" || today.strength?.lift === "deadlift";
    const nextLower = next.strength?.lift === "squat" || next.strength?.lift === "deadlift";
    const todayHeavy = today.conditioning?.intensity === "heavy" || today.strength_intensity === "heavy";
    const nextHeavy = next.conditioning?.intensity === "heavy" || next.strength_intensity === "heavy";
    if (todayLower && nextLower && (todayHeavy || nextHeavy)) {
      reasons.push(`${today.day} and ${next.day} stack lower-body stress`);
    }
    if ((today.conditioning?.intensity === "heavy" || todayLower) && next.conditioning?.long_conditioning) {
      reasons.push(`${next.day} long conditioning follows ${today.day}`);
    }
  }
  const heavyRun = sessions.filter((session) => !session.rest && session.conditioning?.intensity === "heavy").length;
  if (heavyRun >= 3) reasons.push("three or more heavy conditioning days");
  const status: RecoveryStatus = reasons.some((reason) => reason.includes("stack lower-body")) ? "HIGH_RISK" : reasons.length ? "CONCERN" : "SAFE";
  return { status, reasons };
}

export type StructureReview = "STRUCTURE_GOOD" | "STRUCTURE_CONCERN";

export function analyzeWeekStructure(plan: WeeklyIntentPlan): { status: StructureReview; reasons: string[] } {
  const reasons: string[] = [];
  const training = plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest");
  for (let index = 0; index < training.length - 1; index += 1) {
    const left = training[index]!;
    const right = training[index + 1]!;
    const leftIndex = DAY_ORDER.indexOf(left.day);
    const rightIndex = DAY_ORDER.indexOf(right.day);
    if (rightIndex !== leftIndex + 1) continue;
    if (left.intensity_profile === "heavy" && right.intensity_profile === "heavy") {
      reasons.push(`${left.day} and ${right.day} are consecutive heavy days`);
    }
    const lower = (day: WeeklyIntentPlan["days"][number]) =>
      day.strength_lift === "squat" || day.strength_lift === "deadlift" || day.movement_pattern === "squat" || day.movement_pattern === "hinge";
    if (lower(left) && lower(right)) reasons.push(`${left.day} and ${right.day} concentrate lower body`);
  }
  return { status: reasons.length ? "STRUCTURE_CONCERN" : "STRUCTURE_GOOD", reasons };
}

export function trainingDayKeys(plan: WeeklyIntentPlan): DayKey[] {
  return plan.days.filter((day) => day.primary_training !== "rest" && day.recovery_role !== "rest").map((day) => day.day);
}
