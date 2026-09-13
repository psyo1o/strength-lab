import type { SeedDay, SeedExercise, SeedProgram, SeedSet } from "./catalog";

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

/** 50/60/70/80/90% of first work × 8/5/3/1/1 */
function workWarmup(workPct: number, key: string, base: SeedSet["percentBase"] = "1rm"): SeedExercise {
  return {
    exerciseKey: key,
    role: "warmup",
    notesKo: "워밍업 사다리 — 작업중량의 50/60/70/80/90% × 8/5/3/1/1",
    sets: sets(
      [0.5, 0.6, 0.7, 0.8, 0.9].map((f) => Number((workPct * f).toFixed(1))),
      [8, 5, 3, 1, 1],
      base,
      { restSec: 45 },
    ),
  };
}

export function dailyUndulatingProgram(): SeedProgram {
  const phases = [
    { name: "비대", work: 70, sets: 4, reps: 8, amrap: false },
    { name: "근력", work: 85, sets: 5, reps: 3, amrap: true },
    { name: "피킹", work: 90, sets: 3, reps: 2, amrap: true },
  ];
  const weekDays = (work: number, hypertrophy: boolean): SeedDay[] => {
    const main = (key: string, extra?: string): SeedExercise[] => [
      workWarmup(work, key),
      {
        exerciseKey: key,
        role: "main",
        notesKo: extra,
        sets: nSets(hypertrophy ? 4 : work >= 90 ? 3 : 5, work, hypertrophy ? 8 : work >= 90 ? 2 : 3, "1rm", {
          lastAmrap: !hypertrophy,
          restSec: hypertrophy ? 90 : 180,
        }),
      },
    ];
    return [
      { dayNumber: 1, nameKo: "월요일 — 스쿼트", exercises: [...main("squat"), { exerciseKey: "barbell_row", role: "assistance", sets: nSets(3, 55, 10, "1rm") }] },
      { dayNumber: 2, nameKo: "화요일 — 벤치", exercises: [...main("bench"), { exerciseKey: "close_grip_bench", role: "assistance", sets: nSets(3, 55, 8, "1rm") }] },
      { dayNumber: 3, nameKo: "수요일 — 데드", exercises: [...main("deadlift"), { exerciseKey: "rdl", role: "assistance", sets: nSets(3, 55, 8, "1rm") }] },
      { dayNumber: 4, nameKo: "목요일 — 프론트스쿼트", exercises: [...main("front_squat"), bodyweight("abs", "복근", 3, 12)] },
      { dayNumber: 5, nameKo: "금요일 — OHP", exercises: [...main("ohp"), bodyweight("chin_up", "수직 당기기", 3, 8)] },
      { dayNumber: 6, nameKo: "토요일 — 파워클린", exercises: [...main("power_clean", "속도 우선"), bodyweight("pull_up", "풀업", 3, 6)] },
    ];
  };
  return {
    slug: "daily-undulating",
    nameKo: "일간 파동형 주기화",
    nameEn: "Daily Undulating Periodization",
    category: "주기화",
    completeness: "working",
    descriptionKo:
      "기본 국면은 비대(월–토). 근력·피킹은 프로그램 화면에서 고릅니다. extra 1RM: 프론트스쿼트·파워클린. 공개 지식 근사 — RPE 자동 진행 없음.",
    descriptionEn: "Default hypertrophy Mon–Sat. Strength/peaking via phase picker. Approximate.",
    extraOneRmFields: { front_squat: { label: "프론트 스쿼트" }, power_clean: { label: "파워클린" } },
    copy: {
      help: "3 메소사이클 × 4주(비대 → 근력 → 피킹). 각 4주차는 회복(작업중량 −10%p). extra 1RM: 프론트스쿼트·파워클린. RPE 자동 진행 없음.",
    },
    sortOrder: 30,
    weeks: phases.flatMap((ph, pi) =>
      [0, 1, 2, 3].map((off) => ({
        weekNumber: pi * 4 + off + 1,
        nameKo: `${pi * 4 + off + 1}주차 — ${ph.name}${off === 3 ? " 회복" : ""}`,
        notesKo:
          off === 3
            ? `${ph.name} 회복. 작업중량 −10%p.`
            : `${ph.name} 국면. 워밍업 사다리는 작업중량의 50–90%.`,
        days: weekDays(off === 3 ? ph.work - 10 : ph.work + off * 2.5, ph.name === "비대"),
      })),
    ),
  };
}

function restDay(dayNumber: number, nameKo: string): SeedDay {
  return { dayNumber, nameKo, notesKo: "휴식", exercises: [] };
}

