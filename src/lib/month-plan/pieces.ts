import type { AthleteSex } from "../auth";
import { runDistanceLabel } from "./distance";
import { pieceSignature } from "./signature";
import {
  isMetconStimulus,
  type DayKey,
  type MetconPattern,
  type MetconPiece,
  type MetconRequest,
  type MetconStimulus,
  type PieceFormat,
  type PieceMovement,
  type WeekIndex,
} from "./types";

type Move = PieceMovement;

type Catalog = {
  id: string;
  nameKo: string;
  named: boolean;
  format: PieceFormat;
  minutes: number;
  pattern: MetconPattern;
  stimulus: MetconStimulus | null;
  days: DayKey[];
  weeks?: WeekIndex[];
  long: boolean;
  noteKo?: string;
  movements: (sex: AthleteSex) => Move[];
};

const FORBID_KEYS: Record<MetconRequest["forbid"][number], string[]> = {
  squat: ["squat", "air_squat", "front_squat", "wall_ball", "thruster", "lunge"],
  swing: ["kb_swing"],
  clean: ["clean", "power_clean", "hang_power_clean"],
  snatch: ["snatch", "power_snatch"],
  deadlift: ["deadlift"],
};

function move(key: string, amount: string, nameKo: string): Move {
  return { key, amount, nameKo };
}

function box(sex: AthleteSex): Move | null {
  if (sex === "m") return move("box_jump", "60cm", "박스 점프");
  if (sex === "f") return move("box_jump", "50cm", "박스 점프");
  return null;
}

function wallBall(sex: AthleteSex, reps: string): Move {
  if (sex === "m") return move("wall_ball", `9kgx${reps}`, "월볼");
  if (sex === "f") return move("wall_ball", `6kgx${reps}`, "월볼");
  return move("wall_ball", reps, "월볼");
}

function displayMove(m: Move): string {
  if (m.key === "run") {
    const [base, ...rest] = m.amount.split(" ");
    const label = runDistanceLabel(base ?? m.amount) ?? m.amount;
    const tail = rest.length ? ` ${rest.join(" ").replace(/x/g, "×")}` : "";
    return `런 ${label}${tail}`;
  }
  if (m.key === "fan_bike") return `팬바이크 ${m.amount.replace(/cal$/, "칼로리")}`;
  if (m.key === "ski" || m.key === "row") return `${m.nameKo} ${m.amount}`;
  if (m.key === "box_jump") return `${m.nameKo} ${m.amount}`;
  if (m.key === "wall_ball" || m.key === "kb_swing") {
    const pretty = m.amount.replace(/x/g, " × ");
    if (!m.amount.includes("kg")) return `${m.nameKo} ${pretty}회`;
    return `${m.nameKo} ${pretty}`;
  }
  if (m.amount.includes("x")) return `${m.nameKo} ${m.amount.replace(/x/g, " × ")}`;
  return `${m.nameKo} ${m.amount}회`;
}

export function renderPiece(input: {
  format: PieceFormat;
  minutes: number;
  movements: Move[];
  noteKo?: string;
  long?: boolean;
}): string {
  const head =
    input.long
      ? `${input.minutes}분 · 이 순서를 반복`
      : input.format === "amrap"
        ? `${input.minutes}분 AMRAP`
        : input.format === "emom"
          ? `${input.minutes}분 EMOM`
          : input.format === "intervals"
            ? `${input.minutes}분 인터벌 · 라운드 사이 1분`
            : `${input.minutes}분`;
  const lines = [head, ...input.movements.map(displayMove)];
  if (input.noteKo) lines.push(input.noteKo);
  return lines.join("\n");
}

