export type SeedSet = {
  setNumber: number;
  percentBase: "1rm" | "tm" | "ten_rm" | "none";
  percent: number | null;
  reps: number;
  amrap?: boolean;
  restSec?: number | null;
  noteKo?: string;
};

export type SeedExercise = {
  exerciseKey: string;
  role: "warmup" | "main" | "bbb" | "assistance" | "technique";
  notesKo?: string;
  sets: SeedSet[];
};

export type SeedDay = {
  dayNumber: number;
  nameKo: string;
  notesKo?: string;
  exercises: SeedExercise[];
};

export type SeedWeek = {
  weekNumber: number;
  nameKo: string;
  notesKo?: string;
  days: SeedDay[];
};

export type SeedProgram = {
  slug: string;
  nameKo: string;
  nameEn: string;
  category: string;
  completeness: "full" | "working" | "template";
  descriptionKo: string;
  descriptionEn: string;
  sortOrder: number;
  weeks: SeedWeek[];
};

export type SeedExerciseDef = {
  key: string;
  nameKo: string;
  nameEn: string;
  group: "pl" | "olympic" | "assistance";
  isMax: boolean;
  tipsKo: string;
  tipsEn: string;
};

export type SeedFile = {
  exercises: SeedExerciseDef[];
  programs: SeedProgram[];
};

function sets(
  percents: number[],
  reps: number | number[],
  base: SeedSet["percentBase"],
  extra?: Partial<SeedSet> & { lastAmrap?: boolean; restSec?: number },
): SeedSet[] {
  return percents.map((p, i) => ({
    setNumber: i + 1,
    percentBase: base,
    percent: p,
    reps: Array.isArray(reps) ? reps[i] ?? reps[reps.length - 1] : reps,
    amrap: extra?.lastAmrap ? i === percents.length - 1 : Boolean(extra?.amrap),
    restSec: extra?.restSec ?? 120,
    noteKo: extra?.noteKo ?? "",
  }));
}

function nSets(
  count: number,
  percent: number,
  reps: number,
  base: SeedSet["percentBase"],
  extra?: Partial<SeedSet> & { lastAmrap?: boolean },
): SeedSet[] {
  return Array.from({ length: count }, (_, i) => ({
    setNumber: i + 1,
    percentBase: base,
    percent,
    reps,
    amrap: extra?.lastAmrap ? i === count - 1 : Boolean(extra?.amrap),
    restSec: extra?.restSec ?? 90,
    noteKo: extra?.noteKo ?? "",
  }));
}

function placeholder(exerciseKey: string, nameNote: string, setsCount = 3, reps = 10): SeedExercise {
  return {
    exerciseKey,
    role: "assistance",
    notesKo: nameNote,
    sets: Array.from({ length: setsCount }, (_, i) => ({
      setNumber: i + 1,
      percentBase: "none",
      percent: null,
      reps,
      restSec: 60,
      noteKo: "작업중량 · 플레이스홀더",
    })),
  };
}

