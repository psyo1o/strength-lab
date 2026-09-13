import {
  bobTakanoP1,
  catalystP1,
  cowboyP1,
  dailyUndulatingProgram,
  juggernautP1,
  lbebP1,
  rehabP1,
  torokhtiyP1,
} from "./p1-programs";

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
  usesTM?: boolean;
  tmFactor?: number;
  startWeight?: { enabled: boolean };
  progression?: {
    afterEachCycle?: { upperKg: number; lowerKg: number };
  } & Record<string, { addKg?: number; upperKg?: number; lowerKg?: number } | undefined>;
  fridayTriple?: boolean;
  prWeekDefault?: number | null;
  extraOneRmFields?: Record<string, { label: string }>;
  weekRules?: string[];
  coverage?: string;
  copy?: { help?: string };
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

function bodyweight(exerciseKey: string, nameNote: string, setsCount = 3, reps = 10): SeedExercise {
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
      noteKo: "체중 · 밴드 허용",
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
    key: "pause_squat",
    nameKo: "퍼즈 스쿼트",
    nameEn: "Pause Squat",
    group: "assistance",
    isMax: false,
    tipsKo: "하단에서 1–3초 완전히 정지한 뒤 반동 없이 밀어 올린다.",
    tipsEn: "Pause 1–3s at the bottom, then stand without bounce.",
  },
  {
    key: "pin_squat",
    nameKo: "핀 스쿼트",
    nameEn: "Pin Squat",
    group: "assistance",
    isMax: false,
    tipsKo: "핀은 대략 패러렐. 바에 앉아 긴장을 풀지 말고 핀에서 다시 밀어 올린다.",
    tipsEn: "Pins at parallel; stay tight and drive off the pins.",
  },
  {
    key: "deficit_deadlift",
    nameKo: "데피짓 데드리프트",
    nameEn: "Deficit Deadlift",
    group: "assistance",
    isMax: false,
    tipsKo: "2.5–5cm 발판 위에서 더 깊게 세팅한 뒤 다리로 민다.",
    tipsEn: "Stand on a 2.5–5cm deficit and keep a neutral back.",
  },
  {
    key: "spoto_press",
    nameKo: "스포토 프레스",
    nameEn: "Spoto Press",
    group: "assistance",
    isMax: false,
    tipsKo: "바가 가슴에 닿기 1–3cm 앞에서 정지한 뒤 밀어 올린다.",
    tipsEn: "Pause 1–3cm off the chest, then press.",
  },
  {
    key: "floor_press",
    nameKo: "플로어 프레스",
    nameEn: "Floor Press",
    group: "assistance",
    isMax: false,
    tipsKo: "상완이 바닥에 닿을 때까지 내린 뒤 반동 없이 밀어 올린다.",
    tipsEn: "Lower until the upper arm meets the floor, then press.",
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
  {
    key: "close_grip_bench",
    nameKo: "클로즈그립 벤치",
    nameEn: "Close-Grip Bench",
    group: "assistance",
    isMax: false,
    tipsKo: "손은 어깨 안쪽. 팔꿈치가 과도하게 벌어지지 않게.",
    tipsEn: "Hands inside shoulders, elbows tucked.",
  },
  {
    key: "incline_bench",
    nameKo: "인클라인 벤치",
    nameEn: "Incline Bench",
    group: "assistance",
    isMax: false,
    tipsKo: "벤치는 30° 전후. 바가 쇄골~상흉으로.",
    tipsEn: "About 30°, bar to upper chest.",
  },
  {
    key: "stiff_leg_deadlift",
    nameKo: "스티프 레그 데드",
    nameEn: "Stiff-Leg Deadlift",
    group: "assistance",
    isMax: false,
    tipsKo: "무릎은 거의 고정, 힙 힌지로만. 허리가 둥글어지면 즉시 멈춘다.",
    tipsEn: "Soft-locked knees, hinge only, stop if the back rounds.",
  },
  {
    key: "abs",
    nameKo: "복근",
    nameEn: "Abs",
    group: "assistance",
    isMax: false,
    tipsKo: "골반을 말고 갈비뼈를 내린다. 목으로 당기지 말 것.",
    tipsEn: "Posterior tilt, ribs down, do not yank the neck.",
  },
  {
    key: "free_accessory",
    nameKo: "자유 보조",
    nameEn: "Free Accessory",
    group: "assistance",
    isMax: false,
    tipsKo: "약점 부위를 고른다. 통증 있으면 중단.",
    tipsEn: "Pick a weak point. Stop if it hurts.",
  },
  {
    key: "rehab_target",
    nameKo: "재활 목표 동작",
    nameEn: "Rehab target",
    group: "assistance",
    isMax: true,
    tipsKo: "치료/코치가 지정한 목표 동작만. 통증 구간은 하지 않는다.",
    tipsEn: "Only the prescribed target pattern. Skip pain.",
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
      notesKo: "워밍업 — 첫 본세트의 50/60/70/80/90% × 8/5/3/1/1 (바만이면 20kg)",
      sets: sets(
        (() => {
          const first = week === 1 ? 65 : week === 2 ? 70 : week === 3 ? 75 : 40;
          return [0.5, 0.6, 0.7, 0.8, 0.9].map((f) => Number((first * f).toFixed(1)));
        })(),
        [8, 5, 3, 1, 1],
        "tm",
        { restSec: 45 },
      ),
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
      notesKo: "기본 보조: Boring But Big 5×10 @ 50% TM. 시트 보조는 이후 토글.",
      sets: nSets(5, 50, 10, "tm", { restSec: 90 }),
    });
  }

  return {
    dayNumber,
    nameKo,
    notesKo: "메인 리프트는 Training Max(0.9×1RM) 퍼센트입니다.",
    exercises,
  };
}

