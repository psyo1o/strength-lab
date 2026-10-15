import { TIME_DOMAIN_RANGES } from "../rules";
import type { TimeDomain } from "../types";

/** Conditioning clock. The class window is a different number and never becomes time_domain. */
export function timeDomainFromMinutes(minutes: number): TimeDomain {
  if (minutes <= TIME_DOMAIN_RANGES.short.max) return "short";
  if (minutes <= TIME_DOMAIN_RANGES.medium.max) return "medium";
  return "long";
}

export function minutesFitDomain(minutes: number, domain: TimeDomain): boolean {
  const range = TIME_DOMAIN_RANGES[domain];
  return minutes >= range.min && minutes <= range.max;
}

/** Piece length that can sit beside a 10 minute warm-up inside a 60 minute class. */
export function conditioningBudget(input: { classMinutes?: number; hasStrength: boolean; longPiece: boolean }): number {
  if (input.longPiece) return 34;
  const minutes = input.classMinutes ?? 60;
  const warmup = 10;
  const strength = input.hasStrength ? 15 : 0;
  return Math.max(8, Math.min(20, minutes - warmup - strength));
}
