import type { SessionDraft, VolumeBand } from "./types";

export type SessionCore = Omit<
  SessionDraft,
  | "strength_purpose"
  | "strength_volume"
  | "strength_intensity"
  | "metcon_purpose"
  | "metcon_format"
  | "time_domain"
  | "stimulus"
  | "movement_combination"
  | "equipment"
  | "volume"
  | "intensity"
  | "expected_duration"
>;

const LIFT_KO: Record<string, string> = {
  squat: "스쿼트",
  ohp: "프레스",
  bench: "벤치",
  deadlift: "데드리프트",
};

export function fillSessionFields(
  session: SessionCore,
  strengthVolume?: VolumeBand | null,
): SessionDraft {
  if (session.rest || !session.conditioning) {
    return {
      ...session,
      strength_purpose: null,
      strength_volume: null,
      strength_intensity: null,
      metcon_purpose: null,
      metcon_format: null,
      time_domain: null,
      stimulus: null,
      movement_combination: null,
      equipment: [],
      volume: null,
      intensity: null,
      expected_duration: null,
    };
  }
  const conditioning = session.conditioning;
  const lift = session.strength?.lift;
  const heavy = session.strength?.sets.some((set) => set.percent_of_tm >= 85) ?? false;
  const purpose = conditioning.benchmark
    ? "이번 달 벤치마크를 같은 방법으로 측정합니다."
    : conditioning.long_conditioning
      ? "이번 주 긴 컨디셔닝입니다."
      : "클래스 메트콘입니다.";
  return {
    ...session,
    strength_purpose: lift ? `${LIFT_KO[lift] ?? lift}를 이 달 블록의 세트로 합니다.` : null,
    strength_volume: lift ? (strengthVolume ?? "moderate") : null,
    strength_intensity: lift ? (heavy ? "heavy" : "moderate") : null,
    metcon_purpose: purpose,
    metcon_format: conditioning.format,
    time_domain: conditioning.time_domain,
    stimulus: conditioning.stimulus,
    movement_combination: [...conditioning.movements.map((movement) => movement.key)].sort().join("+"),
    equipment: [...conditioning.equipment],
    volume: conditioning.volume,
    intensity: conditioning.intensity,
    expected_duration: conditioning.duration_min,
  };
}

export function refreshSessionFields(sessions: SessionDraft[]): SessionDraft[] {
  return sessions.map((session) =>
    fillSessionFields(session, session.strength ? session.strength_volume : null),
  );
}