function wendlerProgram(): SeedProgram {
  const dayDefs = [
    { n: 1, name: "월요일 — 오버헤드프레스", lift: "ohp" },
    { n: 2, name: "화요일 — 데드리프트", lift: "deadlift" },
    { n: 3, name: "목요일 — 벤치프레스", lift: "bench" },
    { n: 4, name: "금요일 — 스쿼트", lift: "squat" },
  ];
  const weekNames = [
    "1주차 — 5s",
    "2주차 — 3s",
    "3주차 — 5/3/1",
    "4주차 — 딜로드",
  ];
  return {
    slug: "jim-wendler-531",
    nameKo: "Jim Wendler 5/3/1 Simplest Strength",
    nameEn: "Jim Wendler 5/3/1 Simplest Strength",
    category: "파워리프팅",
    completeness: "full",
    descriptionKo:
      "Training Max = 0.9×1RM. 월 OHP / 화 데드 / 목 벤치 / 금 스쿼트. 1주 65/75/85%×5, 2주 70/80/90%×3, 3주 75/85/95%(5/3/1), 4주 딜로드. 워밍업 + 기본 보조 BBB 5×10 @ 50% TM. 사이클 후 TM은 상체 +2.5kg / 하체 +5kg.",
    descriptionEn:
      "TM=0.9×1RM. After each 4-week cycle bump TM +2.5kg upper / +5kg lower if the AMRAP was hit.",
    usesTM: true,
    tmFactor: 0.9,
    progression: {
      afterEachCycle: { upperKg: 2.5, lowerKg: 5 },
      ohp: { addKg: 2.5 },
      bench: { addKg: 2.5 },
      squat: { addKg: 5 },
      deadlift: { addKg: 5 },
    },
    sortOrder: 1,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: weekNames[w - 1],
      notesKo:
        w === 4
          ? "가벼운 딜로드. 사이클 후 TM 상체 +2.5kg / 하체 +5kg (AMRAP를 채웠을 때)."
          : "마지막 본세트는 AMRAP.",
      days: dayDefs.map((d) => wendlerDay(d.n, d.name, d.lift, w as 1 | 2 | 3 | 4)),
    })),
  };
}

