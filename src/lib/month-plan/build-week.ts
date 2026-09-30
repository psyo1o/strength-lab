import type { MetconAdapter } from "./adapter";
import { rulesMetconAdapter } from "./adapter";
import { prescribeMainLift, strengthBody } from "./loads";
import { applyTimeCut } from "./time-cut";
import {
  BODY_BUDGET_MIN,
  DAY_LABEL,
  DAY_ORDER,
  DEFAULT_TRAINING_DAYS,
  type DayKey,
  type MainLift,
  type MetconPattern,
  type MetconPiece,
  type MetconRequest,
  type PlannedDay,
  type PlannedWeek,
  type SessionBlock,
  type WeekBuildInput,
  type WeekIndex,
} from "./types";

function warmup(focus: string, air: boolean): SessionBlock {
  const body = air
    ? `8–12분. 쉬운 팬바이크 또는 줄넘기 2분, 인치웜 5, 팔 돌리기 10, 밴드 풀 10. 그다음 ${focus}를 빈 바나 맨몸으로 2세트.`
    : `8–12분. 쉬운 팬바이크 2분, 인치웜 5, 팔 돌리기 10, 밴드 풀 10. 그다음 ${focus}를 빈 바나 맨몸으로 2세트.`;
  return {
    role: "warmup",
    titleKo: "웜업",
    bodyKo: body,
    minutes: 10,
    cuttable: false,
    kept: true,
  };
}

function skill(bodyKo: string, minutes = 12): SessionBlock {
  return { role: "skill", titleKo: "스킬", bodyKo, minutes, cuttable: true, kept: true };
}

function assistance(bodyKo: string, minutes = 12): SessionBlock {
  return { role: "assistance", titleKo: "보조", bodyKo, minutes, cuttable: true, kept: true };
}

function extra(bodyKo: string): SessionBlock {
  return {
    role: "extra_conditioning",
    titleKo: "추가 컨디셔닝",
    bodyKo,
    minutes: 14,
    cuttable: true,
    kept: true,
  };
}

function metconBlock(piece: MetconPiece): SessionBlock {
  return {
    role: "metcon",
    titleKo: "메트콘",
    bodyKo: piece.bodyKo,
    minutes: piece.minutes,
    cuttable: true,
    kept: true,
  };
}

function mainBlock(titleBody: string, minutes: number, strength?: PlannedDay["lift"]): SessionBlock {
  return {
    role: "main",
    titleKo: "메인",
    bodyKo: titleBody,
    minutes,
    cuttable: true,
    kept: true,
    ...(strength ? { strength } : {}),
  };
}

export function tuesdayLift(week: WeekIndex): "ohp" | "bench" {
  return week % 2 === 1 ? "ohp" : "bench";
}

function forbidFor(day: DayKey): MetconRequest["forbid"] {
  if (day === "mon") return ["squat"];
  if (day === "tue") return ["snatch", "clean", "deadlift"];
  if (day === "wed") return ["snatch"];
  if (day === "fri") return ["squat", "swing", "clean"];
  return [];
}

function requestFor(
  input: WeekBuildInput,
  day: DayKey,
  longPiece: boolean,
  avoid: MetconPattern[],
): MetconRequest {
  return {
    weekIndex: input.weekIndex,
    day,
    sex: input.sex,
    avoidPatterns: avoid,
    longPiece,
    forbid: forbidFor(day),
  };
}

function olympicLine(kind: "clean" | "snatch", reduced: boolean): string {
  const name = kind === "clean" ? "클린" : "스내치";
  if (reduced) return `역도는 줄입니다. ${name}은 2세트 × 2회만. 무게는 적지 않습니다.`;
  return `${name} 기술 3세트 × 2–3회. 5/3/1 본세트는 스쿼트·프레스·벤치·데드에만 씁니다. 무게는 적지 않습니다.`;
}

function supportBlocks(day: DayKey): SessionBlock[] {
  if (day === "fri") {
    return [
      skill("핸드스탠드 홀드 20초 × 4. 무너지면 월 포지션."),
      assistance("푸시업 12회 × 3. 밴드 페이스 풀 12회 × 3."),
      extra("쉬운 팬바이크 8분. 대화가 되는 속도."),
    ];
  }
  if (day === "thu") {
    return [
      skill("더블언더 1분 × 4. 깨지면 싱글언더."),
      assistance("밴드 풀아파트 12회 × 3. 플랭크 30초 × 3."),
      extra("쉬운 로잉 8분."),
    ];
  }
  return [
    skill("더블언더 또는 핸드스탠드 홀드 8분. 실패하면 싱글언더."),
    assistance("플랭크 30초 × 3. 밴드 풀아파트 12회 × 3."),
    extra("쉬운 팬바이크 8분."),
  ];
}

function finish(day: Omit<PlannedDay, "blocks"> & { blocks: SessionBlock[] }): PlannedDay {
  return { ...day, blocks: applyTimeCut(day.blocks, BODY_BUDGET_MIN) };
}