export function juggernautP1(): SeedProgram {
  const waves = [
    { label: "10s", acc: { pct: 60, sets: 5, reps: 10 }, int: { pct: 67.5, sets: 3, reps: 10 }, realTop: 75 },
    { label: "8s", acc: { pct: 65, sets: 5, reps: 8 }, int: { pct: 72.5, sets: 3, reps: 8 }, realTop: 80 },
    { label: "5s", acc: { pct: 75, sets: 6, reps: 5 }, int: { pct: 80, sets: 4, reps: 5 }, realTop: 87.5 },
    { label: "3s", acc: { pct: 80, sets: 7, reps: 3 }, int: { pct: 85, sets: 5, reps: 3 }, realTop: 92.5 },
  ];
  const lifts = [
    { n: 1, name: "월요일 — 스쿼트", key: "squat" },
    { n: 3, name: "수요일 — 벤치", key: "bench" },
    { n: 5, name: "금요일 — 데드", key: "deadlift" },
    { n: 6, name: "토요일 — OHP", key: "ohp" },
  ];
  const assist = (key: string): SeedExercise[] => {
    if (key === "squat") return [{ exerciseKey: "front_squat", role: "assistance", sets: nSets(3, 50, 8, "1rm") }, { exerciseKey: "barbell_row", role: "assistance", sets: nSets(4, 50, 8, "1rm") }];
    if (key === "bench") return [{ exerciseKey: "close_grip_bench", role: "assistance", sets: nSets(3, 55, 8, "1rm") }, bodyweight("chin_up", "친업", 3, 8)];
    if (key === "deadlift") return [{ exerciseKey: "stiff_leg_deadlift", role: "assistance", sets: nSets(3, 50, 8, "1rm") }, bodyweight("abs", "복근", 3, 12)];
    return [{ exerciseKey: "incline_bench", role: "assistance", sets: nSets(3, 50, 8, "1rm") }, bodyweight("pull_up", "풀업", 3, 6)];
  };
  const kindRow = (kind: "acc" | "int" | "real" | "deload", wave: (typeof waves)[number]) => {
    if (kind === "acc") return { name: "축적", pct: wave.acc.pct, count: wave.acc.sets, reps: wave.acc.reps, amrap: true, ramp: false };
    if (kind === "int") return { name: "강화", pct: wave.int.pct, count: wave.int.sets, reps: wave.int.reps, amrap: true, ramp: false };
    if (kind === "real") return { name: "실현", pct: wave.realTop, count: 1, reps: wave.acc.reps, amrap: true, ramp: true };
    return { name: "딜로드", pct: 60, count: 3, reps: 5, amrap: false, ramp: false };
  };
  const kinds = ["acc", "int", "real", "deload"] as const;
  const liftDay = (d: (typeof lifts)[number], row: ReturnType<typeof kindRow>): SeedDay => ({
    dayNumber: d.n,
    nameKo: d.name,
    exercises: [
      workWarmup(row.ramp ? 50 : row.pct, d.key),
      {
        exerciseKey: d.key,
        role: "main",
        sets: row.ramp
          ? sets([50, 60, 67.5, row.pct], [5, 3, 2, row.reps], "1rm", { lastAmrap: true, restSec: 180 })
          : nSets(row.count, row.pct, row.reps, "1rm", { lastAmrap: row.amrap, restSec: 150 }),
      },
      ...assist(d.key),
    ],
  });
  return {
    slug: "juggernaut",
    nameKo: "Juggernaut Method",
    nameEn: "Juggernaut Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "16주 월/수/금/토. 10s→8s→5s→3s Acc/Int/Real/Deload. 실현 주 AMRAP는 시트 공식으로 1RM을 갱신. 피킹 블록은 W16 이후 노트.",
    descriptionEn: "16-week waves Mon/Wed/Fri/Sat plus peaking notes after W16.",
    coverage: "w1-16_full_sets_plus_peaking",
    copy: {
      help: "16주 웨이브(10s/8s/5s/3s) 후 피킹 5주는 시트/코치 블록. 실현 주 AMRAP만 1RM을 자동 갱신합니다.",
    },
    weekRules: [
      ...waves.flatMap((wave, wi) =>
        kinds.map((kind, ki) => `W${wi * 4 + ki + 1}: ${wave.label} ${kindRow(kind, wave).name}`),
      ),
      "peakingBlock: W16 이후 피킹 5주는 시트/코치 블록. 앱은 realizationMaxHook만 자동.",
    ],
    sortOrder: 40,
    weeks: waves.flatMap((wave, wi) =>
      kinds.map((kind, ki) => {
        const row = kindRow(kind, wave);
        return {
          weekNumber: wi * 4 + ki + 1,
          nameKo: `${wi * 4 + ki + 1}주차 — ${wave.label} ${row.name}`,
          notesKo: row.amrap ? "마지막 AMRAP. 실현 주면 시트 공식으로 1RM 갱신." : "딜로드 60% × 3×5.",
          days: [
            liftDay(lifts[0], row),
            restDay(2, "화요일 — 휴식"),
            liftDay(lifts[1], row),
            restDay(4, "목요일 — 휴식"),
            liftDay(lifts[2], row),
            liftDay(lifts[3], row),
          ],
        };
      }),
    ),
  };
}

/** Parent cowboy gzip (CRC-truncated stream; 13 weeks + weekRules intact). */
type CowboyWeekRule = {
  week: number;
  label?: string;
  mon?: { pct: number; reps?: number; sets?: number };
  wed?: { pcts: number[]; reps?: number };
  fri: string;
};