function rehabProgram(): SeedProgram {
  const delorme = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DeLorme — 10RM(≈75% 1RM)의 50 / 75 / 100% × 10. 통증 구간은 스킵.",
    sets: sets([50, 75, 100], 10, "ten_rm", { restSec: 120 }),
  });
  const dapre = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DAPRE — 3세트 AMRAP로 4세트·다음 세션 중량을 수동 조절 (앱이 자동 증감하지 않음)",
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
        noteKo: "조절 세트 (3세트 0–2회 −2.5 / 3–4 유지 / 5–7 +2.5 / 8+ +5)",
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
      "공개 지식 DeLorme(50/75/100% 10RM ×10)과 DAPRE(50×10 / 75×6 / 100 AMRAP / 조절 세트). 10RM≈75% 1RM. 자동 증감은 없고 노트 규칙으로 수동 조절. 통증 있으면 중단.",
    descriptionEn: "DeLorme and DAPRE using estimated 10RM (75% of 1RM). Manual DAPRE adjustment.",
    sortOrder: 20,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: `${w}주차`,
      notesKo: w > 1 ? "지난주 10RM이 편하면 2.5kg 올려 재추정. 찌릿하면 즉시 중단." : "통증 없는 가동 범위만.",
      days: [
        {
          dayNumber: 1,
          nameKo: "DeLorme 하체",
          notesKo: "스쿼트·RDL 중심 재활 용량.",
          exercises: [
            delorme("squat"),
            delorme("rdl"),
            bodyweight("plank", "코어 — 호흡 유지", 3, 20),
            bodyweight("abs", "복근", 2, 12),
          ],
        },
        {
          dayNumber: 2,
          nameKo: "DAPRE 상체",
          notesKo: "벤치·프레스 용량 테스트. 4세트는 3세트 반복 수로 수동 조절.",
          exercises: [
            dapre("bench"),
            dapre("ohp"),
            bodyweight("face_pull", "견갑 외회전", 3, 15),
            { exerciseKey: "barbell_row", role: "assistance", sets: nSets(3, 50, 10, "1rm", { restSec: 90 }) },
          ],
        },
        {
          dayNumber: 3,
          nameKo: "DeLorme 힌지 / 전면",
          notesKo: "데드·프론트스쿼트 저강도.",
          exercises: [
            delorme("deadlift"),
            delorme("front_squat"),
            bodyweight("back_extension", "후면 체인", 3, 10),
            bodyweight("chin_up", "수직 당기기", 3, 6),
          ],
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

  return {
    slug: "dup",
    nameKo: "일간 파동형 주기화",
    nameEn: "Daily Undulating Periodization",
    category: "주기화",
    completeness: "working",
    descriptionKo:
      "공개 지식 DUP: 같은 주에 비대(4×8)·근력(5×3 AMRAP)·파워(빠른 3s)를 요일로 나눕니다. %1RM, 4주는 회복. 자동 진행·RPE 조절은 없습니다.",
    descriptionEn: "Hypertrophy / strength / power days with %1RM. Approximate public-knowledge DUP.",
    sortOrder: 30,
    weeks: blocks.map((b, wi) => ({
      weekNumber: wi + 1,
      nameKo: wi === 3 ? "4주차 — 회복" : `${wi + 1}주차`,
      notesKo: "컨디션에 따라 본세트 1세트 가감. 파워 데이는 바 속도 우선.",
      days: [
        {
          dayNumber: 1,
          nameKo: "비대 데이",
          notesKo: `${b.h}% 1RM × 8`,
          exercises: [
            { exerciseKey: "squat", role: "main", sets: nSets(4, b.h, 8, "1rm", { restSec: 90 }) },
            { exerciseKey: "bench", role: "main", sets: nSets(4, b.h, 8, "1rm", { restSec: 90 }) },
            { exerciseKey: "barbell_row", role: "assistance", sets: nSets(3, Math.max(45, b.h - 15), 10, "1rm") },
            bodyweight("abs", "복근", 3, 12),
          ],
        },
        {
          dayNumber: 2,
          nameKo: "근력 데이",
          notesKo: `${b.s}% 1RM × 3`,
          exercises: [
            { exerciseKey: "deadlift", role: "main", sets: nSets(5, b.s, 3, "1rm", { lastAmrap: true, restSec: 180 }) },
            { exerciseKey: "ohp", role: "main", sets: nSets(5, b.s, 3, "1rm", { lastAmrap: true, restSec: 180 }) },
            { exerciseKey: "front_squat", role: "assistance", sets: nSets(3, Math.max(50, b.s - 15), 5, "1rm") },
          ],
        },
        {
          dayNumber: 3,
          nameKo: "파워 데이",
          notesKo: `${b.p}% 1RM × 3 — 바 속도를 우선`,
          exercises: [
            { exerciseKey: "power_clean", role: "main", sets: nSets(6, b.p, 3, "1rm", { restSec: 90 }) },
            {
              exerciseKey: "squat",
              role: "main",
              notesKo: "점프 스쿼트 느낌으로 빠르게",
              sets: nSets(5, b.p, 3, "1rm", { restSec: 90 }),
            },
            bodyweight("chin_up", "수직 당기기", 3, 6),
          ],
        },
      ],
    })),
  };
}

function juggernautProgram(): SeedProgram {
  const waves = [
    { label: "10s", rows: [
      { name: "축적", pct: 60, sets: 4, reps: 10, amrap: true },
      { name: "강화", pct: 65, sets: 3, reps: 10, amrap: true },
      { name: "실현", pct: 70, sets: 1, reps: 10, amrap: true },
      { name: "딜로드", pct: 50, sets: 3, reps: 5, amrap: false },
    ]},
    { label: "8s", rows: [
      { name: "축적", pct: 65, sets: 5, reps: 8, amrap: true },
      { name: "강화", pct: 70, sets: 3, reps: 8, amrap: true },
      { name: "실현", pct: 75, sets: 1, reps: 8, amrap: true },
      { name: "딜로드", pct: 50, sets: 3, reps: 5, amrap: false },
    ]},
    { label: "5s", rows: [
      { name: "축적", pct: 75, sets: 6, reps: 5, amrap: true },
      { name: "강화", pct: 80, sets: 4, reps: 5, amrap: true },
      { name: "실현", pct: 85, sets: 1, reps: 5, amrap: true },
      { name: "딜로드", pct: 50, sets: 3, reps: 5, amrap: false },
    ]},
    { label: "3s", rows: [
      { name: "축적", pct: 80, sets: 7, reps: 3, amrap: true },
      { name: "강화", pct: 85, sets: 5, reps: 3, amrap: true },
      { name: "실현", pct: 90, sets: 1, reps: 3, amrap: true },
      { name: "딜로드", pct: 50, sets: 3, reps: 5, amrap: false },
    ]},
  ];
  const days = [
    { n: 1, name: "스쿼트", key: "squat" },
    { n: 2, name: "벤치", key: "bench" },
    { n: 3, name: "데드", key: "deadlift" },
    { n: 4, name: "OHP", key: "ohp" },
  ];
  const assist = (key: string): SeedExercise[] => {
    if (key === "squat") {
      return [
        { exerciseKey: "front_squat", role: "assistance", sets: nSets(3, 50, 8, "1rm") },
        { exerciseKey: "barbell_row", role: "assistance", sets: nSets(4, 50, 8, "1rm") },
      ];
    }
    if (key === "bench") {
      return [
        { exerciseKey: "close_grip_bench", role: "assistance", sets: nSets(3, 55, 8, "1rm") },
        bodyweight("chin_up", "수직 당기기", 3, 8),
      ];
    }
    if (key === "deadlift") {
      return [
        { exerciseKey: "stiff_leg_deadlift", role: "assistance", sets: nSets(3, 50, 8, "1rm") },
        bodyweight("abs", "복근", 3, 12),
      ];
    }
    return [
      { exerciseKey: "incline_bench", role: "assistance", sets: nSets(3, 50, 8, "1rm") },
      bodyweight("pull_up", "수직 당기기", 3, 6),
    ];
  };
  const weeks = waves.flatMap((wave, wi) =>
    wave.rows.map((w, ri) => ({
      weekNumber: wi * 4 + ri + 1,
      nameKo: `${wi * 4 + ri + 1}주차 — ${wave.label} ${w.name}`,
      notesKo: w.amrap
        ? "마지막 세트 AMRAP. 다음 웨이브 용량 가늠용이며 자동 재계산은 없습니다."
        : "가볍게 움직임을 유지.",
      days: days.map((d) => ({
        dayNumber: d.n,
        nameKo: d.name,
        exercises: [
          { exerciseKey: d.key, role: "warmup" as const, sets: sets([40, 50], [5, 5], "1rm", { restSec: 60 }) },
          {
            exerciseKey: d.key,
            role: "main" as const,
            sets: nSets(w.sets, w.pct, w.reps, "1rm", { lastAmrap: w.amrap, restSec: 150 }),
          },
          ...assist(d.key),
        ],
      })),
    })),
  );
  return {
    slug: "juggernaut",
    nameKo: "Juggernaut Method",
    nameEn: "Juggernaut Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "공개 지식 Juggernaut 16주(10s→8s→5s→3s, 각 축적/강화/실현/딜로드). 주 4일 스쿼트/벤치/데드/OHP. AMRAP 재계산·유료 변형은 없습니다.",
    descriptionEn: "16-week 10s/8s/5s/3s waves. Approximate public-knowledge structure, not the paid product.",
    sortOrder: 40,
    weeks,
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
      "공개 지식 주 4일 볼륨(5×5 전후) 스쿼트/벤치/데드/프레스. 4주는 회복. Wendler 원본·시트 변형의 복제가 아닙니다.",
    descriptionEn: "4-day volume 5x5-style shell. Approximate; not a spreadsheet clone.",
    sortOrder: 50,
    weeks: weeks.map((pct, i) => ({
      weekNumber: i + 1,
      nameKo: i === 3 ? "4주차 — 회복" : `${i + 1}주차`,
      notesKo: `${pct}% 1RM 전후 작업.`,
      days: [
        {
          dayNumber: 1,
          nameKo: "스쿼트 볼륨",
          exercises: [
            { exerciseKey: "squat", role: "main", sets: nSets(5, pct, 5, "1rm") },
            { exerciseKey: "front_squat", role: "main", sets: nSets(3, pct - 10, 5, "1rm") },
            { exerciseKey: "barbell_row", role: "assistance", sets: nSets(4, 50, 8, "1rm") },
            bodyweight("lunge", "단측", 3, 8),
          ],
        },
        {
          dayNumber: 2,
          nameKo: "벤치 볼륨",
          exercises: [
            { exerciseKey: "bench", role: "main", sets: nSets(5, pct, 5, "1rm") },
            { exerciseKey: "ohp", role: "main", sets: nSets(3, Math.max(50, pct - 5), 5, "1rm") },
            { exerciseKey: "close_grip_bench", role: "assistance", sets: nSets(3, 55, 8, "1rm") },
            bodyweight("dip", "푸시", 3, 8),
          ],
        },
        {
          dayNumber: 3,
          nameKo: "데드 볼륨",
          exercises: [
            { exerciseKey: "deadlift", role: "main", sets: nSets(3, pct, 5, "1rm") },
            { exerciseKey: "rdl", role: "main", sets: nSets(3, 60, 8, "1rm") },
            bodyweight("back_extension", "후면", 3, 10),
            bodyweight("abs", "복근", 3, 12),
          ],
        },
        {
          dayNumber: 4,
          nameKo: "프레스 + 라이트 스쿼트",
          exercises: [
            { exerciseKey: "ohp", role: "main", sets: nSets(5, Math.max(50, pct - 5), 5, "1rm") },
            { exerciseKey: "squat", role: "main", notesKo: "라이트", sets: nSets(3, 55, 5, "1rm") },
            bodyweight("chin_up", "풀", 3, 8),
            { exerciseKey: "incline_bench", role: "assistance", sets: nSets(3, 50, 8, "1rm") },
          ],
        },
      ],
    })),
  };
}

function startingStrength(): SeedProgram {
  const a = (): SeedDay => ({
    dayNumber: 0,
    nameKo: "Workout A",
    notesKo: "시작중량이 있으면 그 값. 없으면 시트 %1RM. 성공 시 스쿼트 +2.5kg, 데드 +5kg, 벤치 +2.5kg.",
    exercises: [
      { exerciseKey: "squat", role: "main", sets: nSets(3, 80, 5, "1rm", { restSec: 180 }) },
      { exerciseKey: "bench", role: "main", sets: nSets(3, 75, 5, "1rm", { restSec: 150 }) },
      { exerciseKey: "deadlift", role: "main", sets: nSets(1, 80, 5, "1rm", { restSec: 180 }) },
    ],
  });
  const b = (): SeedDay => ({
    dayNumber: 0,
    nameKo: "Workout B",
    notesKo: "시작중량이 있으면 그 값. 성공 시 스쿼트 +2.5kg, 프레스 +2.5kg. 파워클린은 기술 우선.",
    exercises: [
      { exerciseKey: "squat", role: "main", sets: nSets(3, 80, 5, "1rm", { restSec: 180 }) },
      {
        exerciseKey: "ohp",
        role: "main",
        notesKo: "노비스 3×5. 시트 일부 열은 sheetAlt 5×3.",
        sets: nSets(3, 70, 5, "1rm", { restSec: 150 }),
      },
      { exerciseKey: "power_clean", role: "main", sets: nSets(5, 65, 3, "1rm", { restSec: 120 }) },
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
      "A: 스쿼트 3×5 · 벤치 3×5 · 데드 1×5. B: 스쿼트 3×5 · 프레스 3×5(노비스; 시트 일부 열 sheetAlt 5×3) · 파워클린 5×3. 시작중량 필드가 있으면 그 값을 쓰고, 없으면 시트 %1RM(스쿼트·데드 80%, 벤치 75%, OHP 70%). 세션마다 스쿼트 +2.5kg(시트 잠금), 데드 +5kg, 상체 +2.5kg.",
    descriptionEn: "A/B novice LP. Start-weight field wins; sheet %1RM is fallback. Squat +2.5 / dead +5 / upper +2.5 per session.",
    sortOrder: 2,
    startWeight: { enabled: true },
    progression: {
      squat: { addKg: 2.5 },
      bench: { addKg: 2.5 },
      deadlift: { addKg: 5 },
      ohp: { addKg: 2.5 },
      power_clean: { addKg: 2.5 },
    },
    weeks: pattern.map((days, wi) => ({
      weekNumber: wi + 1,
      nameKo: `${wi + 1}주차`,
      notesKo: "주 3회, A/B 교대. 실패 시 중량 유지 후 재시도.",
      days: days.map((kind, di) => {
        const day = kind === "A" ? a() : b();
        return { ...day, dayNumber: di + 1, nameKo: kind === "A" ? "Workout A" : "Workout B" };
      }),
    })),
  };
}

function stronglifts(): SeedProgram {
  const a = (): SeedExercise[] => [
    { exerciseKey: "squat", role: "main", sets: nSets(5, 50, 5, "1rm", { restSec: 180 }) },
    { exerciseKey: "bench", role: "main", sets: nSets(5, 50, 5, "1rm", { restSec: 150 }) },
    { exerciseKey: "barbell_row", role: "main", sets: nSets(5, 50, 5, "1rm", { restSec: 120 }) },
  ];
  const b = (): SeedExercise[] => [
    { exerciseKey: "squat", role: "main", sets: nSets(5, 50, 5, "1rm", { restSec: 180 }) },
    { exerciseKey: "ohp", role: "main", sets: nSets(5, 50, 5, "1rm", { restSec: 150 }) },
    { exerciseKey: "deadlift", role: "main", sets: nSets(1, 50, 5, "1rm", { restSec: 180 }) },
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
      "A: 스쿼트/벤치/로우 5×5. B: 스쿼트/OHP 5×5 + 데드 1×5. 시작중량 필드가 있으면 그 값을 쓰고, 없으면 시트 기준 1RM의 약 50%. 5×5 성공 시 +2.5kg(데드 +5kg).",
    descriptionEn: "A/B 5x5. Start-weight field wins; sheet fallback ~50% 1RM.",
    sortOrder: 3,
    startWeight: { enabled: true },
    progression: {
      squat: { addKg: 2.5 },
      bench: { addKg: 2.5 },
      deadlift: { addKg: 5 },
      ohp: { addKg: 2.5 },
      barbell_row: { addKg: 2.5 },
    },
    weeks: pattern.map((days, wi) => ({
      weekNumber: wi + 1,
      nameKo: `${wi + 1}주차`,
      notesKo: "실패 3회면 10% 딜로드 후 재진행.",
      days: days.map((kind, di) => ({
        dayNumber: di + 1,
        nameKo: kind === "A" ? "Workout A" : "Workout B",
        notesKo: kind === "A" ? "스쿼트 · 벤치 · 로우" : "스쿼트 · 프레스 · 데드",
        exercises: kind === "A" ? a() : b(),
      })),
    })),
  };
}

function madcow(): SeedProgram {
  /** Week-1 top ≈ 80% 1RM. Ramps are 12.5% of that top. Each week ×1.025. */
  const top1rm = 80;
  const pct = (fracOfTop: number, weekIndex: number) =>
    Number((top1rm * fracOfTop * Math.pow(1.025, weekIndex)).toFixed(2));
  const ramp = (fracs: number[], weekIndex: number, reps: number | number[] = 5, restSec = 150) =>
    sets(
      fracs.map((f) => pct(f, weekIndex)),
      reps,
      "1rm",
      { restSec },
    );

  return {
    slug: "madcow-5x5",
    nameKo: "Madcow 5x5",
    nameEn: "Madcow 5x5",
    category: "중급 근력",
    completeness: "working",
    descriptionKo:
      "월: 12.5% 램핑 5×5(탑세트). 수: 라이트 스쿼트 + 프레스 + 데드. 금: 매주 램핑 후 헤비 트리플 + 백오프(10주차만이 아님). 매주 탑 ×1.025. 시작중량이 있으면 탑세트로 사용하고, 없으면 1RM의 약 80%를 1주차 탑으로 둡니다.",
    descriptionEn: "Mon/Wed/Fri Madcow. Week-1 12.5% ramps of top; weekly ×1.025. Start-weight field is the top set.",
    sortOrder: 4,
    startWeight: { enabled: true },
    fridayTriple: true,
    prWeekDefault: null,
    weeks: [0, 1, 2, 3].map((wi) => {
      return {
      weekNumber: wi + 1,
      nameKo: `${wi + 1}주차`,
      notesKo: "금요일 트리플이 편하면 다음 주 월요일 탑이 자연스럽게 오른다(×1.025).",
      days: [
        {
          dayNumber: 1,
          nameKo: "월요일 — 헤비 5×5",
          exercises: [
            {
              exerciseKey: "squat",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 0.875, 1], wi, 5, 180),
            },
            {
              exerciseKey: "bench",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 0.875, 1], wi, 5, 150),
            },
            {
              exerciseKey: "barbell_row",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 0.875, 1], wi, 5, 120),
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
              notesKo: "월요일 탑의 약 80%까지",
              sets: ramp([0.5, 0.6, 0.7, 0.8], wi, 5, 150),
            },
            {
              exerciseKey: "ohp",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 0.875], wi, 5, 150),
            },
            {
              exerciseKey: "deadlift",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 1], wi, 5, 180),
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
                ...ramp([0.5, 0.625, 0.75, 0.875], wi, 5, 180),
                {
                  setNumber: 5,
                  percentBase: "1rm",
                  percent: pct(1.025, wi),
                  reps: 3,
                  restSec: 180,
                  noteKo: "헤비 트리플",
                },
                {
                  setNumber: 6,
                  percentBase: "1rm",
                  percent: pct(0.8, wi),
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
                ...ramp([0.5, 0.625, 0.75, 0.875], wi, 5, 150),
                {
                  setNumber: 5,
                  percentBase: "1rm",
                  percent: pct(1.025, wi),
                  reps: 3,
                  restSec: 180,
                  noteKo: "헤비 트리플",
                },
                {
                  setNumber: 6,
                  percentBase: "1rm",
                  percent: pct(0.8, wi),
                  reps: 8,
                  restSec: 120,
                  noteKo: "백오프",
                },
              ],
            },
            {
              exerciseKey: "barbell_row",
              role: "main",
              sets: ramp([0.5, 0.625, 0.75, 0.875], wi, 5, 120),
            },
          ],
        },
      ],
    };
    }),
  };
}

