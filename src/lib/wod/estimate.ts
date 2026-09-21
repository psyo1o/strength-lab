import type { MaxMap } from "../maxes";
import { formatClock } from "./types";

export const ESTIMATE_LABEL = "예상 · 참고용";
export const MISSING_LABEL = "1RM 부족";

export type WodEstimateKind = "time" | "rounds" | "reps" | "missing";

export type WodEstimate = {
  labelKo: typeof ESTIMATE_LABEL;
  kind: WodEstimateKind;
  valueLabel: string;
  hintKo: string;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pick(maxes: MaxMap, keys: string[]): number | null {
  for (const key of keys) {
    const n = maxes[key];
    if (n != null && n > 0) return n;
  }
  return null;
}

/** Named-lift lookup with light aliases. Derived fallbacks are last-resort. */
function lift(maxes: MaxMap, kind: string): number | null {
  if (kind === "thruster") {
    return pick(maxes, ["thruster"]) ?? scale(pick(maxes, ["front_squat"]), 0.7) ?? scale(pick(maxes, ["squat", "back_squat"]), 0.55);
  }
  if (kind === "clean") {
    return pick(maxes, ["clean", "clean_jerk", "power_clean"]);
  }
  if (kind === "clean_jerk") {
    return pick(maxes, ["clean_jerk"]) ?? scale(pick(maxes, ["clean", "power_clean"]), 0.95);
  }
  if (kind === "snatch") {
    return pick(maxes, ["snatch", "power_snatch"]);
  }
  if (kind === "deadlift") {
    return pick(maxes, ["deadlift"]);
  }
  if (kind === "ohs") {
    return pick(maxes, ["ohs"]) ?? scale(pick(maxes, ["snatch", "power_snatch"]), 0.85) ?? scale(pick(maxes, ["squat", "front_squat"]), 0.5);
  }
  if (kind === "bench") {
    return pick(maxes, ["bench", "bench_press"]);
  }
  if (kind === "wall_ball") {
    return pick(maxes, ["wall_ball"]) ?? scale(pick(maxes, ["thruster"]), 0.35) ?? scale(pick(maxes, ["squat", "front_squat"]), 0.18);
  }
  if (kind === "kb_swing") {
    return pick(maxes, ["kb_swing"]) ?? scale(pick(maxes, ["deadlift"]), 0.22);
  }
  if (kind === "push_press") {
    return pick(maxes, ["push_press", "jerk", "power_jerk"]) ?? scale(pick(maxes, ["ohp"]), 1.1);
  }
  if (kind === "squat") {
    return pick(maxes, ["squat", "back_squat", "front_squat"]);
  }
  return pick(maxes, [kind]);
}

function scale(n: number | null, factor: number): number | null {
  return n != null && n > 0 ? n * factor : null;
}

function bodyweightKg(maxes: MaxMap): number {
  return pick(maxes, ["bodyweight", "bw", "body_weight"]) ?? 80;
}

/**
 * Work-capacity proxy vs rough “intermediate” kg standards.
 * Used for gymnastics/run WODs that have no stored pull-up max.
 */
function fitnessProxy(maxes: MaxMap): number | null {
  const samples: number[] = [];
  const squat = lift(maxes, "squat");
  const dl = lift(maxes, "deadlift");
  const thr = lift(maxes, "thruster");
  const clean = lift(maxes, "clean");
  if (squat) samples.push(squat / 140);
  if (dl) samples.push(dl / 170);
  if (thr) samples.push(thr / 60);
  if (clean) samples.push(clean / 90);
  if (!samples.length) return null;
  return clamp(mean(samples), 0.45, 1.35);
}

function missing(liftsKo: string[]): WodEstimate {
  return {
    labelKo: ESTIMATE_LABEL,
    kind: "missing",
    valueLabel: MISSING_LABEL,
    hintKo: `${liftsKo.join(" · ")} 1RM을 넣으면 예상 점수를 보여 줍니다.`,
  };
}

function timeEst(sec: number, hintKo = "저장된 1RM으로 만든 장난 추정입니다. 기록이 아닙니다."): WodEstimate {
  return {
    labelKo: ESTIMATE_LABEL,
    kind: "time",
    valueLabel: formatClock(Math.round(clamp(sec, 45, 99 * 60))),
    hintKo,
  };
}

function roundsEst(rounds: number, extra = 0): WodEstimate {
  const r = Math.max(0, Math.floor(rounds));
  const x = Math.max(0, Math.floor(extra));
  return {
    labelKo: ESTIMATE_LABEL,
    kind: "rounds",
    valueLabel: x > 0 ? `${r}R + ${x}` : `${r}R`,
    hintKo: "저장된 1RM으로 만든 장난 추정입니다. 기록이 아닙니다.",
  };
}

function repsEst(reps: number): WodEstimate {
  return {
    labelKo: ESTIMATE_LABEL,
    kind: "reps",
    valueLabel: `${Math.round(clamp(reps, 20, 2000))}회`,
    hintKo: "저장된 1RM으로 만든 장난 추정입니다. 기록이 아닙니다.",
  };
}

/**
 * Seconds per barbell rep at Rx.
 * intensity = rx / 1RM. ~50% stays near baseSec; ~80% stretches a lot.
 */
function barbellCycleSec(rxKg: number, oneRmKg: number, baseSec: number): number {
  const i = clamp(rxKg / oneRmKg, 0.28, 0.95);
  return baseSec * (1 + 2.4 * i * i);
}

function restSec(totalReps: number, intensity: number): number {
  const i = clamp(intensity, 0.28, 0.95);
  return (totalReps / 15) * (6 + 40 * i * i);
}

function couplet21(barbellSec: number, gymSec: number, intensity: number): number {
  // 21-15-9 = 45 + 45
  return 45 * barbellSec + 45 * gymSec + restSec(90, intensity);
}

export function estimateWod(slug: string, maxes: MaxMap): WodEstimate | null {
  switch (slug) {
    case "fran": {
      const tm = lift(maxes, "thruster");
      if (!tm) return missing(["스러스터"]);
      const rx = 43;
      const i = rx / tm;
      const pull = 1.05 + i; // no pull-up max; slower when the bar is heavy
      return timeEst(couplet21(barbellCycleSec(rx, tm, 1.45), pull, i));
    }
    case "grace": {
      const rm = lift(maxes, "clean_jerk") ?? lift(maxes, "clean");
      if (!rm) return missing(["클린앤저크"]);
      const rx = 61;
      const i = rx / rm;
      return timeEst(30 * barbellCycleSec(rx, rm, 2.35) + restSec(30, i));
    }
    case "isabel": {
      const rm = lift(maxes, "snatch");
      if (!rm) return missing(["스네치"]);
      const rx = 61;
      const i = rx / rm;
      return timeEst(30 * barbellCycleSec(rx, rm, 2.05) + restSec(30, i));
    }
    case "diane": {
      const rm = lift(maxes, "deadlift");
      if (!rm) return missing(["데드리프트"]);
      const rx = 102;
      const i = rx / rm;
      const hspu = 2.2 + 1.1 * i;
      return timeEst(couplet21(barbellCycleSec(rx, rm, 1.35), hspu, i));
    }
    case "elizabeth": {
      const rm = lift(maxes, "clean");
      if (!rm) return missing(["클린"]);
      const rx = 61;
      const i = rx / rm;
      const dip = 1.8 + i;
      return timeEst(couplet21(barbellCycleSec(rx, rm, 2.1), dip, i));
    }
    case "helen": {
      const swing = lift(maxes, "kb_swing");
      const p = fitnessProxy(maxes);
      if (!swing && !p) return missing(["케틀벨 스윙", "데드리프트"]);
      const rx = 24;
      const rm = swing ?? 40;
      const i = rx / rm;
      const run400 = 125 / (p ?? 0.85);
      const round = run400 + 21 * barbellCycleSec(rx, rm, 1.05) + 12 * (1.15 + i);
      return timeEst(3 * round + 25);
    }
    case "cindy": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const round = 5 * (1.5 / p) + 10 * (1.0 / p) + 15 * (0.75 / p) + 8;
      const total = 1200 / round;
      const r = Math.floor(total);
      return roundsEst(r, Math.round((total - r) * 30));
    }
    case "murph": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const run = 2 * (420 / p);
      const body = (100 * 1.6 + 200 * 1.05 + 300 * 0.8) / p;
      return timeEst(run + body + 180);
    }
    case "annie": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      // 150 DU + 150 sit-ups
      return timeEst((150 * (0.55 / p) + 150 * (1.15 / p) + 70) );
    }
    case "kelly": {
      const wb = lift(maxes, "wall_ball");
      const p = fitnessProxy(maxes);
      if (!wb && !p) return missing(["월볼", "스쿼트"]);
      const rx = 9;
      const rm = wb ?? 12;
      const i = rx / Math.max(rm, 8);
      const run = 125 / (p ?? 0.85);
      const round = run + 30 * (1.3 / (p ?? 0.85)) + 30 * barbellCycleSec(rx, rm, 1.5);
      return timeEst(5 * round + restSec(300, i) * 0.25);
    }
    case "nancy": {
      const rm = lift(maxes, "ohs");
      const p = fitnessProxy(maxes);
      if (!rm) return missing(["오버헤드스쿼트"]);
      const rx = 43;
      const i = rx / rm;
      const run = 125 / (p ?? 0.85);
      return timeEst(5 * (run + 15 * barbellCycleSec(rx, rm, 1.8)) + restSec(75, i) * 0.3);
    }
    case "karen": {
      const rm = lift(maxes, "wall_ball");
      if (!rm) return missing(["월볼"]);
      const rx = 9;
      const i = rx / Math.max(rm, 8);
      return timeEst(150 * barbellCycleSec(rx, rm, 1.55) + restSec(150, i));
    }
    case "jackie": {
      const tm = lift(maxes, "thruster");
      if (!tm) return missing(["스러스터"]);
      const rx = 20;
      const i = rx / tm;
      const row = 210 / (fitnessProxy(maxes) ?? 0.9);
      return timeEst(row + 50 * barbellCycleSec(rx, tm, 1.2) + 30 * (1.1 + 0.4 * i) + 20);
    }
    case "angie": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      return timeEst((100 * 1.55 + 100 * 1.05 + 100 * 1.2 + 100 * 0.8) / p + 90);
    }
    case "barbara": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const work = 5 * ((20 * 1.5 + 30 * 1.0 + 40 * 1.15 + 50 * 0.75) / p);
      return timeEst(work + 4 * 180);
    }
    case "chelsea": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const minuteWork = (5 * 1.45 + 10 * 0.95 + 15 * 0.75) / p;
      const done = clamp(Math.round(30 * clamp(50 / Math.max(minuteWork, 20), 0.55, 1)), 12, 30);
      return roundsEst(done);
    }
    case "dt": {
      const rm = lift(maxes, "deadlift");
      if (!rm) return missing(["데드리프트"]);
      const rx = 70;
      const i = rx / rm;
      const hang = barbellCycleSec(rx, lift(maxes, "clean") ?? rm * 0.7, 1.7);
      const jerk = barbellCycleSec(rx, lift(maxes, "clean_jerk") ?? lift(maxes, "push_press") ?? rm * 0.55, 1.9);
      const round = 12 * barbellCycleSec(rx, rm, 1.25) + 9 * hang + 6 * jerk;
      return timeEst(5 * round + restSec(135, i) * 0.5);
    }
    case "fight-gone-bad": {
      const p = fitnessProxy(maxes);
      const wb = lift(maxes, "wall_ball");
      const pp = lift(maxes, "push_press");
      if (!p && !wb && !pp) return missing(["월볼", "푸쉬프레스", "스쿼트"]);
      const pace = 14 * (p ?? 0.85) + (wb ? clamp(wb / 12, 0.7, 1.2) : 1) + (pp ? clamp(pp / 50, 0.7, 1.2) : 1);
      // 3 rounds × 5 stations × ~1 min. Playful total-rep guess.
      return repsEst(3 * 5 * clamp(pace, 8, 22));
    }
    case "linda": {
      const bw = bodyweightKg(maxes);
      const dl = lift(maxes, "deadlift");
      const bench = lift(maxes, "bench");
      const clean = lift(maxes, "clean");
      const lack: string[] = [];
      if (!dl) lack.push("데드리프트");
      if (!bench) lack.push("벤치프레스");
      if (!clean) lack.push("클린");
      if (lack.length) return missing(lack);
      const i = mean([1.5 * bw / dl!, 1.0 * bw / bench!, 0.75 * bw / clean!]);
      // 55 reps each of three lifts (10+...+1)
      return timeEst(55 * (barbellCycleSec(1.5 * bw, dl!, 1.4) + barbellCycleSec(bw, bench!, 1.5) + barbellCycleSec(0.75 * bw, clean!, 2.0)) + restSec(165, i));
    }
    case "mary": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const round = 5 * (3.2 / p) + 10 * (2.4 / p) + 15 * (1.4 / p) + 10;
      const total = 1200 / round;
      const r = Math.floor(total);
      return roundsEst(r, Math.round((total - r) * 30));
    }
    case "nicole": {
      const p = fitnessProxy(maxes);
      if (!p) return missing(["스쿼트", "데드리프트"]);
      const run = 125 / p;
      const pullBlock = 18 * (1.4 / p);
      const round = run + pullBlock + 8;
      const total = 1200 / round;
      const r = Math.floor(total);
      return roundsEst(r, Math.round((total - r) * 20));
    }
    default:
      return null;
  }
}