const COWBOY_WEEK_RULES: CowboyWeekRule[] = [
  { week: 1, mon: { pct: 60, reps: 5, sets: 10 }, wed: { pcts: [55, 60, 65, 70, 75], reps: 5 }, fri: "to_10RM" },
  { week: 2, mon: { pct: 67.5, reps: 4, sets: 10 }, wed: { pcts: [60, 65, 70, 75, 80], reps: 3 }, fri: "to_8RM" },
  { week: 3, mon: { pct: 75, reps: 3, sets: 10 }, wed: { pcts: [65, 70, 75, 80, 85], reps: 3 }, fri: "to_5RM" },
  { week: 4, label: "deload", mon: { pct: 60 }, wed: { pcts: [60] }, fri: "squat_walkout_hold" },
  { week: 5, mon: { pct: 65, reps: 4, sets: 8 }, wed: { pcts: [60, 67.5, 75, 82.5] }, fri: "to_8RM" },
  { week: 6, mon: { pct: 72.5, reps: 3, sets: 8 }, wed: { pcts: [65, 72.5, 80, 87.5] }, fri: "to_5RM" },
  { week: 7, mon: { pct: 80, reps: 2, sets: 8 }, wed: { pcts: [70, 77.5, 85, 92.5] }, fri: "to_3RM" },
  { week: 8, label: "deload", mon: { pct: 65 }, wed: { pcts: [65] }, fri: "squat_walkout_105pct" },
  { week: 9, mon: { pct: 70, reps: 3, sets: 5 }, wed: { pcts: [65, 75, 85] }, fri: "to_5RM" },
  { week: 10, mon: { pct: 77.5, reps: 2, sets: 5 }, wed: { pcts: [70, 80, 90] }, fri: "to_3RM" },
  { week: 11, mon: { pct: 85, reps: 1, sets: 5 }, wed: { pcts: [75, 85, 95] }, fri: "to_2RM" },
  { week: 12, label: "deload", mon: { pct: 70 }, wed: { pcts: [70] }, fri: "squat_walkout_105pct" },
  { week: 13, label: "test", fri: "1RM_test" },
];

/** Parent warmup percents keep two decimals (67.5×0.5 = 33.75, not 33.8). */
function cowboyWarmup(workPct: number, key: string): SeedExercise {
  return {
    exerciseKey: key,
    role: "warmup",
    notesKo: "워밍업 사다리 — 작업중량의 50/60/70/80/90% × 8/5/3/1/1",
    sets: sets(
      [0.5, 0.6, 0.7, 0.8, 0.9].map((f) => Number((workPct * f).toFixed(2))),
      [8, 5, 3, 1, 1],
      "1rm",
      { restSec: 45 },
    ),
  };
}

function cowboyFriday(fri: string): { nameKo: string; notesKo: string; warmupPct?: number; sets: SeedSet[] } {
  const rm = /^to_(\d+)RM$/.exec(fri);
  if (rm) {
    const n = Number(rm[1]);
    const work = sets([50, 60, 70, 80, 85, 90], n, "1rm", { lastAmrap: true, restSec: 150 }).map((s, i, arr) =>
      i === arr.length - 1 ? { ...s, noteKo: `guided toward ${n}RM` } : s,
    );
    return { nameKo: `금요일 — 스쿼트 → ${n}RM`, notesKo: `work: ${fri}`, warmupPct: 70, sets: work };
  }
  if (fri === "squat_walkout_hold") {
    return { nameKo: "금요일 — 스쿼트 워크아웃 홀드", notesKo: `work: ${fri}`, sets: nSets(1, 100, 1, "1rm") };
  }
  if (fri === "squat_walkout_105pct") {
    return { nameKo: "금요일 — 스쿼트 워크아웃 홀드", notesKo: `work: ${fri}`, sets: nSets(1, 105, 1, "1rm") };
  }
  return {
    nameKo: "금요일 — 1RM 테스트",
    notesKo: `work: ${fri}`,
    warmupPct: 85,
    sets: sets([70, 80, 90, 95, 100], 1, "1rm"),
  };
}