const CATALOG: Catalog[] = [
  {
    id: "mon-engine",
    nameKo: "짧은 엔진",
    named: false,
    format: "amrap",
    minutes: 14,
    pattern: "engine",
    stimulus: null,
    days: ["mon"],
    long: false,
    movements: () => [move("run", "400m", "런"), move("burpee", "8", "버피"), move("push_up", "10", "푸시업")],
  },
  {
    id: "mon-gym",
    nameKo: "맨몸 라운드",
    named: false,
    format: "amrap",
    minutes: 14,
    pattern: "gymnastic",
    stimulus: "고반복",
    days: ["mon"],
    long: false,
    movements: () => [move("sit_up", "15", "싯업"), move("push_up", "12", "푸시업"), move("ring_row", "8", "링 로우")],
  },
  {
    id: "tue-skill",
    nameKo: "더블언더",
    named: false,
    format: "amrap",
    minutes: 12,
    pattern: "engine",
    stimulus: "기술",
    days: ["tue"],
    long: false,
    movements: () => [move("double_under", "40", "더블언더"), move("handstand", "20초", "핸드스탠드 홀드")],
  },
  {
    id: "tue-gym",
    nameKo: "맨몸 서킷",
    named: false,
    format: "amrap",
    minutes: 12,
    pattern: "gymnastic",
    stimulus: "고반복",
    days: ["tue"],
    long: false,
    movements: (sex) => {
      const jump = box(sex);
      return jump
        ? [jump, move("ring_row", "10", "링 로우"), move("sit_up", "15", "싯업")]
        : [move("ring_row", "10", "링 로우"), move("sit_up", "15", "싯업"), move("burpee", "6", "버피")];
    },
  },
  {
    id: "wed-intervals",
    nameKo: "머신 인터벌",
    named: false,
    format: "intervals",
    minutes: 20,
    pattern: "engine",
    stimulus: null,
    days: ["wed"],
    weeks: [1, 3],
    long: false,
    noteKo: "5라운드. 팬바이크, 스키, 런을 섞습니다.",
    movements: () => [
      move("fan_bike", "12cal", "팬바이크"),
      move("run", "400m", "런"),
      move("ski", "250m", "스키"),
    ],
  },
  {
    id: "wed-long",
    nameKo: "긴 엔진",
    named: false,
    format: "for_time",
    minutes: 35,
    pattern: "engine",
    stimulus: null,
    days: ["wed"],
    weeks: [2, 4],
    long: true,
    noteKo: "30–40분. 다른 컨디셔닝은 오늘은 줄입니다.",
    movements: () => [
      move("run", "1600m", "런"),
      move("fan_bike", "15cal", "팬바이크"),
      move("ski", "400m", "스키"),
    ],
  },
  {
    id: "thu-short",
    nameKo: "짧은 마무리",
    named: false,
    format: "amrap",
    minutes: 8,
    pattern: "squat",
    stimulus: "고중량",
    days: ["thu"],
    weeks: [1, 2, 3],
    long: false,
    noteKo: "무게는 적지 않습니다.",
    movements: () => [move("thruster", "6", "스러스터"), move("lunge", "8", "런지")],
  },
  {
    id: "thu-gym",
    nameKo: "짧은 맨몸",
    named: false,
    format: "amrap",
    minutes: 8,
    pattern: "gymnastic",
    stimulus: "고반복",
    days: ["thu"],
    weeks: [1, 2, 3],
    long: false,
    movements: () => [move("push_up", "8", "푸시업"), move("sit_up", "12", "싯업"), move("ring_row", "6", "링 로우")],
  },
  {
    id: "sl-month-benchmark",
    nameKo: "월간 벤치마크",
    named: true,
    format: "for_time",
    minutes: 20,
    pattern: "engine",
    stimulus: null,
    days: ["thu"],
    weeks: [4],
    long: false,
    noteKo: "매월 4주 목요일에 같은 벤치마크입니다. 3라운드.",
    movements: (sex) => [
      move("run", "400m x3", "런"),
      wallBall(sex, "15x3"),
      move("burpee", "10x3", "버피"),
    ],
  },
  {
    id: "fri-engine",
    nameKo: "짧은 런",
    named: false,
    format: "amrap",
    minutes: 8,
    pattern: "engine",
    stimulus: null,
    days: ["fri"],
    long: false,
    movements: () => [move("run", "800m", "런"), move("push_up", "12", "푸시업"), move("knee_raise", "10", "니레이즈")],
  },
  {
    id: "fri-skill",
    nameKo: "기술 연습",
    named: false,
    format: "amrap",
    minutes: 8,
    pattern: "gymnastic",
    stimulus: "기술",
    days: ["fri"],
    long: false,
    movements: () => [move("double_under", "30", "더블언더"), move("handstand", "15초", "핸드스탠드 홀드")],
  },
  {
    id: "sat-reps",
    nameKo: "맨몸 반복",
    named: false,
    format: "amrap",
    minutes: 12,
    pattern: "gymnastic",
    stimulus: "고반복",
    days: ["sat"],
    long: false,
    noteKo: "선택입니다. 안 해도 되고, 못 해도 월요일로 옮기지 않습니다.",
    movements: () => [move("push_up", "15", "푸시업"), move("sit_up", "20", "싯업"), move("ring_row", "10", "링 로우")],
  },
];