export const EXERCISES: SeedExerciseDef[] = [
  {
    key: "squat",
    nameKo: "스쿼트",
    nameEn: "Back Squat",
    group: "pl",
    isMax: true,
    tipsKo:
      "발은 어깨~골반 너비. 발끝은 살짝 바깥. 브레이싱 후 힙을 뒤로 보내며 내려가고, 무릎이 발끝 방향으로 추적되게 한다. 가슴을 열고 허리가 무너지지 않게. 최하단에서 발바닥 전체로 밀어 올린다.",
    tipsEn: "Brace, sit back, knees track toes, drive the floor away.",
  },
  {
    key: "bench",
    nameKo: "벤치프레스",
    nameEn: "Bench Press",
    group: "pl",
    isMax: true,
    tipsKo:
      "견갑을 모으고 내려 안정된 선반을 만든다. 발은 땅을 밀고 아치를 유지. 바는 젖꼭지 라인 근처로 내리고 팔꿈치는 약 45~70°. 바가 가슴에 닿으면 발을 밀며 위로 밀어낸다.",
    tipsEn: "Pack the scapulae, slight arch, bar to lower chest, press up and back.",
  },
  {
    key: "deadlift",
    nameKo: "데드리프트",
    nameEn: "Deadlift",
    group: "pl",
    isMax: true,
    tipsKo:
      "바는 정강이에 가깝게. 힙 힌지로 내려가 바를 잡고, 등허리를 중립으로. 시작은 바닥을 밀듯 레그 드라이브. 바가 무릎을 지나면 힙을 앞으로 잠근다. 내린 때도 바를 몸에 붙인다.",
    tipsEn: "Bar close, neutral spine, leg drive then lock the hips.",
  },
  {
    key: "ohp",
    nameKo: "오버헤드프레스",
    nameEn: "Overhead Press",
    group: "pl",
    isMax: true,
    tipsKo:
      "그립은 어깨 밖 약간. 코어와 둔근을 잠그고 허리가 과도하게 꺾이지 않게. 바는 얼굴 가까이 수직으로. 귀가 지나가면 머리를 바 밑으로 넣어 락아웃.",
    tipsEn: "Squeeze glutes, bar close to face, head through at lockout.",
  },
  {
    key: "front_squat",
    nameKo: "프론트스쿼트",
    nameEn: "Front Squat",
    group: "pl",
    isMax: true,
    tipsKo:
      "바가 전면 삼각근 선반에 올라가게. 팔꿈치를 높이 유지하고 흉곽을 든다. 무릎을 앞으로 보내며 깊게 앉고, 상체가 무너지면 팔꿈치가 떨어진다.",
    tipsEn: "High elbows, bar on the shelf, sit between the hips.",
  },
  {
    key: "power_clean",
    nameKo: "파워클린",
    nameEn: "Power Clean",
    group: "pl",
    isMax: true,
    tipsKo:
      "1풀은 정강이 가까이 천천히, 2풀에서 힙·슬·발목을 동시에 신전. 어깨를 으쓱하며 팔꿈치를 빨리 돌려 프론트랙에서 받는다. 스쿼트로 깊게 앉지 않고 1/4 스쿼트 높이에서 받는다.",
    tipsEn: "Patient first pull, violent extension, fast elbows, receive high.",
  },
  {
    key: "clean_jerk",
    nameKo: "클린&저크",
    nameEn: "Clean & Jerk",
    group: "olympic",
    isMax: true,
    tipsKo:
      "클린은 풀 스쿼트로 받고 일어선 뒤 호흡을 다시 잡는다. 저크 딥은 짧고 수직. 발 스플릿과 동시에 팔을 잠근다. 회복은 앞발 먼저.",
    tipsEn: "Stand the clean, short dip, split and lock, recover front foot first.",
  },
  {
    key: "clean",
    nameKo: "클린",
    nameEn: "Clean",
    group: "olympic",
    isMax: true,
    tipsKo:
      "바가 몸에서 멀어지지 않게. 무릎을 다시 바 밑으로 넣으며(더블 니 벤드) 폭발. 팔꿈치를 빠르게 돌려 프론트랙을 만들고 깊게 앉는다.",
    tipsEn: "Bar close, double knee bend, fast elbows, ride the squat.",
  },
  {
    key: "jerk",
    nameKo: "저크",
    nameEn: "Jerk",
    group: "olympic",
    isMax: true,
    tipsKo:
      "랙에서 팔꿈치가 너무 높지 않게. 딥은 수직·짧게. 드라이브 후 몸을 바 밑으로 떨어뜨린다. 뒷무릎은 굽히고 앞발은 평평하게.",
    tipsEn: "Vertical dip, drop under the bar, locked arms, stable split.",
  },
  {
    key: "power_jerk",
    nameKo: "파워저크",
    nameEn: "Power Jerk",
    group: "olympic",
    isMax: true,
    tipsKo:
      "스플릿 없이 양발을 살짝 벌리며 1/4 스쿼트에서 받는다. 딥-드라이브는 저크와 같고, 팔 락아웃이 발 착지와 동시에 이뤄지게.",
    tipsEn: "Same dip-drive as jerk, receive in a quarter squat.",
  },
  {
    key: "snatch",
    nameKo: "스네치",
    nameEn: "Snatch",
    group: "olympic",
    isMax: true,
    tipsKo:
      "와이드 그립, 어깨가 바 앞. 1풀은 균형, 2풀은 수직 점프. 팔을 당기지 말고 몸을 바 밑으로. 오버헤드 스쿼트로 깊게 받아 안정 후 기립.",
    tipsEn: "Balance first pull, jump, pull under, squat and stand.",
  },
  {
    key: "power_snatch",
    nameKo: "파워스네치",
    nameEn: "Power Snatch",
    group: "olympic",
    isMax: true,
    tipsKo:
      "스네치와 같은 풀이지만 더 높은 신장. 허벅지 중상단에서 강하게 끝내고 1/4~1/2 스쿼트에서 오버헤드로 받는다.",
    tipsEn: "Finish taller than a full snatch and receive high.",
  },
  {
    key: "muscle_snatch",
    nameKo: "머슬스네치",
    nameEn: "Muscle Snatch",
    group: "olympic",
    isMax: true,
    tipsKo:
      "점프/재굴곡 없이 힙 신전 후 팔로 바를 얼굴 앞을 지나 오버헤드까지 밀어 올린다. 전환 구간 강화용. 가벼운 중량으로 경로를 지킨다.",
    tipsEn: "No rebend — extend and punch the bar overhead.",
  },
  {
    key: "push_press",
    nameKo: "푸쉬프레스",
    nameEn: "Push Press",
    group: "olympic",
    isMax: true,
    tipsKo:
      "딥은 짧고 수직. 다리로 바를 던지듯 드라이브한 뒤 팔로 락아웃. 허리가 꺾이며 딥이 앞으로 나가지 않게.",
    tipsEn: "Short dip, drive with the legs, punch to lockout.",
  },
  {
    key: "ohs",
    nameKo: "오버헤드스쿼트",
    nameEn: "Overhead Squat",
    group: "olympic",
    isMax: true,
      tipsKo:
      "바가 발등~견갑 사이 수직선에. 팔꿈치를 잠그고 어깨로 바를 천장에 고정. 깊게 앉을 때 바가 앞으로 무너지면 흉곽을 들고 광배를 연다.",
    tipsEn: "Bar over mid-foot, locked elbows, sit deep without collapsing.",
  },
  {
    key: "barbell_row",
    nameKo: "바벨로우",
    nameEn: "Barbell Row",
    group: "assistance",
    isMax: false,
    tipsKo: "상체를 약 45°로 고정하고 바를 하복부/명치 쪽으로 당긴다. 반동을 최소화.",
    tipsEn: "Torso set, pull to the hip, minimal bounce.",
  },
  {
    key: "rdl",
    nameKo: "루마니안 데드",
    nameEn: "Romanian Deadlift",
    group: "assistance",
    isMax: false,
    tipsKo: "무릎은 살짝만 굽히고 힙을 뒤로. 햄스트링 장력을 느끼며 바를 허벅지에 붙인다.",
    tipsEn: "Soft knees, hips back, bar on the legs.",
  },
  {
    key: "lunge",
    nameKo: "런지",
    nameEn: "Lunge",
    group: "assistance",
    isMax: false,
    tipsKo: "앞무릎이 안쪽으로 무너지지 않게. 상체를 세우고 앞발 뒤꿈치로 일어난다.",
    tipsEn: "Tall torso, front heel drive, knee tracks the foot.",
  },
  {
    key: "chin_up",
    nameKo: "친업",
    nameEn: "Chin-up",
    group: "assistance",
    isMax: false,
    tipsKo: "어깨를 내리고 시작해 가슴을 바 쪽으로. 반동 없이 제어하며 내린다.",
    tipsEn: "Depress scapulae, chest to bar, controlled negative.",
  },
  {
    key: "dip",
    nameKo: "딥",
    nameEn: "Dip",
    group: "assistance",
    isMax: false,
    tipsKo: "어깨가 귀로 솟지 않게. 깊이보다 어깨 위치를 우선한다.",
    tipsEn: "Keep shoulders down; depth without pain.",
  },
  {
    key: "face_pull",
    nameKo: "페이스풀",
    nameEn: "Face Pull",
    group: "assistance",
    isMax: false,
    tipsKo: "로프를 얼굴 쪽으로 당기며 외회전. 승모 상부만 쓰지 말고 후면 삼각을 느낀다.",
    tipsEn: "Pull to the face and externally rotate.",
  },
  {
    key: "plank",
    nameKo: "플랭크",
    nameEn: "Plank",
    group: "assistance",
    isMax: false,
    tipsKo: "갈비뼈를 내리고 둔근을 조여 허리가 꺾이지 않게.",
    tipsEn: "Ribs down, glutes on, long spine.",
  },
  {
    key: "back_extension",
    nameKo: "백익스텐션",
    nameEn: "Back Extension",
    group: "assistance",
    isMax: false,
    tipsKo: "허리만 꺾지 말고 힙 힌지로 몸을 펼친다.",
    tipsEn: "Hinge at the hips, do not crank the lumbar.",
  },
  {
    key: "hanging_leg_raise",
    nameKo: "행잉 레그레이즈",
    nameEn: "Hanging Leg Raise",
    group: "assistance",
    isMax: false,
    tipsKo: "골반을 말아 올리듯. 스윙을 줄인다.",
    tipsEn: "Posteriorly tilt the pelvis, minimal swing.",
  },
  {
    key: "pull_up",
    nameKo: "풀업",
    nameEn: "Pull-up",
    group: "assistance",
    isMax: false,
    tipsKo: "광배로 당긴다는 느낌. 어깨가 먼저 내려가게.",
    tipsEn: "Scapular depression first, then pull.",
  },
  {
    key: "curl",
    nameKo: "바벨컬",
    nameEn: "Barbell Curl",
    group: "assistance",
    isMax: false,
    tipsKo: "팔꿈치를 고정하고 반동 없이.",
    tipsEn: "Elbows pinned, no sway.",
  },
  {
    key: "tricep_ext",
    nameKo: "트라이셉스 익스텐션",
    nameEn: "Triceps Extension",
    group: "assistance",
    isMax: false,
    tipsKo: "팔꿈치 위치를 고정한 채 전완만 움직인다.",
    tipsEn: "Only the forearm moves.",
  },
  {
    key: "snatch_pull",
    nameKo: "스네치 풀",
    nameEn: "Snatch Pull",
    group: "assistance",
    isMax: false,
    tipsKo: "스네치 그립으로 2풀까지. 바 경로는 몸에 가깝게.",
    tipsEn: "Snatch grip, finish the second pull.",
  },
  {
    key: "clean_pull",
    nameKo: "클린 풀",
    nameEn: "Clean Pull",
    group: "assistance",
    isMax: false,
    tipsKo: "클린 그립, 강한 신전. 어깨를 귀까지 으쓱.",
    tipsEn: "Clean grip, full extension and shrug.",
  },
];