export function cowboyP1(): SeedProgram {
  const ruleLine = (r: CowboyWeekRule) => {
    const mon = r.mon
      ? r.mon.sets && r.mon.reps
        ? `월 ${r.mon.pct}% ${r.mon.sets}×${r.mon.reps}`
        : `월 ${r.mon.pct}% 딜로드 마커`
      : "월 휴식";
    const wed = r.wed ? `수 FS ${r.wed.pcts.join("/")}` : "수 휴식";
    return `W${r.week}${r.label ? ` ${r.label}` : ""}: ${mon} · ${wed} · 금 ${r.fri}`;
  };
  return {
    slug: "cowboy",
    nameKo: "Cowboy Method",
    nameEn: "Cowboy Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "13주 × 6일. 월 백스쿼트 볼륨, 수 프론트 래더, 금 가이드 RM. 화/목/토 휴식. extra 1RM: 프론트스쿼트.",
    descriptionEn: "13 weeks × 6 days from parent weekRules. Mon squat / Wed FS / Fri guided RM.",
    coverage: "w1-13_full_sets",
    extraOneRmFields: { front_squat: { label: "프론트 스쿼트" } },
    copy: {
      help: "13주 카우보이(Big Texas). 월 볼륨 스쿼트, 수 프론트, 금은 to_nRM 가이드. 화/목/토 휴식.",
    },
    weekRules: COWBOY_WEEK_RULES.map(ruleLine),
    sortOrder: 50,
    weeks: COWBOY_WEEK_RULES.map((r) => {
      const deload = r.label === "deload";
      const testWeek = r.label === "test";
      const monReps = r.mon?.reps;
      const wedReps = r.wed?.reps ?? 5;
      const monPct = r.mon?.pct;
      const wedPcts = r.wed?.pcts ?? [];
      const fri = cowboyFriday(r.fri);
      return {
        weekNumber: r.week,
        nameKo: r.label ? `${r.week}주차 — ${r.label}` : `${r.week}주차`,
        notesKo: ruleLine(r),
        days: [
          !testWeek && monPct != null
            ? {
                dayNumber: 1,
                nameKo: "월요일 — 스쿼트 볼륨",
                exercises: [
                  cowboyWarmup(monPct, "squat"),
                  {
                    exerciseKey: "squat",
                    role: "main" as const,
                    notesKo: deload ? "딜로드 마커" : undefined,
                    sets: deload ? nSets(3, monPct, 3, "1rm") : nSets(r.mon!.sets ?? 1, monPct, monReps ?? 5, "1rm"),
                  },
                ],
              }
            : restDay(1, "월요일 — 휴식"),
          restDay(2, "화요일 — 휴식"),
          !testWeek && wedPcts.length
            ? {
                dayNumber: 3,
                nameKo: "수요일 — 프론트스쿼트",
                notesKo: deload ? "딜로드 마커" : `FS ${wedPcts.join("→")} ×${wedReps}`,
                exercises: [
                  cowboyWarmup(wedPcts[0], "front_squat"),
                  {
                    exerciseKey: "front_squat",
                    role: "main" as const,
                    sets: deload ? nSets(1, wedPcts[0], 3, "1rm") : sets(wedPcts, wedReps, "1rm"),
                  },
                ],
              }
            : restDay(3, "수요일 — 휴식"),
          restDay(4, "목요일 — 휴식"),
          {
            dayNumber: 5,
            nameKo: fri.nameKo,
            notesKo: fri.notesKo,
            exercises: [
              ...(fri.warmupPct != null ? [cowboyWarmup(fri.warmupPct, "squat")] : []),
              { exerciseKey: "squat", role: "main" as const, notesKo: fri.notesKo, sets: fri.sets },
            ],
          },
          restDay(6, "토요일 — 휴식"),
        ],
      };
    }),
  };
}

export function rehabP1(): SeedProgram {
  const delorme = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DeLorme — 10RM의 50/75/100% × 10. 조절은 2.5kg 단위.",
    sets: sets([50, 75, 100], 10, "ten_rm", { restSec: 120 }),
  });
  const dapre = (key: string): SeedExercise => ({
    exerciseKey: key,
    role: "main",
    notesKo: "DAPRE — Knight 기본 50%×10 / 75%×6 / 100% AMRAP. 12@50/8@75는 라벨 변형만(기본 아님).",
    sets: [
      { setNumber: 1, percentBase: "ten_rm", percent: 50, reps: 10, restSec: 120, noteKo: "Knight 워밍 10@50%" },
      { setNumber: 2, percentBase: "ten_rm", percent: 75, reps: 6, restSec: 120, noteKo: "Knight 워밍 6@75%" },
      { setNumber: 3, percentBase: "ten_rm", percent: 100, reps: 6, amrap: true, restSec: 180, noteKo: "AMRAP 후 ±2.5kg" },
    ],
  });
  return {
    slug: "rehab",
    nameKo: "재활 (DeLorme / DAPRE)",
    nameEn: "Rehab — DeLorme / DAPRE",
    category: "재활",
    completeness: "working",
    descriptionKo:
      "W1 DeLorme 50/75/100% 10RM×10, DAPRE Knight 50×10 / 75×6 / 100 AMRAP. 목표 동작은 재활 목표 동작. 증감 2.5kg 수동.",
    descriptionEn: "DeLorme + DAPRE (Knight 10@50 / 6@75) on 10RM. 2.5kg steps.",
    extraOneRmFields: { rehab_target: { label: "재활 목표 동작" } },
    sortOrder: 20,
    weeks: [1, 2, 3, 4, 5, 6, 7, 8].map((w) => ({
      weekNumber: w,
      nameKo: `${w}주차`,
      notesKo:
        w === 1
          ? "통증 없는 가동 범위만. DeLorme 8주 + DAPRE Knight 기본."
          : w <= 4
            ? "10RM이 편하면 +2.5kg 재추정."
            : `후반 ${w}주차. 10RM이 편하면 +2.5kg. Knight DAPRE는 12/8 변형이 아님.`,
      days: [
        {
          dayNumber: 1,
          nameKo: "DeLorme",
          exercises: [delorme("rehab_target"), delorme("squat"), bodyweight("plank", "코어", 3, 20)],
        },
        {
          dayNumber: 2,
          nameKo: "DAPRE",
          exercises: [dapre("rehab_target"), dapre("bench"), bodyweight("face_pull", "견갑", 3, 15)],
        },
        {
          dayNumber: 3,
          nameKo: "DeLorme 힌지",
          exercises: [delorme("deadlift"), bodyweight("back_extension", "후면", 3, 10)],
        },
      ],
    })),
  };
}

