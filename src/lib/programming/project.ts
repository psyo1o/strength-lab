import { roundLoad } from "../calc/round";
import { trainingMaxKg } from "../calc/wendler";
import { readStoredOneRm, strengthBody } from "../month-plan/loads";
import { renderPiece } from "../month-plan/pieces";
import { pieceSignature } from "../month-plan/signature";
import { applyTimeCut } from "../month-plan/time-cut";
import {
  BODY_BUDGET_MIN,
  DAY_LABEL,
  type MetconPiece,
  type MetconStimulus,
  type PlannedDay,
  type PlannedWeek,
  type SessionBlock,
  type StrengthPrescription,
  type WeekIndex,
} from "../month-plan/types";
import { catalogMovement, displayAmount, linkedCatalogKey, movementDisplayName } from "./coaching/movement-catalog";
import { loadBasisForMethod } from "./strength-methods";
import { tipFor } from "../tips";
import type { ConditioningDraft, MovementDraft, SessionDraft, Stimulus, WeekDraft } from "./types";

const STIMULUS_KO: Record<Stimulus, MetconStimulus> = {
  heavy: "고중량",
  high_rep: "고반복",
  technical: "기술",
};

function asPattern(value: string): MetconPiece["pattern"] {
  if (
    value === "squat" ||
    value === "press" ||
    value === "hinge" ||
    value === "olympic" ||
    value === "engine" ||
    value === "gymnastic"
  ) {
    return value;
  }
  return "engine";
}

function pieceNote(conditioning: ConditioningDraft): string | undefined {
  if (conditioning.long_conditioning) {
    return `3라운드. 캡 ${conditioning.duration_min}분. 라운드 사이 1분 휴식.`;
  }
  if (conditioning.format === "emom") {
    return `1분마다 동작을 바꿉니다. 캡 ${conditioning.duration_min}분.`;
  }
  return undefined;
}

function screenAmount(movement: MovementDraft): string {
  if (movement.unit && movement.unit !== "reps" && /^\d+$/.test(movement.amount)) {
    return displayAmount(Number(movement.amount), movement.unit);
  }
  return movement.amount;
}

/** Alias keys become the specific movement on screen. abs and kettlebell stay as stored. */
function shownMovement(movement: MovementDraft): MovementDraft {
  let next = movement;
  if (movement.key !== "abs" && movement.key !== "kettlebell") {
    const linked = linkedCatalogKey(movement.key);
    if (linked.from) {
      const row = catalogMovement(linked.key);
      next = { ...movement, key: linked.key, name_ko: row?.name_ko ?? movement.name_ko };
    }
  }
  return { ...next, name_ko: movementDisplayName(next.key) };
}

function tipLines(key: string, unit: string, amount: number): string {
  const name = movementDisplayName(key);
  const shown = unit === "sec" ? `${amount}초` : unit === "cal" ? `${amount}cal` : unit === "m" ? `${amount}m` : `${amount}회`;
  const tip = tipFor(key);
  const cue = tip?.cue ? `\n자세: ${tip.cue}` : "";
  const mistake = tip?.mistake ? `\n흔한 실수: ${tip.mistake}` : "";
  return `${name} ${shown}${cue}${mistake}`;
}

function pieceFrom(session: SessionDraft): MetconPiece | null {
  const conditioning = session.conditioning;
  if (!conditioning) return null;
  const movements = conditioning.movements.map((movement) => {
    const shown = shownMovement(movement);
    return {
      key: shown.key,
      amount: screenAmount(shown),
      nameKo: shown.name_ko,
    };
  });
  const pattern = asPattern(conditioning.movement_patterns[0] ?? "engine");
  return {
    id: conditioning.benchmark ? "sl-month-benchmark" : `class-${session.day}`,
    named: conditioning.benchmark,
    nameKo: conditioning.benchmark ? "월간 벤치마크" : "클래스 메트콘",
    format: conditioning.format,
    minutes: conditioning.duration_min,
    pattern,
    movements,
    signature: pieceSignature(conditioning.format, movements),
    bodyKo: renderPiece({
      format: conditioning.format,
      minutes: conditioning.duration_min,
      movements,
      long: conditioning.long_conditioning,
      noteKo: pieceNote(conditioning),
    }),
    stimulus: conditioning.stimulus ? STIMULUS_KO[conditioning.stimulus] : null,
  };
}

