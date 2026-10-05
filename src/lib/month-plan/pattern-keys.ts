import type { MetconPattern } from "./types";

/** Same buckets `patternFromKeys` already uses. Order is squat, olympic, hinge, press, engine. */
const SQUAT = new Set(["air_squat", "thruster", "wall_ball", "lunge", "front_squat", "squat", "ohs", "pistol"]);
const OLYMPIC = new Set(["snatch", "clean", "clean_jerk", "power_snatch", "power_clean"]);
const HINGE = new Set(["deadlift", "kb_swing", "swing", "rdl", "clean", "hang_power_clean"]);
const PRESS = new Set(["push_up", "bench", "hspu", "push_press", "shoulder_press", "dip", "ring_dip", "sdhp"]);
const ENGINE = new Set(["run", "row", "bike", "ski", "fan_bike", "double_under"]);

export function patternOfKey(key: string): MetconPattern {
  if (SQUAT.has(key)) return "squat";
  if (OLYMPIC.has(key)) return "olympic";
  if (HINGE.has(key)) return "hinge";
  if (PRESS.has(key)) return "press";
  if (ENGINE.has(key)) return "engine";
  return "gymnastic";
}