function olympicWeek1Days(flavor: "takano" | "catalyst" | "torokhtiy" | "lbeb", week: number): SeedDay[] {
  const sn = flavor === "torokhtiy" ? [60, 70, 78] : [55, 65, 72];
  const cj = flavor === "catalyst" ? [60, 70, 78] : [55, 65, 75];
  const sq = flavor === "takano" ? [70, 78, 85] : [65, 72, 80];
  const bump = (base: number[]) => base.map((p) => p + Math.max(0, week - 1));
  const fiveDay = flavor === "torokhtiy";
  const days: SeedDay[] = [
    {
      dayNumber: 1,
      nameKo: "월요일 — 스네치",
      exercises: [
        workWarmup(sn[0], "snatch"),
        { exerciseKey: "snatch", role: "main", sets: sets(bump(sn), 2, "1rm", { restSec: 150 }) },
        { exerciseKey: "ohs", role: "main", sets: nSets(3, 55, 3, "1rm") },
        { exerciseKey: "snatch_pull", role: "assistance", sets: nSets(4, 85, 3, "1rm") },
      ],
    },
    {
      dayNumber: 2,
      nameKo: "화요일 — 클린&저크",
      exercises: [
        workWarmup(cj[0], "clean_jerk"),
        { exerciseKey: "clean_jerk", role: "main", sets: sets(bump(cj), [2, 2, 1], "1rm", { restSec: 180 }) },
        { exerciseKey: "front_squat", role: "main", sets: nSets(4, flavor === "takano" ? 75 : 70, 3, "1rm") },
        { exerciseKey: "clean_pull", role: "assistance", sets: nSets(4, 85, 3, "1rm") },
      ],
    },
    {
      dayNumber: 3,
      nameKo: fiveDay ? "수요일 — 테크닉" : "수요일 — 테크닉 / 라이트",
      exercises: [
        { exerciseKey: "muscle_snatch", role: "technique", sets: nSets(4, 40, 3, "1rm") },
        { exerciseKey: "power_snatch", role: "technique", sets: nSets(4, 55, 2, "1rm") },
        { exerciseKey: "power_jerk", role: "technique", sets: nSets(4, 58, 2, "1rm") },
        bodyweight("abs", "복근", 3, 12),
      ],
    },
    {
      dayNumber: 4,
      nameKo: fiveDay ? "목요일 — 스쿼트" : flavor === "lbeb" ? "목요일 — 하이브리드" : "목요일 — 스쿼트/풀",
      exercises: [
        workWarmup(sq[0], "squat"),
        { exerciseKey: "squat", role: "main", sets: sets(bump(sq), 3, "1rm") },
        { exerciseKey: "deadlift", role: "main", sets: nSets(3, flavor === "lbeb" ? 70 : 55, flavor === "lbeb" ? 5 : 3, "1rm") },
        bodyweight("chin_up", "친업", 3, 6),
      ],
    },
  ];
  if (fiveDay) {
    days.push({
      dayNumber: 5,
      nameKo: "금요일 — 파워",
      exercises: [
        { exerciseKey: "power_clean", role: "main", sets: nSets(5, 60, 2, "1rm") },
        { exerciseKey: "push_press", role: "main", sets: nSets(4, 65, 3, "1rm") },
        bodyweight("abs", "복근", 3, 12),
      ],
    });
  }
  return days;
}

export function bobTakanoP1(): SeedProgram {
  const classes = [
    { id: "III", label: "Class III", add: 0 },
    { id: "II", label: "Class II", add: 5 },
    { id: "I", label: "Class I", add: 10 },
  ];
  return {
    slug: "bob-takano",
    nameKo: "Bob Takano",
    nameEn: "Bob Takano",
    category: "역도",
    completeness: "working",
    coverage: "seeded_sample_not_full_cycle",
    copy: {
      help: "Class III·II·I 시드 주(각 4주, 총 12주)는 세션이 열려 진행 가능합니다. 유료 엑셀 Class III 8 / II 9 / I 12 그리드는 이 저장소에 없습니다.",
    },
    descriptionKo:
      "Class III·II·I 시드 주(각 4주, 총 12주)는 세션이 열려 진행 가능합니다. 유료 엑셀 8/9/12주 그리드는 이 저장소에 없으며 퍼센트는 공개 지식 근사입니다.",
    descriptionEn: "12 seeded class weeks are usable. Paid Excel Class III 8 / II 9 / I 12 grids are not in this repo.",
    sortOrder: 90,
    weeks: classes.flatMap((cl, ci) =>
      [1, 2, 3, 4].map((off) => ({
        weekNumber: ci * 4 + off,
        nameKo: `${ci * 4 + off}주차 — ${cl.label}`,
        notesKo: `${cl.label}. 클래스 피커로 이동. 퍼센트는 공개 지식 근사.`,
        days: olympicWeek1Days("takano", off).map((d) => ({
          ...d,
          exercises: d.exercises.map((ex) => ({
            ...ex,
            sets: ex.sets.map((s) =>
              s.percent != null ? { ...s, percent: Number((s.percent + cl.add).toFixed(1)) } : s,
            ),
          })),
        })),
      })),
    ),
  };
}

