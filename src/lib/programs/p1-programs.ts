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

export function juggernautP1(): SeedProgram {
  const waves = [
    { label: "10s", acc: { pct: 60, sets: 5, reps: 10 }, int: { pct: 67.5, sets: 3, reps: 10 }, realTop: 75 },
    { label: "8s", acc: { pct: 65, sets: 5, reps: 8 }, int: { pct: 72.5, sets: 3, reps: 8 }, realTop: 80 },
    { label: "5s", acc: { pct: 75, sets: 6, reps: 5 }, int: { pct: 80, sets: 4, reps: 5 }, realTop: 87.5 },
    { label: "3s", acc: { pct: 80, sets: 7, reps: 3 }, int: { pct: 85, sets: 5, reps: 3 }, realTop: 92.5 },
  ];
  const lifts = [
    { n: 1, name: "스쿼트", key: "squat" },
    { n: 2, name: "벤치", key: "bench" },
    { n: 3, name: "데드", key: "deadlift" },
    { n: 4, name: "OHP", key: "ohp" },
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
  return {
    slug: "juggernaut",
    nameKo: "Juggernaut Method",
    nameEn: "Juggernaut Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "16주 10s→8s→5s→3s. W1은 4대 리프트 축적 60%×10×5 + 보조. 실현 주 AMRAP는 시트 공식으로 1RM을 갱신합니다.",
    descriptionEn: "16-week waves. W1 accumulation 60%x10x5. Approximate public-knowledge table.",
    sortOrder: 40,
    weeks: waves.flatMap((wave, wi) =>
      kinds.map((kind, ki) => {
        const row = kindRow(kind, wave);
        return {
          weekNumber: wi * 4 + ki + 1,
          nameKo: `${wi * 4 + ki + 1}주차 — ${wave.label} ${row.name}`,
          notesKo: row.amrap ? "마지막 AMRAP. 실현 주면 시트 공식으로 1RM 갱신." : "딜로드 60%.",
          days: lifts.map((d) => ({
            dayNumber: d.n,
            nameKo: d.name,
            exercises: [
              workWarmup(row.ramp ? 50 : row.pct, d.key),
              {
                exerciseKey: d.key,
                role: "main" as const,
                sets: row.ramp
                  ? sets([50, 60, 67.5, row.pct], [5, 3, 2, row.reps], "1rm", { lastAmrap: true, restSec: 180 })
                  : nSets(row.count, row.pct, row.reps, "1rm", { lastAmrap: row.amrap, restSec: 150 }),
              },
              ...assist(d.key),
            ],
          })),
        };
      }),
    ),
  };
}

export function cowboyP1(): SeedProgram {
  const weekPct = (w: number) => {
    if (w === 11) return 55;
    if (w >= 12) return 70;
    return 60 + (w - 1) * 2.5;
  };
  return {
    slug: "cowboy",
    nameKo: "Cowboy Method",
    nameEn: "Cowboy Method",
    category: "파워리프팅",
    completeness: "working",
    descriptionKo:
      "월/수/금 13주. W1 월 60%×5×10, 수 프론트 55→75×5, 금 NRM 사다리. weekRules는 주 노트. Wendler 원본 복제 아님.",
    descriptionEn: "Mon/Wed/Fri 13 weeks. Approximate Cowboy volume.",
    weekRules: Array.from({ length: 13 }, (_, i) => {
      const w = i + 1;
      return `W${w}: 월 ${weekPct(w)}% 5×10 · 수 FS 래더 · 금 NRM 사다리`;
    }),
    sortOrder: 50,
    weeks: Array.from({ length: 13 }, (_, i) => {
      const w = i + 1;
      const pct = weekPct(w);
      const fs = [55, 60, 65, 70, 75].map((p) => p + (w === 1 ? 0 : Math.min(5, (w - 1) * 0.5)));
      return {
        weekNumber: w,
        nameKo: w === 11 ? "11주차 — 딜로드" : `${w}주차`,
        notesKo: `weekRules W${w}: 월 ${pct}%×5×10. 금은 가이드 사다리로 NRM까지.`,
        days: [
          {
            dayNumber: 1,
            nameKo: "월요일 — 스쿼트 볼륨",
            exercises: [
              workWarmup(pct, "squat"),
              { exerciseKey: "squat", role: "main", sets: nSets(5, pct, 10, "1rm") },
              { exerciseKey: "bench", role: "assistance", sets: nSets(4, 55, 8, "1rm") },
              bodyweight("abs", "복근", 3, 12),
            ],
          },
          {
            dayNumber: 2,
            nameKo: "수요일 — 프론트스쿼트",
            notesKo: "55→75×5 래더 (주차에 따라 소폭 상향)",
            exercises: [
              workWarmup(fs[0], "front_squat"),
              { exerciseKey: "front_squat", role: "main", sets: sets(fs, 5, "1rm") },
              { exerciseKey: "ohp", role: "assistance", sets: nSets(4, 55, 6, "1rm") },
              bodyweight("chin_up", "친업", 3, 8),
            ],
          },
          {
            dayNumber: 3,
            nameKo: "금요일 — NRM 사다리",
            notesKo: "가이드 사다리 후 마지막 AMRAP ≈ NRM",
            exercises: [
              workWarmup(50, "deadlift"),
              {
                exerciseKey: "deadlift",
                role: "main",
                sets: sets([50, 60, 70, 75, 80], [5, 3, 2, 1, 1], "1rm", { lastAmrap: true, restSec: 180 }),
              },
              { exerciseKey: "barbell_row", role: "assistance", sets: nSets(4, 50, 8, "1rm") },
            ],
          },
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
    notesKo: "DAPRE — 50%×12 / 75%×8 / 100% AMRAP. 다음 세션 ±2.5kg 수동.",
    sets: [
      { setNumber: 1, percentBase: "ten_rm", percent: 50, reps: 12, restSec: 120, noteKo: "" },
      { setNumber: 2, percentBase: "ten_rm", percent: 75, reps: 8, restSec: 120, noteKo: "" },
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
      "W1 DeLorme 50/75/100% 10RM×10, DAPRE 50×12 / 75×8 / 100 AMRAP. 목표 동작은 재활 목표 동작. 증감 2.5kg 수동.",
    descriptionEn: "DeLorme + DAPRE on 10RM. rehab_target placeholder. 2.5kg steps.",
    extraOneRmFields: { rehab_target: { label: "재활 목표 동작" } },
    sortOrder: 20,
    weeks: [1, 2, 3, 4].map((w) => ({
      weekNumber: w,
      nameKo: `${w}주차`,
      notesKo: w === 1 ? "통증 없는 가동 범위만." : "10RM이 편하면 +2.5kg 재추정.",
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
    descriptionKo: "Class III / II / I 12주. 프로그램 화면에서 클래스 또는 전체를 고릅니다. 공식 장기 주기화 아님.",
    descriptionEn: "Class III week 1 default. Manual class picker. Approximate.",
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
    descriptionKo: "12주 기본 블록. 시드된 모든 주/일로 세션이 열립니다.",
    descriptionEn: "12-week base. Specialty blocks listed, not expanded.",
    sortOrder: 100,
    weeks: Array.from({ length: 12 }, (_, i) => ({
      weekNumber: i + 1,
      nameKo: i === 0 ? "1주차 — 기본" : `${i + 1}주차 — 기본 (스페셜티 미확장)`,
      notesKo:
        i === 0
          ? "12주 기본 W1. 피킹/볼륨/컨피던스 블록은 이후."
          : "기본 블록 반복 +1%p. 스페셜티 블록은 이 버전에서 펼치지 않음.",
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
    descriptionKo: "13주 월–금. W2–13은 같은 골격에 주당 +1%p. 공식 앱과 무관.",
    descriptionEn: "W1 Mon–Fri. W2–13 notes + small percent bump.",
    sortOrder: 110,
    weeks: Array.from({ length: 13 }, (_, i) => ({
      weekNumber: i + 1,
      nameKo: i === 0 ? "1주차 — 월–금" : `${i + 1}주차`,
      notesKo: i === 0 ? "토로흐티 스타일 5일. 공개 지식 근사." : `W${i + 1} — W1 골격 유지, 강도 +${i}%p. 상세 파동은 노트만.`,
      days: olympicWeek1Days("torokhtiy", i + 1),
    })),
  };
}

export function lbebP1(): SeedProgram {
  return {
    slug: "lbeb",
    nameKo: "LBEB",
    nameEn: "LBEB",
    category: "역도",
    completeness: "template",
    descriptionKo: "W1 완전 로드. W2–6은 노트 진행. W7–12는 UI에서 아직 없음으로 표시.",
    descriptionEn: "W1 loadable. W2–6 notes. W7–12 unavailable in UI.",
    sortOrder: 120,
    weeks: Array.from({ length: 12 }, (_, i) => ({
      weekNumber: i + 1,
      nameKo: i + 1 <= 6 ? `${i + 1}주차` : `${i + 1}주차 — 아직 없음`,
      notesKo:
        i === 0
          ? "하이브리드 W1."
          : i + 1 <= 6
            ? `W${i + 1} 노트: W1 골격 + 소폭 강도. 원본 시트 파동 아님.`
            : "이 블록은 아직 제공하지 않습니다.",
      days: i + 1 <= 6 ? olympicWeek1Days("lbeb", i + 1) : [],
    })),
  };
}