function strengthFrom(session: SessionDraft, strengthMethod: string): StrengthPrescription | null {
  if (!session.strength) return null;
  const specific = session.strength.movement_key;
  return {
    exerciseKey: session.strength.lift,
    nameKo: movementDisplayName(specific || session.strength.lift),
    oneRmKg: null,
    trainingMaxKg: null,
    loadBasis: loadBasisForMethod(strengthMethod),
    missingOneRm: true,
    noteKo: "1RM이 없습니다. 무거운 단수를 1RM에 저장하세요. 무게는 만들지 않습니다.",
    sets: session.strength.sets.map((set, index) => ({
      setIndex: index + 1,
      percentOfTm: set.percent_of_tm,
      reps: set.reps,
      amrap: set.amrap,
      weightKg: null,
    })),
  };
}

function warmupBlock(session: SessionDraft): SessionBlock {
  return {
    role: "warmup",
    titleKo: "웜업",
    bodyKo: session.warmup_ko,
    minutes: session.warmup_min,
    cuttable: false,
    kept: true,
  };
}

function zone2Blocks(session: SessionDraft): SessionBlock[] {
  const zone = session.zone2;
  if (!zone || zone.form !== "day") return [];
  const name = movementDisplayName(zone.modality);
  const blocks: SessionBlock[] = [
    {
      role: "extra_conditioning",
      titleKo: "존 2 · 기본",
      bodyKo: `${name} ${zone.duration_min}분. 대화 가능 페이스.`,
      minutes: zone.duration_min,
      cuttable: false,
      kept: true,
    },
  ];
  const alternate = zone.alternate;
  if (!alternate) return blocks;
  const moves = alternate.movements.map((movement) => `${movementDisplayName(movement.key)} ${movement.amount}`).join(", ");
  blocks.push({
    role: "extra_conditioning",
    titleKo: "짧은 메트콘 · 대체",
    bodyKo: `${alternate.format} ${alternate.duration_min}분. RPE ${alternate.rpe}. ${moves}`,
    minutes: alternate.duration_min,
    cuttable: false,
    kept: true,
  });
  return blocks;
}

const BLOCK_TITLE: Record<string, string> = {
  warmup: "웜업",
  main_lift: "메인 리프트",
  skill_or_accessory: "기술·보조",
  metcon: "메트콘",
  extra_conditioning: "추가 컨디셔닝",
  cooldown: "쿨다운",
};

function contractBlocks(session: SessionDraft, strengthMethod: string): SessionBlock[] | null {
  if (!session.session_blocks?.length) return null;
  const lift = strengthFrom(session, strengthMethod);
  return session.session_blocks.map((block) => {
    const role =
      block.role === "main_lift" ? "main" : block.role === "skill_or_accessory" ? "skill" : block.role === "cooldown" ? "cooldown" : block.role;
    const phases =
      block.role === "warmup"
        ? session.warmup_phases?.filter((phase) => phase.phase !== "cooldown")
        : block.role === "cooldown"
          ? session.warmup_phases?.filter((phase) => phase.phase === "cooldown")
          : null;
    const rows = phases?.length
      ? phases.map((phase) => `${phase.phase === "raise" ? "레이즈" : phase.phase === "mobilise" ? "모빌라이즈" : phase.phase === "activate" ? "액티베이트" : phase.phase === "potentiate" ? "포텐시에이트" : "쿨다운"} · ${tipLines(phase.key, phase.unit, phase.amount)}`)
      : block.movements.map((movement) => tipLines(movement.key, movement.unit, movement.amount));
    const head =
      block.role === "metcon" && session.conditioning
        ? `${session.conditioning.format === "partner" ? "파트너 형식 · 개인도 가능" : session.conditioning.format} ${block.minutes}분`
        : "";
    return {
      role,
      titleKo: BLOCK_TITLE[block.role] ?? block.role,
      bodyKo: [head, block.role === "main_lift" && lift ? strengthBody(lift) : "", ...rows].filter(Boolean).join("\n"),
      minutes: block.minutes,
      cuttable: false,
      kept: true,
      movementKeys: (phases?.length ? phases.map((phase) => phase.key) : block.movements.map((movement) => movement.key)),
      ...(block.role === "main_lift" && lift ? { strength: lift } : {}),
    };
  });
}