export function catalystP1(): SeedProgram {
  return {
    slug: "catalyst",
    nameKo: "Catalyst Athletics",
    nameEn: "Catalyst Athletics",
    category: "역도",
    completeness: "working",
    coverage: "seeded_sample_not_full_cycle",
    copy: {
      help: "12주 세션이 시드되어 진행 가능합니다. 공식 기본+스페셜티 엑셀 블록은 이 저장소에 없습니다.",
    },
    descriptionKo:
      "12주 세션이 시드되어 진행 가능합니다. 공식 기본+스페셜티 엑셀 블록은 이 저장소에 없으며 퍼센트는 공개 지식 근사입니다.",
    descriptionEn: "12 seeded weeks are usable. Official Catalyst base + specialty Excel blocks are not in this repo.",
    sortOrder: 100,
    weeks: Array.from({ length: 12 }, (_, i) => ({
      weekNumber: i + 1,
      nameKo: `${i + 1}주차 — 기본`,
      notesKo: i === 0 ? "시드 샘플 W1. 공식 12주 블록 아님." : `시드 샘플 ${i + 1}주차. 작업중량 +${i}%p. 공식 파동 아님.`,
      days: olympicWeek1Days("catalyst", i + 1),
    })),
  };
}

export function torokhtiyP1(): SeedProgram {
  return {
    slug: "torokhtiy",
    nameKo: "Torokhtiy",
    nameEn: "Torokhtiy",
    category: "역도",
    completeness: "working",
    copy: {
      help: "13주 월–금 세션이 시드되어 진행 가능합니다. 공식 Torokhtiy 앱 사이클은 아닙니다.",
    },
    descriptionKo: "13주 월–금 세션이 시드되어 진행 가능합니다. W2–13은 같은 골격에 주당 +1%p. 공식 앱과 무관.",
    descriptionEn: "13 seeded Mon–Fri weeks are usable. Not the official Torokhtiy app cycle.",
    sortOrder: 110,
    weeks: Array.from({ length: 13 }, (_, i) => ({
      weekNumber: i + 1,
      nameKo: i === 0 ? "1주차 — 월–금" : `${i + 1}주차`,
      notesKo: i === 0 ? "토로흐티 스타일 5일. 공개 지식 근사." : `W${i + 1} — W1 골격 유지, 강도 +${i}%p. 상세 파동은 노트만.`,
      days: olympicWeek1Days("torokhtiy", i + 1),
    })),
  };
}

/** Expand published NxR@P% lines. Do not invent percents. */
function expandPct(
  parts: Array<[count: number, reps: number, percent: number]>,
  restSec: number,
): SeedSet[] {
  const out: SeedSet[] = [];
  for (const [count, reps, percent] of parts) {
    for (let i = 0; i < count; i++) {
      out.push({
        setNumber: out.length + 1,
        percentBase: "1rm",
        percent,
        reps,
        restSec,
      });
    }
  }
  return out;
}

function pctEx(
  exerciseKey: string,
  parts: Array<[count: number, reps: number, percent: number]>,
  opts?: { role?: SeedExercise["role"]; notesKo?: string; restSec?: number },
): SeedExercise {
  return {
    exerciseKey,
    role: opts?.role ?? "main",
    notesKo: opts?.notesKo,
    sets: expandPct(parts, opts?.restSec ?? 150),
  };
}

function testMaxSingle(exerciseKey: string, notesKo: string): SeedExercise {
  return {
    exerciseKey,
    role: "main",
    notesKo,
    sets: [
      {
        setNumber: 1,
        percentBase: "none",
        percent: null,
        reps: 1,
        amrap: true,
        restSec: 180,
        noteKo: "테스트 · 고정 % 없음",
      },
    ],
  };
}

function lbebPublicWorkWeek(
  weekNumber: number,
  nameKo: string,
  notesKo: string,
  day1: SeedExercise[],
  day2: SeedExercise[],
  day3: SeedExercise[],
  day3NameKo: string,
): { weekNumber: number; nameKo: string; notesKo: string; days: SeedDay[] } {
  return {
    weekNumber,
    nameKo,
    notesKo,
    days: [
      { dayNumber: 1, nameKo: "월요일 — 스네치", exercises: day1 },
      { dayNumber: 2, nameKo: "화요일 — 클린&저크", exercises: day2 },
      restDay(3, "수요일 — 휴식"),
      { dayNumber: 4, nameKo: day3NameKo, exercises: day3 },
      restDay(5, "금요일 — 휴식"),
      restDay(6, "토요일 — 휴식"),
    ],
  };
}

