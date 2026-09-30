import { trainingMaxKg, wendlerMainSets, wendlerScheme, type WendlerWeek } from "../calc/wendler";
import type { MainLift, StrengthPrescription, StrengthSet } from "./types";

const LIFT_NAME: Record<MainLift, string> = {
  squat: "스쿼트",
  ohp: "오버헤드프레스",
  bench: "벤치프레스",
  deadlift: "데드리프트",
};

/** Same lift only. A missing squat does not borrow the deadlift. */
const LIFT_KEYS: Record<MainLift, string[]> = {
  squat: ["squat", "back_squat"],
  ohp: ["ohp", "press"],
  bench: ["bench", "bench_press"],
  deadlift: ["deadlift"],
};

export function liftName(lift: MainLift): string {
  return LIFT_NAME[lift];
}

export function readStoredOneRm(maxes: Record<string, number> | null | undefined, lift: MainLift): number | null {
  if (!maxes) return null;
  for (const key of LIFT_KEYS[lift]) {
    const value = maxes[key];
    if (typeof value === "number" && value > 0) return value;
  }
  return null;
}

function formatKg(kg: number): string {
  return Number.isInteger(kg) ? `${kg}kg` : `${kg}kg`;
}

export function formatSetLine(set: StrengthSet): string {
  const reps = set.amrap ? `${set.reps}회 이상` : `${set.reps}회`;
  if (set.weightKg == null) return `${set.setIndex}. ${reps} · ${set.percentOfTm}%`;
  return `${set.setIndex}. ${reps} · ${set.percentOfTm}% · ${formatKg(set.weightKg)}`;
}

export function strengthBody(rx: StrengthPrescription): string {
  const lines = [rx.nameKo, ...rx.sets.map(formatSetLine)];
  if (rx.missingOneRm) {
    lines.splice(1, 0, rx.noteKo);
  } else if (rx.trainingMaxKg != null && rx.oneRmKg != null) {
    lines.splice(1, 0, `트레이닝 맥스 ${formatKg(rx.trainingMaxKg)} (1RM ${formatKg(rx.oneRmKg)}의 90%)`);
  }
  return lines.join("\n");
}

export function topSetKg(rx: StrengthPrescription | null | undefined): number | null {
  if (!rx) return null;
  for (let i = rx.sets.length - 1; i >= 0; i -= 1) {
    const weight = rx.sets[i]?.weightKg;
    if (weight != null) return weight;
  }
  return null;
}

/**
 * Squat, press, bench, and deadlift use three 5/3/1 main sets.
 * Training max is 90% of the stored 1RM. No 1RM means no kilogram.
 */
export function prescribeMainLift(
  lift: MainLift,
  week: WendlerWeek,
  maxes: Record<string, number>,
): StrengthPrescription {
  const oneRm = readStoredOneRm(maxes, lift);
  const scheme = wendlerScheme(week);
  if (oneRm == null) {
    return {
      exerciseKey: lift,
      nameKo: LIFT_NAME[lift],
      oneRmKg: null,
      trainingMaxKg: null,
      missingOneRm: true,
      noteKo: "1RM이 없습니다. 무거운 단수를 1RM에 저장하세요. 무게는 만들지 않습니다.",
      sets: scheme.map((row, i) => ({
        setIndex: i + 1,
        percentOfTm: row.percentOfTm,
        reps: row.reps,
        amrap: row.amrap,
        weightKg: null,
      })),
    };
  }
  const calculated = wendlerMainSets(oneRm, week, "kg");
  return {
    exerciseKey: lift,
    nameKo: LIFT_NAME[lift],
    oneRmKg: oneRm,
    trainingMaxKg: trainingMaxKg(oneRm),
    missingOneRm: false,
    noteKo: "",
    sets: calculated.map((set) => ({
      setIndex: set.setIndex,
      percentOfTm: set.percentOfTm,
      reps: set.reps,
      amrap: set.amrap,
      weightKg: set.weightKg,
    })),
  };
}