function wendlerDay(dayNumber: number, nameKo: string, lift: string, week: 1 | 2 | 3 | 4): SeedDay {
  const main =
    week === 1
      ? sets([65, 75, 85], [5, 5, 5], "tm", { lastAmrap: true, restSec: 180 })
      : week === 2
        ? sets([70, 80, 90], [3, 3, 3], "tm", { lastAmrap: true, restSec: 180 })
        : week === 3
          ? sets([75, 85, 95], [5, 3, 1], "tm", { lastAmrap: true, restSec: 180 })
          : sets([40, 50, 60], [5, 5, 5], "tm", { restSec: 90 });

  const exercises: SeedExercise[] = [
    {
      exerciseKey: lift,
      role: "warmup",
      notesKo: "워밍업 — TM 기준",
      sets: sets([40, 50, 60], [5, 5, 3], "tm", { restSec: 60 }),
    },
    {
      exerciseKey: lift,
      role: "main",
      notesKo: week === 4 ? "딜로드 본세트" : "본세트 · 마지막 세트 AMRAP",
      sets: main,
    },
  ];

  if (week !== 4) {
    exercises.push({
      exerciseKey: lift,
      role: "bbb",
      notesKo: "Boring But Big 5×10 @ 50% TM — 플레이스홀더 중량",
      sets: nSets(5, 50, 10, "tm", { restSec: 90 }),
    });
  }

  const assist =
    lift === "squat"
      ? [placeholder("lunge", "레그 보조", 3, 8), placeholder("hanging_leg_raise", "코어", 3, 10)]
      : lift === "bench"
        ? [placeholder("dip", "푸시 보조", 3, 8), placeholder("face_pull", "후면", 3, 15)]
        : lift === "deadlift"
          ? [placeholder("rdl", "힌지 보조", 3, 8), placeholder("back_extension", "후면 체인", 3, 10)]
          : [placeholder("chin_up", "풀 보조", 3, 8), placeholder("plank", "코어", 3, 30)];

  exercises.push(...assist);

  return {
    dayNumber,
    nameKo,
    notesKo: "메인 리프트는 Training Max(0.9×1RM) 퍼센트입니다.",
    exercises,
  };
}

