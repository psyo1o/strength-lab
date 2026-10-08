import { similarityMatch, similarityScore, toStructure } from "../rules";
import { SIMILARITY_CONFIG, type SessionDraft, type StoredStructure } from "../types";
import { VARIATION_ENGINE_VERSION } from "./prompts";

export type VariationReport = {
  version: typeof VARIATION_ENGINE_VERSION;
  same_week_similarity: number;
  recent_similarity: number;
  stimulus_repetition: number;
  movement_pattern_repetition: number;
  structural_repetition: number;
  progression_justified: boolean;
  note_ko: string;
  hot_days: string[];
};

/**
 * Structural comparison. The same lift name is not repetition by itself.
 * The same format, stimulus, pattern, and volume together is.
 */
export function variationReport(input: {
  sessions: readonly SessionDraft[];
  recent?: readonly StoredStructure[];
  progressingLifts?: readonly string[];
}): VariationReport {
  const current = input.sessions.map(toStructure).filter((row): row is StoredStructure => row != null && !row.benchmark);
  let same = 0;
  const hot = new Set<string>();
  for (let index = 0; index < current.length; index += 1) {
    for (let other = index + 1; other < current.length; other += 1) {
      const score = similarityScore(current[index]!, current[other]!);
      same = Math.max(same, score);
      if (score >= SIMILARITY_CONFIG.threshold) {
        hot.add(current[index]!.day);
        hot.add(current[other]!.day);
      }
    }
  }
  const recent = (input.recent ?? []).filter((row) => !row.benchmark);
  let recentScore = 0;
  for (const row of current) {
    for (const prior of recent) {
      const score = similarityScore(row, prior);
      recentScore = Math.max(recentScore, score);
      if (score >= SIMILARITY_CONFIG.threshold) hot.add(row.day);
    }
  }
  const stimuli = current.map((row) => row.stimulus).filter(Boolean);
  const patterns = current.map((row) => [...row.movement_patterns].sort().join("|"));
  const stimulusRepetition = stimuli.length - new Set(stimuli).size;
  const patternRepetition = patterns.length - new Set(patterns).size;
  const structural = current.filter((row) =>
    recent.some((prior) => similarityMatch(row, prior).score >= SIMILARITY_CONFIG.threshold),
  ).length;
  const progressing = (input.progressingLifts ?? []).length > 0;
  const note = structural
    ? "최근 주와 구조가 겹칩니다. 동작 이름만 바꾼 것은 변이로 보지 않습니다."
    : progressing
      ? "같은 리프트가 이어져도 형식과 자극이 다르면 진행으로 봅니다."
      : "같은 주 안에서는 형식, 자극, 패턴, 장비, 볼륨을 함께 비교합니다.";
  return {
    version: VARIATION_ENGINE_VERSION,
    same_week_similarity: same,
    recent_similarity: recentScore,
    stimulus_repetition: stimulusRepetition,
    movement_pattern_repetition: patternRepetition,
    structural_repetition: structural,
    progression_justified: progressing && structural === 0,
    note_ko: note,
    hot_days: [...hot],
  };
}

export function structuresCollide(left: StoredStructure, right: StoredStructure): boolean {
  if (left.benchmark || right.benchmark) return false;
  return similarityScore(left, right) >= SIMILARITY_CONFIG.threshold;
}
