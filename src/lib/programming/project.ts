import { roundLoad } from "../calc/round";
import { trainingMaxKg } from "../calc/wendler";
import { liftName, readStoredOneRm, strengthBody } from "../month-plan/loads";
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
import type { ConditioningDraft, SessionDraft, Stimulus, WeekDraft } from "./types";

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

function pieceFrom(session: SessionDraft): MetconPiece | null {
  const conditioning = session.conditioning;
  if (!conditioning) return null;
  const movements = conditioning.movements.map((movement) => ({
    key: movement.key,
    amount: movement.amount,
    nameKo: movement.name_ko,
  }));
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

function strengthFrom(session: SessionDraft): StrengthPrescription | null {
  if (!session.strength) return null;
  return {
    exerciseKey: session.strength.lift,
    nameKo: liftName(session.strength.lift),
    oneRmKg: null,
    trainingMaxKg: null,
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

function dayFrom(session: SessionDraft): PlannedDay {
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
  const lift = strengthFrom(session);
  const piece = pieceFrom(session);
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
    blocks: applyTimeCut(blocks, BODY_BUDGET_MIN),
  };
}

/** Maps a model week onto the screen shape. It does not choose the sessions. */
export function projectWeek(draft: WeekDraft, weekIndex: WeekIndex, adapterId: "model" | "rules"): PlannedWeek {
  return {
    weekIndex,
    source: "rules",
    adapterId,
    bodyBudgetMin: BODY_BUDGET_MIN,
    days: draft.sessions.map(dayFrom),
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
  const tm = trainingMaxKg(oneRm);
  return {
    ...lift,
    oneRmKg: oneRm,
    trainingMaxKg: tm,
    missingOneRm: false,
    noteKo: "",
    sets: lift.sets.map((set) => ({
      ...set,
      weightKg: roundLoad(tm * (set.percentOfTm / 100), "kg"),
    })),
  };
}