function wendlerProgram(): SeedProgram {
  const dayDefs = [
    { n: 1, name: "오버헤드프레스 데이", lift: "ohp" },
    { n: 2, name: "데드리프트 데이", lift: "deadlift" },
    { n: 3, name: "벤치프레스 데이", lift: "bench" },
    { n: 4, name: "스쿼트 데이", lift: "squat" },
  ];
  const weekNames = [
    "1주차 — 5s",
    "2주차 — 3s",
    "3주차 — 5/3/1",
    "4주차 — 딜로드",
  ];
  return {
    slug: "wendler-531",
    nameKo: "Jim Wendler 5/3/1 Simplest Strength",
    nameEn: "Jim Wendler 5/3/1 Simplest Strength",
    category: "파워리프팅",
    completeness: "full",
    descriptionKo:
      "Training Max = 0.9×1RM. 1주 65/75/85%×5, 2주 70/80/90%×3, 3주 75/85/95%(5/3/1), 4주 딜로드. 워밍업 + BBB 5×10 + 보조 플레이스홀더. 메인 4대: 스쿼트/벤치/데드/OHP.",
    descriptionEn:
      "Full working 5/3/1: TM=0.9×1RM, classic weekly percents, warmups, BBB, assistance placeholders.",
    sortOrder: 10,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: weekNames[w - 1],
      notesKo: w === 4 ? "가벼운 딜로드. 피로를 뺀다." : "마지막 본세트는 AMRAP.",
      days: dayDefs.map((d) => wendlerDay(d.n, d.name, d.lift, w as 1 | 2 | 3 | 4)),
    })),
  };
}

function rehabProgram(): SeedProgram {
  const delorme = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DeLorme — 10RM(≈75% 1RM)의 50 / 75 / 100%",
    sets: sets([50, 75, 100], 10, "ten_rm", { restSec: 120 }),
  });
  const dapre = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DAPRE — 3세트 AMRAP 후 4세트 중량 조절",
    sets: [
      { setNumber: 1, percentBase: "ten_rm", percent: 50, reps: 10, restSec: 120, noteKo: "" },
      { setNumber: 2, percentBase: "ten_rm", percent: 75, reps: 6, restSec: 120, noteKo: "" },
      {
        setNumber: 3,
        percentBase: "ten_rm",
        percent: 100,
        reps: 6,
        amrap: true,
        restSec: 180,
        noteKo: "AMRAP — 다음 세트 중량 결정",
      },
      {
        setNumber: 4,
        percentBase: "ten_rm",
        percent: 100,
        reps: 6,
        amrap: true,
        restSec: 180,
        noteKo: "조절 세트 (3세트 반복 수에 따라 ±)",
      },
    ],
  });

  return {
    slug: "rehab-delorme-dapre",
    nameKo: "재활 (DeLorme / DAPRE)",
    nameEn: "Rehab — DeLorme / DAPRE",
    category: "재활",
    completeness: "working",
    descriptionKo:
      "10RM을 1RM의 75%로 추정합니다. DeLorme은 점증 3세트, DAPRE는 3세트 AMRAP로 다음 중량을 정하는 단순 진행입니다. 통증 있으면 즉시 중단하세요.",
    descriptionEn: "Simple DeLorme and DAPRE progressions using estimated 10RM (75% of 1RM).",
    sortOrder: 20,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: `${w}주차`,
      notesKo: w > 1 ? "지난주 10RM이 편하면 2.5kg 올려 재추정." : "통증 없는 가동 범위만.",
      days: [
        {
          dayNumber: 1,
          nameKo: "DeLorme 하체",
          notesKo: "스쿼트·RDL 중심 재활 용량.",
          exercises: [delorme("squat"), delorme("rdl"), placeholder("plank", "코어", 3, 20)],
        },
        {
          dayNumber: 2,
          nameKo: "DAPRE 상체",
          notesKo: "벤치·프레스 용량 테스트.",
          exercises: [dapre("bench"), dapre("ohp"), placeholder("face_pull", "견갑", 3, 15)],
        },
        {
          dayNumber: 3,
          nameKo: "DeLorme 힌지 / 전면",
          notesKo: "데드·프론트스쿼트 저강도.",
          exercises: [delorme("deadlift"), delorme("front_squat"), placeholder("back_extension", "후면", 3, 10)],
        },
      ],
    })),
  };
}

