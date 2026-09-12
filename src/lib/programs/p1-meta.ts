export type P1Phase = { id: string; label: string; weekStart: number };

export type P1Meta = {
  extraOneRmFields?: { key: string; label: string }[];
  phases?: P1Phase[];
  classes?: P1Phase[];
  unavailableWeeks?: number[];
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
  },
  "bob-takano": {
    classes: [
      { id: "III", label: "Class III", weekStart: 1 },
      { id: "II", label: "Class II", weekStart: 5 },
      { id: "I", label: "Class I", weekStart: 9 },
    ],
  },
  rehab: {
    extraOneRmFields: [{ key: "rehab_target", label: "재활 목표 종목" }],
  },
  lbeb: {
    unavailableWeeks: [7, 8, 9, 10, 11, 12],
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