/** App W7–12 = public LBEB Cycle 2 W3 – Cycle 3 W4. Source text only. */
function lbebPublicWeeks7to12(): SeedProgram["weeks"] {
  const situps50 = bodyweight("abs", "싯업", 1, 50);
  const boxJumps = bodyweight("box_jump", "박스점프", 5, 5);
  const hangingLegs = bodyweight("hanging_leg_raise", "행잉 레그레이즈", 3, 12);
  const pullups = bodyweight("pull_up", "풀업", 3, 8);
  return [
    lbebPublicWorkWeek(
      7,
      "7주차 — Cycle 2 Week 3",
      "공개 LBEB Cycle 2 Week 3. 월·화·목 작업.",
      [
        pctEx("snatch", [[2, 3, 65], [2, 3, 70]]),
        pctEx("squat", [[3, 5, 70]]),
        pctEx("push_press", [[5, 3, 70]]),
        pctEx("snatch", [[4, 5, 75]], { role: "assistance", notesKo: "스네치 데드리프트", restSec: 90 }),
        boxJumps,
      ],
      [
        pctEx("clean_jerk", [[2, 3, 65], [2, 3, 70]], { restSec: 180 }),
        pctEx("snatch", [[3, 3, 70]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[3, 5, 70]]),
        pctEx("jerk", [[3, 3, 70]], { notesKo: "푸쉬저크 비하인드넥" }),
        hangingLegs,
      ],
      [
        pctEx("snatch", [[4, 3, 70]], { notesKo: "파워스네치" }),
        pctEx("clean_jerk", [[4, 3, 70]], { notesKo: "파워클린", restSec: 180 }),
        pctEx("squat", [[5, 7, 70]]),
        pctEx("push_press", [[3, 5, 70]]),
      ],
      "목요일 — 파워",
    ),
    lbebPublicWorkWeek(
      8,
      "8주차 — Cycle 2 Week 4",
      "공개 LBEB Cycle 2 Week 4. 월·화·목 작업.",
      [
        pctEx("snatch", [[2, 2, 90]]),
        pctEx("squat", [[3, 2, 87]]),
        pctEx("jerk", [[3, 2, 92]], { notesKo: "저크 비하인드넥" }),
        pctEx("snatch_pull", [[4, 3, 115]], { role: "assistance", restSec: 90 }),
      ],
      [
        pctEx("clean_jerk", [[2, 2, 90]], { restSec: 180 }),
        pctEx("snatch", [[3, 2, 92]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[4, 1, 95]]),
        pctEx("clean", [[5, 5, 85]], { role: "assistance", notesKo: "RDL", restSec: 90 }),
      ],
      [
        pctEx("snatch", [[3, 1, 95]]),
        pctEx("clean_jerk", [[3, 1, 95]], { restSec: 180 }),
        pctEx("squat", [[4, 3, 87]]),
        pctEx("clean", [[4, 3, 85]], { notesKo: "클린 풀 2회 + 클린" }),
        situps50,
      ],
      "목요일 — 스네치/클린",
    ),
    lbebPublicWorkWeek(
      9,
      "9주차 — Cycle 3 Week 1",
      "공개 LBEB Cycle 3 Week 1. 월·화·목 작업.",
      [
        pctEx("snatch", [[3, 2, 80], [3, 2, 85]]),
        pctEx("squat", [[4, 4, 85]]),
        pctEx("push_press", [[3, 5, 80]], { notesKo: "푸쉬프레스 비하인드넥" }),
        pctEx("snatch_pull", [[4, 5, 105]], { role: "assistance", restSec: 90 }),
        pullups,
      ],
      [
        pctEx("clean_jerk", [[3, 2, 80], [3, 2, 85]], { restSec: 180 }),
        pctEx("snatch", [[4, 2, 80]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[4, 4, 85]]),
        pctEx("clean_pull", [[5, 5, 105]], { role: "assistance", restSec: 90 }),
        situps50,
      ],
      [
        pctEx("snatch", [[3, 3, 80], [2, 3, 85]], { notesKo: "스네치 풀 + 파워스네치 + 스네치" }),
        pctEx("squat", [[3, 8, 75]]),
        pctEx("push_press", [[4, 4, 85]], { notesKo: "푸쉬프레스 비하인드넥" }),
        pctEx("snatch", [[3, 7, 115]], { role: "assistance", notesKo: "스네치 데드리프트", restSec: 90 }),
      ],
      "목요일 — 컴플렉스",
    ),
    lbebPublicWorkWeek(
      10,
      "10주차 — Cycle 3 Week 2",
      "공개 LBEB Cycle 3 Week 2. 월·화·목 작업.",
      [
        pctEx("snatch", [[3, 2, 85], [3, 1, 90]]),
        pctEx("squat", [[4, 3, 87]]),
        pctEx("push_press", [[5, 3, 87]]),
        pctEx("clean", [[4, 5, 115]], { role: "assistance", notesKo: "클린 데드리프트 (스트랩)", restSec: 90 }),
        boxJumps,
      ],
      [
        pctEx("clean_jerk", [[3, 2, 85], [3, 1, 90]], { restSec: 180 }),
        pctEx("snatch", [[3, 2, 87]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[5, 3, 87]]),
        pctEx("jerk", [[3, 3, 85]], { notesKo: "푸쉬저크 비하인드넥" }),
        hangingLegs,
      ],
      [
        pctEx("clean", [[4, 3, 85], [4, 3, 87]], { notesKo: "클린 풀 + 파워클린 + 클린" }),
        pctEx("snatch", [[5, 3, 85]], { notesKo: "스네치 푸쉬프레스" }),
        pctEx("squat", [[5, 4, 85]], { notesKo: "1¼ 백스쿼트" }),
        pctEx("clean", [[4, 5, 110]], { role: "assistance", notesKo: "클린 슈러그", restSec: 90 }),
      ],
      "목요일 — 컴플렉스",
    ),
    lbebPublicWorkWeek(
      11,
      "11주차 — Cycle 3 Week 3",
      "공개 LBEB Cycle 3 Week 3. 월·화·목 작업.",
      [
        pctEx("snatch", [[2, 3, 70], [2, 3, 75]]),
        pctEx("squat", [[3, 5, 75]]),
        pctEx("push_press", [[5, 3, 75]]),
        pctEx("snatch", [[4, 5, 80]], { role: "assistance", notesKo: "스네치 데드리프트", restSec: 90 }),
        boxJumps,
      ],
      [
        pctEx("clean_jerk", [[2, 3, 70], [2, 3, 75]], { restSec: 180 }),
        pctEx("snatch", [[3, 3, 75]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[3, 5, 75]]),
        pctEx("jerk", [[3, 3, 75]], { notesKo: "푸쉬저크 비하인드넥" }),
        hangingLegs,
      ],
      [
        pctEx("snatch", [[4, 3, 75]], { notesKo: "파워스네치" }),
        pctEx("clean_jerk", [[4, 3, 75]], { notesKo: "파워클린", restSec: 180 }),
        pctEx("squat", [[5, 7, 70]]),
        pctEx("push_press", [[2, 5, 75]]),
      ],
      "목요일 — 파워",
    ),
    lbebPublicWorkWeek(
      12,
      "12주차 — Cycle 3 Week 4",
      "공개 LBEB Cycle 3 Week 4. 목요일 스네치·C&J·백스쿼트 맥스 시도(고정 % 없음).",
      [
        pctEx("snatch", [[2, 1, 90]]),
        pctEx("squat", [[3, 1, 87]]),
        pctEx("jerk", [[3, 1, 92]], { notesKo: "저크 비하인드넥" }),
        pctEx("snatch_pull", [[4, 2, 115]], { role: "assistance", restSec: 90 }),
      ],
      [
        pctEx("clean_jerk", [[2, 1, 90]], { restSec: 180 }),
        pctEx("snatch", [[3, 1, 92]], { notesKo: "스네치 밸런스" }),
        pctEx("front_squat", [[4, 1, 90]]),
      ],
      [
        testMaxSingle("snatch", "스네치 맥스 시도"),
        testMaxSingle("clean_jerk", "클린&저크 맥스 시도"),
        testMaxSingle("squat", "백스쿼트 맥스 시도"),
      ],
      "목요일 — 맥스 테스트",
    ),
  ];
}