function dupProgram(): SeedProgram {
  const blocks = [
    { h: 70, s: 85, p: 60 },
    { h: 72.5, s: 87.5, p: 62.5 },
    { h: 75, s: 90, p: 65 },
    { h: 65, s: 70, p: 55 },
  ];
  const lifts = [
    ["squat", "bench"],
    ["deadlift", "ohp"],
    ["front_squat", "bench"],
  ] as const;

  return {
    slug: "dup",
    nameKo: "일간 파동형 주기화",
    nameEn: "Daily Undulating Periodization",
    category: "주기화",
    completeness: "working",
    descriptionKo:
      "같은 주 안에 비대(고반복)·근력(고중량)·파워(빠른 속도)를 하루에 나눠 배치합니다. %1RM 기반 셸이며 4주차는 가벼운 회복 주입니다.",
    descriptionEn: "Hypertrophy / strength / power days with %1RM shells.",
    sortOrder: 30,
    weeks: blocks.map((b, wi) => ({
      weekNumber: wi + 1,
      nameKo: wi === 3 ? "4주차 — 회복" : `${wi + 1}주차`,
      notesKo: "컨디션에 따라 본세트 1세트 가감.",
      days: [
        {
          dayNumber: 1,
          nameKo: "비대 데이",
          notesKo: `${b.h}% 1RM × 8`,
          exercises: lifts[0].map((k) => ({
            exerciseKey: k,
            role: "main" as const,
            sets: nSets(4, b.h, 8, "1rm", { restSec: 90 }),
          })),
        },
        {
          dayNumber: 2,
          nameKo: "근력 데이",
          notesKo: `${b.s}% 1RM × 3`,
          exercises: lifts[1].map((k) => ({
            exerciseKey: k,
            role: "main" as const,
            sets: nSets(5, b.s, 3, "1rm", { lastAmrap: true, restSec: 180 }),
          })),
        },
        {
          dayNumber: 3,
          nameKo: "파워 데이",
          notesKo: `${b.p}% 1RM × 3 — 바 속도를 우선`,
          exercises: [
            {
              exerciseKey: "power_clean",
              role: "main",
              sets: nSets(6, b.p, 3, "1rm", { restSec: 90 }),
            },
            {
              exerciseKey: "squat",
              role: "main",
              notesKo: "점프 스쿼트 느낌으로 빠르게",
              sets: nSets(5, b.p, 3, "1rm", { restSec: 90 }),
            },
          ],
        },
      ],
    })),
  };
}

function juggernautProgram(): SeedProgram {
  const wave = [
    { name: "10s 축적", pct: 60, sets: 4, reps: 10, amrap: true },
    { name: "10s 강화", pct: 65, sets: 3, reps: 10, amrap: true },
    { name: "10s 실현", pct: 70, sets: 1, reps: 10, amrap: true },
    { name: "딜로드", pct: 50, sets: 3, reps: 5, amrap: false },
  ];
  const days = [
    { n: 1, name: "스쿼트", key: "squat" },
    { n: 2, name: "벤치", key: "bench" },
    { n: 3, name: "데드", key: "deadlift" },
    { n: 4, name: "OHP", key: "ohp" },
  ];
  return {
    slug: "juggernaut",
    nameKo: "Juggernaut Method",
    nameEn: "Juggernaut Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "10s 웨이브 4주 셸입니다(전체 16주 중 첫 블록). 마지막 세트 AMRAP로 다음 웨이브 용량을 가늠합니다. 8s/5s/3s는 같은 골격으로 확장하세요.",
    descriptionEn: "Usable 10s-wave shell (4 weeks). 8s/5s/3s not fully expanded.",
    sortOrder: 40,
    weeks: wave.map((w, i) => ({
      weekNumber: i + 1,
      nameKo: `${i + 1}주차 — ${w.name}`,
      notesKo: w.amrap ? "마지막 세트 AMRAP." : "가볍게 움직임을 유지.",
      days: days.map((d) => ({
        dayNumber: d.n,
        nameKo: d.name,
        exercises: [
          {
            exerciseKey: d.key,
            role: "warmup",
            sets: sets([40, 50], [5, 5], "1rm", { restSec: 60 }),
          },
          {
            exerciseKey: d.key,
            role: "main",
            sets: nSets(w.sets, w.pct, w.reps, "1rm", { lastAmrap: w.amrap, restSec: 150 }),
          },
          placeholder("barbell_row", "보조 당기기", 3, 10),
        ],
      })),
    })),
  };
}