function dayFrom(session: SessionDraft, strengthMethod: string): PlannedDay {
  if (session.rest) {
    return {
      day: session.day,
      labelKo: DAY_LABEL[session.day],
      optional: false,
      rest: true,
      longPiece: false,
      scheduled: false,
      piece: null,
      lift: null,
      blocks: [
        {
          role: "main",
          titleKo: "휴식",
          bodyKo: "쉽니다.",
          minutes: 0,
          cuttable: false,
          kept: true,
        },
      ],
    };
  }
  const lift = strengthFrom(session, strengthMethod);
  const piece = pieceFrom(session);
  const contracted = contractBlocks(session, strengthMethod);
  if (contracted) {
    return {
      day: session.day,
      labelKo: DAY_LABEL[session.day],
      optional: session.optional,
      rest: false,
      longPiece: session.conditioning?.long_conditioning ?? false,
      scheduled: true,
      piece,
      lift,
      blocks: [...contracted, ...zone2Blocks(session)],
    };
  }
  const blocks: SessionBlock[] = [warmupBlock(session)];
  if (lift) {
    blocks.push({
      role: "main",
      titleKo: "메인",
      bodyKo: strengthBody(lift),
      minutes: 25,
      cuttable: true,
      kept: true,
      strength: lift,
    });
  }
  if (piece) {
    const block: SessionBlock = {
      role: lift ? "metcon" : "main",
      titleKo: lift ? "메트콘" : "메인",
      bodyKo: piece.bodyKo,
      minutes: piece.minutes,
      cuttable: true,
      kept: true,
    };
    blocks.push(block);
  }
  return {
    day: session.day,
    labelKo: DAY_LABEL[session.day],
    optional: session.optional,
    rest: false,
    longPiece: session.conditioning?.long_conditioning ?? false,
    scheduled: true,
    piece,
    lift,
    blocks: [...applyTimeCut(blocks, BODY_BUDGET_MIN), ...zone2Blocks(session)],
  };
}

/** Maps a model week onto the screen shape. It does not choose the sessions. */
export function projectWeek(
  draft: WeekDraft,
  weekIndex: WeekIndex,
  adapterId: "model" | "rules",
  strengthMethod = "531",
): PlannedWeek {
  return {
    weekIndex,
    source: "rules",
    adapterId,
    bodyBudgetMin: BODY_BUDGET_MIN,
    days: draft.sessions.map((session) => dayFrom(session, strengthMethod)),
  };
}

export function applyStoredStrength(
  lift: StrengthPrescription,
  maxes: Record<string, number>,
): StrengthPrescription {
  const oneRm = readStoredOneRm(maxes, lift.exerciseKey);
  if (oneRm == null) {
    return {
      ...lift,
      oneRmKg: null,
      trainingMaxKg: null,
      missingOneRm: true,
      noteKo: "1RM이 없습니다. 무거운 단수를 1RM에 저장하세요. 무게는 만들지 않습니다.",
      sets: lift.sets.map((set) => ({ ...set, weightKg: null })),
    };
  }
  const basis = lift.loadBasis ?? "tm";
  const base = basis === "one_rm" ? oneRm : trainingMaxKg(oneRm);
  return {
    ...lift,
    oneRmKg: oneRm,
    trainingMaxKg: basis === "tm" ? trainingMaxKg(oneRm) : null,
    missingOneRm: false,
    noteKo: "",
    sets: lift.sets.map((set) => ({
      ...set,
      weightKg: roundLoad(base * (set.percentOfTm / 100), "kg"),
    })),
  };
}
