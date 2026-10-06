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

const DAY_KO: Record<string, string> = {
  mon: "월요일",
  tue: "화요일",
  wed: "수요일",
  thu: "목요일",
  fri: "금요일",
  sat: "토요일",
  sun: "일요일",
};

function metconPurpose(session: SessionCore): string {
  const label = DAY_KO[session.day] ?? session.day;
  const conditioning = session.conditioning;
  if (!conditioning) return `${label} 컨디셔닝입니다.`;
  if (conditioning.benchmark) return `${label} 벤치마크를 같은 방법으로 측정합니다.`;
  if (conditioning.long_conditioning) return `${label} 긴 컨디셔닝을 라운드와 시간 캡으로 진행합니다.`;
  if (conditioning.stimulus === "technical") return `${label} 기술을 유지하는 연습입니다.`;
  if (conditioning.stimulus === "heavy") return `${label} 무거운 동작을 적은 횟수로 합니다.`;
  if (conditioning.format === "emom") return `${label} 1분마다 동작을 바꿔 호흡을 맞춥니다.`;
  if (conditioning.format === "intervals") return `${label} 일과 쉼을 나눠 진행합니다.`;
  if (conditioning.format === "for_time") return `${label} 시간 캡 안에 끝내는 반복입니다.`;
  return `${label} 정해진 시간 동안 반복을 이어 갑니다.`;
}

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
  return {
    ...session,
    strength_purpose: lift ? `${LIFT_KO[lift] ?? lift}를 이 달 블록의 세트로 합니다.` : null,
    strength_volume: lift ? (strengthVolume ?? "moderate") : null,
    strength_intensity: lift ? (heavy ? "heavy" : "moderate") : null,
    metcon_purpose: metconPurpose(session),
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