function cowboyProgram(): SeedProgram {
  const weeks = [70, 72.5, 75, 60];
  return {
    slug: "cowboy",
    nameKo: "Cowboy Method",
    nameEn: "Cowboy Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "주 4일 스쿼트/벤치/데드/프레스 볼륨 셸. 상한 %1RM으로 작업하며 4주는 회복. 원본 스프레드시트의 모든 변형을 재현하지는 않습니다.",
    descriptionEn: "Usable 4-day volume shell. Not a full spreadsheet clone.",
    sortOrder: 50,
    weeks: weeks.map((pct, i) => ({
      weekNumber: i + 1,
      nameKo: i === 3 ? "4주차 — 회복" : `${i + 1}주차`,
      notesKo: `${pct}% 전후 작업.`,
      days: [
        {
          dayNumber: 1,
          nameKo: "스쿼트 볼륨",
          exercises: [
            { exerciseKey: "squat", role: "main", sets: nSets(5, pct, 5, "1rm") },
            { exerciseKey: "front_squat", role: "main", sets: nSets(3, pct - 10, 5, "1rm") },
            placeholder("lunge", "단측", 3, 8),
          ],
        },
        {
          dayNumber: 2,
          nameKo: "벤치 볼륨",
          exercises: [
            { exerciseKey: "bench", role: "main", sets: nSets(5, pct, 5, "1rm") },
            { exerciseKey: "ohp", role: "main", sets: nSets(3, pct - 5, 5, "1rm") },
            placeholder("dip", "푸시", 3, 8),
          ],
        },
        {
          dayNumber: 3,
          nameKo: "데드 볼륨",
          exercises: [
            { exerciseKey: "deadlift", role: "main", sets: nSets(3, pct, 5, "1rm") },
            { exerciseKey: "rdl", role: "main", sets: nSets(3, 60, 8, "1rm") },
            placeholder("back_extension", "후면", 3, 10),
          ],
        },
        {
          dayNumber: 4,
          nameKo: "프레스 + 라이트 스쿼트",
          exercises: [
            { exerciseKey: "ohp", role: "main", sets: nSets(5, pct - 5, 5, "1rm") },
            { exerciseKey: "squat", role: "main", notesKo: "라이트", sets: nSets(3, 55, 5, "1rm") },
            placeholder("chin_up", "풀", 3, 8),
          ],
        },
      ],
    })),
  };
}

function startingStrength(): SeedProgram {
  const a = (bump: number): SeedDay => ({
    dayNumber: 0,
    nameKo: "Workout A",
    notesKo: "다음 세션 스쿼트/데드 +2.5~5kg, 벤치 +2.5kg (성공 시).",
    exercises: [
      { exerciseKey: "squat", role: "main", sets: nSets(3, 80 + bump, 5, "1rm", { restSec: 180 }) },
      { exerciseKey: "bench", role: "main", sets: nSets(3, 75 + bump, 5, "1rm", { restSec: 150 }) },
      { exerciseKey: "deadlift", role: "main", sets: nSets(1, 80 + bump, 5, "1rm", { restSec: 180 }) },
    ],
  });
  const b = (bump: number, dayNumber: number): SeedDay => ({
    dayNumber,
    nameKo: "Workout B",
    notesKo: "다음 세션 스쿼트 +2.5~5kg, 프레스 +2.5kg. 파워클린은 기술 우선.",
    exercises: [
      { exerciseKey: "squat", role: "main", sets: nSets(3, 80 + bump, 5, "1rm", { restSec: 180 }) },
      { exerciseKey: "ohp", role: "main", sets: nSets(3, 70 + bump, 5, "1rm", { restSec: 150 }) },
      { exerciseKey: "power_clean", role: "main", sets: nSets(5, 65 + bump, 3, "1rm", { restSec: 120 }) },
    ],
  });

  const pattern: ("A" | "B")[][] = [
    ["A", "B", "A"],
    ["B", "A", "B"],
    ["A", "B", "A"],
    ["B", "A", "B"],
  ];

  return {
    slug: "starting-strength",
    nameKo: "Starting Strength A/B",
    nameEn: "Starting Strength A/B",
    category: "초급 근력",
    completeness: "working",
    descriptionKo:
      "A: 스쿼트 3×5 · 벤치 3×5 · 데드 1×5. B: 스쿼트 3×5 · 프레스 3×5 · 파워클린 5×3. 중량은 1RM%로 시드되며, 성공한 세션마다 상체는 +2.5kg, 하체는 +2.5~5kg 올리는 선형 진행입니다.",
    descriptionEn: "Classic A/B novice linear progression with %1RM seeded loads.",
    sortOrder: 60,
    weeks: pattern.map((days, wi) => ({
      weekNumber: wi + 1,
      nameKo: `${wi + 1}주차`,
      notesKo: "주 3회, A/B 교대. 실패 시 중량 유지 후 재시도.",
      days: days.map((kind, di) => {
        const bump = wi * 1.5;
        const day = kind === "A" ? a(bump) : b(bump, 0);
        return { ...day, dayNumber: di + 1, nameKo: `${kind === "A" ? "Workout A" : "Workout B"}` };
      }),
    })),
  };
}