export function lbebP1(): SeedProgram {
  return {
    slug: "lbeb",
    nameKo: "LBEB",
    nameEn: "LBEB",
    category: "역도",
    completeness: "working",
    coverage: "public-lbeb-12w-olympic",
    copy: {
      help: "12주 진행 가능. W1–6은 기존 하이브리드 시드. W7–12는 공개 LBEB 12주(Cycle 2 W3–Cycle 3 W4, 월·화·목). 출처 public-lbeb-12w-olympic.",
    },
    descriptionKo:
      "12주 진행 가능. W1–6은 기존 하이브리드 시드. W7–12는 공개 LBEB 12주(Cycle 2 W3–Cycle 3 W4). 유료 시트를 추정해 채우지 않았습니다.",
    descriptionEn:
      "12 weeks usable. W7–12 from public LBEB 12-week Olympic text (Cycle 2 W3–Cycle 3 W4). Paid Excel weeks were not invented.",
    sortOrder: 120,
    weeks: [
      ...Array.from({ length: 6 }, (_, i) => ({
        weekNumber: i + 1,
        nameKo: `${i + 1}주차`,
        notesKo:
          i === 0 ? "하이브리드 W1." : `W${i + 1} 노트: W1 골격 + 소폭 강도. 원본 시트 파동 아님.`,
        days: olympicWeek1Days("lbeb", i + 1),
      })),
      ...lbebPublicWeeks7to12(),
    ],
  };
}
