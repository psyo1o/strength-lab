export type EquipmentPrefs = {
  boxHeightCm: number | null;
  wallBallKg: number | null;
  wallBallTargetM: number | null;
  duRope: string;
};

export const EMPTY_EQUIPMENT: EquipmentPrefs = {
  boxHeightCm: null,
  wallBallKg: null,
  wallBallTargetM: null,
  duRope: "",
};

export const EQUIPMENT_COPY =
  "박스 높이·월볼 무게·타깃·줄넘기는 1RM이 아닙니다. 내 체육관 세팅이에요.";