function stronglifts(): SeedProgram {
  const a = (bump: number): SeedExercise[] => [
    { exerciseKey: "squat", role: "main", sets: nSets(5, 70 + bump, 5, "1rm", { restSec: 180 }) },
    { exerciseKey: "bench", role: "main", sets: nSets(5, 70 + bump, 5, "1rm", { restSec: 150 }) },
    { exerciseKey: "barbell_row", role: "main", sets: nSets(5, 60 + bump, 5, "1rm", { restSec: 120 }) },
  ];
  const b = (bump: number): SeedExercise[] => [
    { exerciseKey: "squat", role: "main", sets: nSets(5, 70 + bump, 5, "1rm", { restSec: 180 }) },
    { exerciseKey: "ohp", role: "main", sets: nSets(5, 65 + bump, 5, "1rm", { restSec: 150 }) },
    { exerciseKey: "deadlift", role: "main", sets: nSets(1, 75 + bump, 5, "1rm", { restSec: 180 }) },
  ];
  const pattern: ("A" | "B")[][] = [
    ["A", "B", "A"],
    ["B", "A", "B"],
    ["A", "B", "A"],
    ["B", "A", "B"],
  ];
  return {
    slug: "stronglifts-5x5",
    nameKo: "Stronglifts 5x5",
    nameEn: "Stronglifts 5x5",
    category: "초급 근력",
    completeness: "working",
    descriptionKo:
      "A: 스쿼트/벤치/로우 5×5. B: 스쿼트/OHP 5×5 + 데드 1×5. 시드 중량은 1RM의 약 70%부터 주차별 소폭 상승합니다. 5×5 성공 시 +2.5kg.",
    descriptionEn: "A/B 5x5 with %1RM progression shells.",
    sortOrder: 70,
    weeks: pattern.map((days, wi) => ({
      weekNumber: wi + 1,
      nameKo: `${wi + 1}주차`,
      notesKo: "실패 3회면 10% 딜로드 후 재진행.",
      days: days.map((kind, di) => ({
        dayNumber: di + 1,
        nameKo: kind === "A" ? "Workout A" : "Workout B",
        notesKo: kind === "A" ? "스쿼트 · 벤치 · 로우" : "스쿼트 · 프레스 · 데드",
        exercises: kind === "A" ? a(wi * 1.25) : b(wi * 1.25),
      })),
    })),
  };
}

function madcow(): SeedProgram {
  const weeks = [0, 2.5, 5, -5];
  return {
    slug: "madcow-5x5",
    nameKo: "Madcow 5x5",
    nameEn: "Madcow 5x5",
    category: "중급 근력",
    completeness: "working",
    descriptionKo:
      "월: 램핑 5×5(탑세트). 수: 라이트 스쿼트 + 프레스 + 데드. 금: 램핑 후 헤비 트리플 + 백오프. 퍼센트는 1RM 기준 실사용 셸입니다.",
    descriptionEn: "Mon/Wed/Fri Madcow ramps with %1RM working weights.",
    sortOrder: 80,
    weeks: weeks.map((bump, wi) => ({
      weekNumber: wi + 1,
      nameKo: wi === 3 ? "4주차 — 라이트" : `${wi + 1}주차`,
      notesKo: "금요일 트리플이 편하면 다음 주 월요일 탑세트를 올린다.",
      days: [
        {
          dayNumber: 1,
          nameKo: "월요일 — 헤비 5×5",
          exercises: [
            {
              exerciseKey: "squat",
              role: "main",
              sets: sets([50, 60, 70, 75, 80].map((p) => p + bump), 5, "1rm", { restSec: 180 }),
            },
            {
              exerciseKey: "bench",
              role: "main",
              sets: sets([50, 60, 70, 75, 80].map((p) => p + bump), 5, "1rm", { restSec: 150 }),
            },
            {
              exerciseKey: "barbell_row",
              role: "main",
              sets: sets([45, 55, 65, 70, 75].map((p) => p + bump), 5, "1rm", { restSec: 120 }),
            },
          ],
        },
        {
          dayNumber: 2,
          nameKo: "수요일 — 라이트",
          exercises: [
            {
              exerciseKey: "squat",
              role: "main",
              notesKo: "월요일 탑의 약 80%",
              sets: sets([40, 50, 60, 65].map((p) => p + bump), 5, "1rm"),
            },
            {
              exerciseKey: "ohp",
              role: "main",
              sets: sets([50, 60, 70, 75].map((p) => p + bump), 5, "1rm"),
            },
            {
              exerciseKey: "deadlift",
              role: "main",
              sets: sets([50, 60, 70, 80].map((p) => p + bump), [5, 5, 5, 5], "1rm", { restSec: 180 }),
            },
          ],
        },
        {
          dayNumber: 3,
          nameKo: "금요일 — 트리플",
          exercises: [
            {
              exerciseKey: "squat",
              role: "main",
              sets: [
                ...sets([50, 60, 70, 75].map((p) => p + bump), 5, "1rm"),
                {
                  setNumber: 5,
                  percentBase: "1rm",
                  percent: 85 + bump,
                  reps: 3,
                  restSec: 180,
                  noteKo: "헤비 트리플",
                },
                {
                  setNumber: 6,
                  percentBase: "1rm",
                  percent: 65 + bump,
                  reps: 8,
                  restSec: 120,
                  noteKo: "백오프",
                },
              ],
            },
            {
              exerciseKey: "bench",
              role: "main",
              sets: [
                ...sets([50, 60, 70, 75].map((p) => p + bump), 5, "1rm"),
                {
                  setNumber: 5,
                  percentBase: "1rm",
                  percent: 85 + bump,
                  reps: 3,
                  restSec: 180,
                  noteKo: "헤비 트리플",
                },
                {
                  setNumber: 6,
                  percentBase: "1rm",
                  percent: 65 + bump,
                  reps: 8,
                  noteKo: "백오프",
                },
              ],
            },
            {
              exerciseKey: "barbell_row",
              role: "main",
              sets: sets([50, 60, 70, 75].map((p) => p + bump), 5, "1rm"),
            },
          ],
        },
      ],
    })),
  };
}

