export type P1Phase = { id: string; label: string; weekStart: number };

export type P1Meta = {
  extraOneRmFields?: { key: string; label: string }[];
  phases?: P1Phase[];
  classes?: P1Phase[];
  unavailableWeeks?: number[];
  listedBlocks?: string[];
};

export const P1_META: Record<string, P1Meta> = {
  "daily-undulating": {
    extraOneRmFields: [
      { key: "front_squat", label: "프론트 스쿼트" },
      { key: "power_clean", label: "파워클린" },
    ],
    phases: [
      { id: "hypertrophy", label: "비대", weekStart: 1 },
      { id: "strength", label: "근력", weekStart: 5 },
      { id: "peaking", label: "피킹", weekStart: 9 },
    ],
    listedBlocks: ["3 메소사이클 × 4주 (비대 / 근력 / 피킹)", "각 4주차는 회복"],
  },
  "bob-takano": {
    classes: [
      { id: "III", label: "Class III", weekStart: 1 },
      { id: "II", label: "Class II", weekStart: 5 },
      { id: "I", label: "Class I", weekStart: 9 },
    ],
    listedBlocks: ["시드된 Class 샘플 주만. 공식·유료 12주 사이클 아님."],
  },
  rehab: {
    extraOneRmFields: [{ key: "rehab_target", label: "재활 목표 동작" }],
  },
  juggernaut: {
    phases: [
      { id: "10s", label: "10s", weekStart: 1 },
      { id: "8s", label: "8s", weekStart: 5 },
      { id: "5s", label: "5s", weekStart: 9 },
      { id: "3s", label: "3s", weekStart: 13 },
    ],
    listedBlocks: ["W1–16 Acc/Int/Real/Deload (월/수/금/토)", "피킹 블록 — W16 이후 시트/코치 5주. realizationMaxHook만 자동."],
  },
  cowboy: {
    extraOneRmFields: [{ key: "front_squat", label: "프론트 스쿼트" }],
    listedBlocks: [
      "W1–13 월 백스쿼트 볼륨 / 수 프론트 / 금 가이드 RM",
      "화·목·토 휴식",
      "W4·W8·W12 딜로드, W13 1RM 테스트",
    ],
  },
  lbeb: {
    listedBlocks: ["W1–6만 로드", "W7–12 잠금 (excel-w1-6-only). 공개 % 그리드 없음"],
    unavailableWeeks: [7, 8, 9, 10, 11, 12],
  },
  catalyst: {
    listedBlocks: ["시드된 샘플 주만. 공식 12주 기본+스페셜티 블록 아님."],
  },
};

export const P1_PROGRAM_IDS = [
  "daily-undulating",
  "juggernaut",
  "cowboy",
  "rehab",
  "bob-takano",
  "catalyst",
  "torokhtiy",
  "lbeb",
] as const;