/** Ids whose movements changed, so an old stored body must not inherit the new label. */
const RELABELED_IDS = new Set(["thu-short"]);

export function stimulusForPiece(piece: { id?: string; stimulus?: unknown } | null | undefined): MetconStimulus | null {
  if (!piece) return null;
  if (isMetconStimulus(piece.stimulus)) return piece.stimulus;
  if (!piece.id || RELABELED_IDS.has(piece.id)) return null;
  return CATALOG.find((row) => row.id === piece.id)?.stimulus ?? null;
}

function allowed(piece: Catalog, req: MetconRequest, honorPattern: boolean, honorStimulus: boolean): boolean {
  if (!piece.days.includes(req.day) || piece.long !== req.longPiece) return false;
  if (piece.weeks && !piece.weeks.includes(req.weekIndex)) return false;
  if (piece.long && piece.stimulus != null) return false;
  if (req.allowHeavy === false && piece.stimulus === "고중량") return false;
  if (honorPattern && req.avoidPatterns.includes(piece.pattern)) return false;
  if (honorStimulus && piece.stimulus && (req.avoidStimuli ?? []).includes(piece.stimulus)) return false;
  const keys = piece.movements(req.sex).map((m) => m.key);
  for (const forbid of req.forbid) {
    const banned = FORBID_KEYS[forbid];
    if (keys.some((key) => banned.includes(key))) return false;
  }
  return true;
}

function materialize(picked: Catalog, sex: AthleteSex): MetconPiece {
  const movements = picked.movements(sex);
  const signature = pieceSignature(picked.format, movements);
  return {
    id: picked.id,
    named: picked.named,
    nameKo: picked.nameKo,
    format: picked.format,
    minutes: picked.minutes,
    pattern: picked.pattern,
    stimulus: picked.stimulus,
    movements,
    signature,
    bodyKo: renderPiece({
      format: picked.format,
      minutes: picked.minutes,
      movements,
      noteKo: picked.noteKo,
      long: picked.long,
    }),
  };
}

/** Pieces that already satisfy the day's role, bans, length, and sex-scoped loads. */
export function listStructuralMetcons(req: MetconRequest): MetconPiece[] {
  return CATALOG.filter((piece) => allowed(piece, req, false, false)).map((piece) => materialize(piece, req.sex));
}

export function fillMetconFromRules(req: MetconRequest): MetconPiece {
  const picked =
    CATALOG.find((piece) => allowed(piece, req, true, true)) ??
    CATALOG.find((piece) => allowed(piece, req, false, true)) ??
    CATALOG.find((piece) => allowed(piece, req, false, false));
  if (!picked) {
    throw new Error(`metcon missing for ${req.day} week ${req.weekIndex}`);
  }
  return materialize(picked, req.sex);
}