function olympicTemplate(
  slug: string,
  nameKo: string,
  nameEn: string,
  sortOrder: number,
  descriptionKo: string,
  flavor: "takano" | "catalyst" | "torokhtiy" | "lbeb",
): SeedProgram {
  const sn = flavor === "torokhtiy" ? [60, 70, 75] : [55, 65, 70];
  const cj = flavor === "catalyst" ? [60, 70, 75] : [55, 65, 72];
  const sq = flavor === "takano" ? [70, 75, 80] : [65, 70, 75];

  const techDay = (week: number): SeedDay => ({
    dayNumber: 3,
    nameKo: "테크닉 / 라이트",
    notesKo: " incomplete 템플릿 — 코칭 큐만 참고.",
    exercises: [
      {
        exerciseKey: "muscle_snatch",
        role: "technique",
        sets: nSets(4, 40 + week, 3, "1rm", { restSec: 90 }),
      },
      {
        exerciseKey: "power_snatch",
        role: "technique",
        sets: nSets(4, 50 + week, 2, "1rm"),
      },
      {
        exerciseKey: "power_jerk",
        role: "technique",
        sets: nSets(4, 55 + week, 2, "1rm"),
      },
    ],
  });

  return {
    slug,
    nameKo,
    nameEn,
    category: "역도",
    completeness: "template",
    descriptionKo,
    descriptionEn: "Structured week/day Olympic template — incomplete vs a full coaching cycle.",
    sortOrder,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: w === 4 ? "4주차 — 테이퍼 셸" : `${w}주차`,
      notesKo: "템플릿 전용. 볼륨/강도를 개인 코칭에 맞게 수정하세요.",
      days: [
        {
          dayNumber: 1,
          nameKo: "스네치 + 스쿼트",
          notesKo: "불완전 템플릿",
          exercises: [
            {
              exerciseKey: "snatch",
              role: "main",
              sets: sets(
                sn.map((p) => p + (w === 4 ? -10 : w - 1)),
                2,
                "1rm",
                { restSec: 150 },
              ),
            },
            {
              exerciseKey: "ohs",
              role: "main",
              sets: nSets(3, 55 + w, 3, "1rm"),
            },
            {
              exerciseKey: "squat",
              role: "main",
              sets: sets(
                sq.map((p) => p + (w === 4 ? -15 : 0)),
                3,
                "1rm",
              ),
            },
            {
              exerciseKey: "snatch_pull",
              role: "assistance",
              sets: nSets(4, 80, 3, "1rm"),
            },
          ],
        },
        {
          dayNumber: 2,
          nameKo: "클린&저크 + 프론트스쿼트",
          notesKo: "불완전 템플릿",
          exercises: [
            {
              exerciseKey: "clean_jerk",
              role: "main",
              sets: sets(
                cj.map((p) => p + (w === 4 ? -10 : w - 1)),
                [2, 2, 1],
                "1rm",
                { restSec: 180 },
              ),
            },
            {
              exerciseKey: "jerk",
              role: "main",
              sets: nSets(4, 65 + w, 2, "1rm"),
            },
            {
              exerciseKey: "front_squat",
              role: "main",
              sets: nSets(4, 70, 3, "1rm"),
            },
            {
              exerciseKey: "clean_pull",
              role: "assistance",
              sets: nSets(4, 85, 3, "1rm"),
            },
          ],
        },
        techDay(w),
        {
          dayNumber: 4,
          nameKo: flavor === "lbeb" ? "볼륨 / 하이브리드" : "컴페티션 리프트",
          notesKo: "불완전 템플릿",
          exercises: [
            {
              exerciseKey: "power_clean",
              role: "main",
              sets: nSets(5, 60 + w, 2, "1rm"),
            },
            {
              exerciseKey: "push_press",
              role: "main",
              sets: nSets(4, 65, 3, "1rm"),
            },
            {
              exerciseKey: "deadlift",
              role: "main",
              sets: nSets(3, flavor === "lbeb" ? 70 : 60, 5, "1rm"),
            },
          ],
        },
      ],
    })),
  };
}

export function buildSeed(): SeedFile {
  return {
    exercises: EXERCISES,
    programs: [
      wendlerProgram(),
      rehabProgram(),
      dupProgram(),
      juggernautProgram(),
      cowboyProgram(),
      startingStrength(),
      stronglifts(),
      madcow(),
      olympicTemplate(
        "takano",
        "Bob Takano",
        "Bob Takano",
        90,
        "타카노 스타일 주 4일 역도 골격(스네치/C&J/스쿼트/풀). 주·일 구조만 제공하며 완전한 장기 주기화는 아닙니다. 불완전 템플릿으로 표시됩니다.",
        "takano",
      ),
      olympicTemplate(
        "catalyst",
        "Catalyst Athletics",
        "Catalyst Athletics",
        100,
        "Catalyst 스타일 테크닉+컴페티션 리프트 주간 골격. 실제 Catalyst 유료/공개 프로그램의 복제가 아니며 불완전 템플릿입니다.",
        "catalyst",
      ),
      olympicTemplate(
        "torokhtiy",
        "Torokhtiy",
        "Torokhtiy",
        110,
        "토로흐티 스타일의 컴페티션 리프트 중심 주간 골격. 공식 앱/프로그램과 무관하며 불완전 템플릿입니다.",
        "torokhtiy",
      ),
      olympicTemplate(
        "lbeb",
        "LBEB",
        "LBEB",
        120,
        "LBEB 역도/하이브리드 주 4일 골격. 원본 스프레드시트의 세부 파동을 재현하지 않는 불완전 템플릿입니다.",
        "lbeb",
      ),
    ],
  };
}