function restDay(scheduledDays: DayKey[]): PlannedDay {
  return {
    day: "sun",
    labelKo: DAY_LABEL.sun,
    optional: false,
    rest: true,
    longPiece: false,
    scheduled: scheduledDays.includes("sun"),
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

function liftDay(
  input: WeekBuildInput,
  day: DayKey,
  lift: MainLift,
  focus: string,
  adapter: MetconAdapter,
  avoid: MetconPattern[],
  airWarmup: boolean,
): PlannedDay {
  const rx = prescribeMainLift(lift, input.weekIndex, input.maxes);
  const piece = adapter.fill(requestFor(input, day, false, avoid));
  return finish({
    day,
    labelKo: DAY_LABEL[day],
    optional: false,
    rest: false,
    longPiece: false,
    scheduled: true,
    piece,
    lift: rx,
    blocks: [
      warmup(focus, airWarmup),
      mainBlock(strengthBody(rx), 42, rx),
      metconBlock(piece),
      ...supportBlocks(day),
    ],
  });
}

export function buildWeek(input: WeekBuildInput, adapter: MetconAdapter = rulesMetconAdapter): PlannedWeek {
  const training = new Set(input.trainingDays ?? DEFAULT_TRAINING_DAYS);
  const avoid: MetconPattern[] = [];
  const recent = input.recentMetcons[0]?.pattern;
  if (recent) avoid.push(recent);

  const days: PlannedDay[] = [];
  const pushAvoid = (piece: MetconPiece | null) => {
    avoid.length = 0;
    if (piece) avoid.push(piece.pattern);
  };

  const mon = liftDay(input, "mon", "squat", "스쿼트", adapter, [...avoid], true);
  days.push({ ...mon, scheduled: training.has("mon") });
  pushAvoid(mon.piece);

  const press = tuesdayLift(input.weekIndex);
  const tue = liftDay(
    input,
    "tue",
    press,
    press === "ohp" ? "프레스" : "벤치",
    adapter,
    [...avoid],
    false,
  );
  days.push({ ...tue, scheduled: training.has("tue") });
  pushAvoid(tue.piece);

  const longPiece = input.weekIndex === 2 || input.weekIndex === 4;
  const wedPiece = adapter.fill(requestFor(input, "wed", longPiece, [...avoid]));
  const wedBlocks: SessionBlock[] = [warmup("쉬운 페이스", false), mainBlock(wedPiece.bodyKo, wedPiece.minutes)];
  if (!longPiece) {
    wedBlocks.push(skill("쉬운 스킵 30초 × 4.", 8), assistance("밴드 풀아파트 10회 × 2.", 8), extra("오늘은 여기까지."));
  }
  days.push(
    finish({
      day: "wed",
      labelKo: DAY_LABEL.wed,
      optional: false,
      rest: false,
      longPiece,
      scheduled: training.has("wed"),
      piece: wedPiece,
      lift: null,
      blocks: wedBlocks,
    }),
  );
  pushAvoid(wedPiece);

  if (input.weekIndex === 4) {
    const benchmark = adapter.fill(requestFor(input, "thu", false, []));
    days.push(
      finish({
        day: "thu",
        labelKo: DAY_LABEL.thu,
        optional: false,
        rest: false,
        longPiece: false,
        scheduled: training.has("thu"),
        piece: benchmark,
        lift: null,
        blocks: [
          warmup("어깨", false),
          mainBlock(benchmark.bodyKo, benchmark.minutes),
          skill(olympicLine("clean", true), 8),
          assistance("밴드 페이스 풀 10회 × 2.", 8),
        ],
      }),
    );
    pushAvoid(benchmark);
  } else {
    const olympic = input.weekIndex % 2 === 1 ? "clean" : "snatch";
    const piece = adapter.fill(requestFor(input, "thu", false, [...avoid]));
    days.push(
      finish({
        day: "thu",
        labelKo: DAY_LABEL.thu,
        optional: false,
        rest: false,
        longPiece: false,
        scheduled: training.has("thu"),
        piece,
        lift: null,
        blocks: [
          warmup(olympic === "clean" ? "클린" : "스내치", false),
          mainBlock(olympicLine(olympic, false), 20),
          metconBlock(piece),
          ...supportBlocks("thu"),
        ],
      }),
    );
    pushAvoid(piece);
  }

  const fri = liftDay(input, "fri", "deadlift", "데드", adapter, [...avoid], false);
  days.push({ ...fri, scheduled: training.has("fri") });
  pushAvoid(fri.piece);

  const satPiece = adapter.fill(requestFor(input, "sat", false, [...avoid]));
  days.push(
    finish({
      day: "sat",
      labelKo: DAY_LABEL.sat,
      optional: true,
      rest: false,
      longPiece: false,
      scheduled: training.has("sat"),
      piece: satPiece,
      lift: null,
      blocks: [warmup("쉬운 페이스", false), mainBlock(satPiece.bodyKo, satPiece.minutes)],
    }),
  );

  days.push(restDay([...training]));

  const ordered = DAY_ORDER.map((key) => days.find((day) => day.day === key)!);
  return {
    weekIndex: input.weekIndex,
    source: "rules",
    adapterId: adapter.id,
    bodyBudgetMin: BODY_BUDGET_MIN,
    days: ordered,
  };
}

export function dayByKey(week: PlannedWeek, day: DayKey): PlannedDay | undefined {
  return week.days.find((row) => row.day === day);
}

export function daySummary(day: PlannedDay): string {
  if (day.rest) return "쉽니다.";
  if (!day.scheduled) return "이번 주 운동 요일에서 빠져 있습니다.";
  const main = day.blocks.find((block) => block.role === "main" && block.kept);
  return main?.bodyKo.split("\n")[0] ?? day.piece?.nameKo ?? "";
}

export function dayText(day: PlannedDay): string {
  return day.blocks.map((block) => `${block.titleKo}\n${block.bodyKo}`).join("\n");
}

export function weekText(week: PlannedWeek): string {
  return week.days.map((day) => dayText(day)).join("\n");
}