function olympicBlock(
  slug: string,
  nameKo: string,
  nameEn: string,
  sortOrder: number,
  descriptionKo: string,
  flavor: "takano" | "catalyst" | "torokhtiy" | "lbeb",
): SeedProgram {
  const sn = flavor === "torokhtiy" ? [60, 70, 78] : flavor === "catalyst" ? [55, 65, 72] : [55, 65, 72];
  const cj = flavor === "catalyst" ? [60, 70, 78] : flavor === "takano" ? [55, 65, 75] : [55, 65, 72];
  const sq = flavor === "takano" ? [70, 78, 85] : flavor === "torokhtiy" ? [70, 78, 85] : [65, 72, 80];
  const pull = flavor === "torokhtiy" ? 95 : flavor === "takano" ? 90 : 85;
  const deadPct = flavor === "lbeb" ? 70 : 55;
  const bump = (week: number, base: number[], taper: number) =>
    base.map((p) => p + (week === 4 ? -taper : (week - 1) * 2));

  return {
    slug,
    nameKo,
    nameEn,
    category: "역도",
    completeness: "working",
    descriptionKo,
    descriptionEn: "4-week public-knowledge Olympic block. Approximate — not an official coaching cycle.",
    sortOrder,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: w === 4 ? "4주차 — 테이퍼" : `${w}주차`,
      notesKo:
        w === 4
          ? "테이퍼. 공식 장기 주기화가 아니며 퍼센트는 공개 지식 근사입니다."
          : "워밍업 후 메인. 공식 코칭 사이클이 아닌 공개 지식 골격입니다.",
      days: [
        {
          dayNumber: 1,
          nameKo: "스네치 + 스쿼트",
          notesKo: flavor === "torokhtiy" ? "스네치 강도 강조" : "스네치 경로 + 백스쿼트",
          exercises: [
            { exerciseKey: "snatch", role: "warmup", sets: sets([40, 50], [3, 2], "1rm", { restSec: 60 }) },
            {
              exerciseKey: "snatch",
              role: "main",
              sets: sets(bump(w, sn, 10), 2, "1rm", { restSec: 150 }),
            },
            { exerciseKey: "ohs", role: "main", sets: nSets(3, 50 + w * 2, 3, "1rm") },
            { exerciseKey: "squat", role: "main", sets: sets(bump(w, sq, 12), 3, "1rm") },
            { exerciseKey: "snatch_pull", role: "assistance", sets: nSets(4, pull, 3, "1rm") },
          ],
        },
        {
          dayNumber: 2,
          nameKo: "클린&저크 + 프론트스쿼트",
          notesKo: flavor === "catalyst" ? "C&J 테크닉 강조" : "컴페티션 리프트",
          exercises: [
            { exerciseKey: "clean_jerk", role: "warmup", sets: sets([40, 50], [2, 1], "1rm", { restSec: 75 }) },
            {
              exerciseKey: "clean_jerk",
              role: "main",
              sets: sets(bump(w, cj, 10), [2, 2, 1], "1rm", { restSec: 180 }),
            },
            { exerciseKey: "jerk", role: "main", sets: nSets(4, 62 + w * 2, 2, "1rm") },
            { exerciseKey: "front_squat", role: "main", sets: nSets(4, flavor === "takano" ? 75 : 70, 3, "1rm") },
            { exerciseKey: "clean_pull", role: "assistance", sets: nSets(4, pull, 3, "1rm") },
          ],
        },
        {
          dayNumber: 3,
          nameKo: "테크닉 / 라이트",
          notesKo: "가벼운 전환 드릴. 속도 우선.",
          exercises: [
            { exerciseKey: "muscle_snatch", role: "technique", sets: nSets(4, 38 + w, 3, "1rm", { restSec: 90 }) },
            { exerciseKey: "power_snatch", role: "technique", sets: nSets(4, 50 + w, 2, "1rm") },
            { exerciseKey: "power_jerk", role: "technique", sets: nSets(4, 55 + w, 2, "1rm") },
            { exerciseKey: "push_press", role: "assistance", sets: nSets(3, 60, 3, "1rm") },
            bodyweight("abs", "복근", 3, 12),
          ],
        },
        {
          dayNumber: 4,
          nameKo: flavor === "lbeb" ? "볼륨 / 하이브리드" : "파워 + 풀",
          notesKo: flavor === "lbeb" ? "데드·하이브리드 볼륨" : "파워 변형 + 경량 데드",
          exercises: [
            { exerciseKey: "power_clean", role: "main", sets: nSets(5, 58 + w, 2, "1rm") },
            { exerciseKey: "power_snatch", role: "main", sets: nSets(4, 55 + w, 2, "1rm") },
            { exerciseKey: "push_press", role: "main", sets: nSets(4, 65, 3, "1rm") },
            { exerciseKey: "deadlift", role: "main", sets: nSets(3, deadPct, flavor === "lbeb" ? 5 : 3, "1rm") },
            bodyweight("chin_up", "수직 당기기", 3, 6),
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
      rehabP1(),
      dailyUndulatingProgram(),
      juggernautP1(),
      cowboyP1(),
      startingStrength(),
      stronglifts(),
      madcow(),
      bobTakanoP1(),
      catalystP1(),
      torokhtiyP1(),
      lbebP1(),
    ],
  };
}
