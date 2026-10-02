import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EXERCISES } from "../src/lib/programs/catalog";
import { tipFor } from "../src/lib/tips";

const keptCue = {
  back_squat:
    "발은 어깨~골반보다 조금 넓게, 발끝은 살짝 바깥. 내려갈 때 무릎은 발끝 방향으로, 엉덩이는 뒤로 앉듯이. 가슴은 들고 허리는 중립.",
  deadlift: "바는 정강이에 붙이고, 엉덩이는 너무 낮추지 말고 다리로 바닥을 밀며 시작해. 허리가 말리기 전에 멈춰.",
  power_clean: "바를 몸에서 떼지 말고 끌어올리다, 힙을 폭발적으로 펴고 팔꿈치를 빠르게 돌려 어깨 앞에 받아.",
  squat_snatch: "풀 후 바로 오버헤드 스쿼트로 앉아 받아. 받는 순간 바는 머리 뒤가 아니라 귀 위, 발 중앙 위에.",
  kipping_pull_up: "어깨를 열고 닫는 아크부터. 힙 드라이브로 올라가고, 내려올 때 몸을 다시 늘려.",
  pause_squat: "하단(엉덩이 최저점)에서 1–3초 완전히 정지한 뒤 반동 없이 밀어 올린다. 가슴은 들고 허리는 중립.",
};

describe("filled exercise tips", () => {
  it("keeps main-lift and Olympic tips that already had two or three sentences", () => {
    for (const [id, cue] of Object.entries(keptCue)) {
      expect(tipFor(id)?.cue).toBe(cue);
    }
    expect(tipFor("bench")?.cue).toContain("견갑을 모아서");
    expect(tipFor("thruster")?.youtubeCredit).toBe("CrossFit");
  });

  it("fills empty movement tips from movements on this branch", () => {
    for (const id of ["run", "push_up", "sit_up", "ring_row", "handstand", "fan_bike", "ski", "row", "lunge", "knee_raise"]) {
      const tip = tipFor(id);
      expect(tip?.cue).toBeTruthy();
      expect(tip?.mistake).toBeTruthy();
      expect(tip?.alternative).toBeTruthy();
      expect(tip?.sheet).toBe(`${tip?.cue} ${tip?.mistake} ${tip?.alternative}`);
    }
    expect(tipFor("run")?.mistake).toContain("뻗어");
    expect(tipFor("run")?.alternative).toContain("전문가에게 보여 주세요");
    expect(tipFor("row")?.name).toBe("로잉");
    expect(tipFor("row")?.cue).toContain("댐퍼");
    expect(tipFor("ski")?.name).toBe("스키에르그");
    expect(tipFor("pull_up")?.cue).toContain("견갑을 먼저");
    expect(tipFor("wall_ball")?.mistake).toContain("얕은 스쿼트");
    expect(tipFor("burpee")?.cue).toContain("손뼉");
    expect(tipFor("face_pull")?.alternative).toContain("풀아파트");
  });

  it("does not use trademark, sales, or broken spellings in the new bodies", () => {
    const ids = ["run", "push_up", "sit_up", "ring_row", "handstand", "fan_bike", "ski", "row", "lunge", "knee_raise", "burpee", "thruster", "pull_up", "kb_swing", "toes_to_bar", "wall_ball"];
    const body = ids.map((id) => {
      const tip = tipFor(id);
      return `${tip?.cue} ${tip?.mistake} ${tip?.alternative}`;
    }).join("\n");
    expect(body).not.toMatch(/뽀어|으숙|겪드랑이|눅고|주져|풀어파트|CrossFit|크로스핏|구매|결제|코칭/);
    expect(tipFor("handstand")?.alternative).toContain("전문가에게 보여 주세요");
    expect(tipFor("thruster")?.alternative).toContain("전문가에게 보여 주세요");
    const pause = EXERCISES.find((row) => row.key === "pause_squat");
    const spoto = EXERCISES.find((row) => row.key === "spoto_press");
    expect(pause?.tipsKo).toContain("박스 스쿼트로 바꿔 주세요");
    expect(spoto?.tipsKo).toContain("플로어 프레스로 바꿔 주세요");
    expect(spoto?.tipsKo).not.toMatch(/주져/);
    const raw = readFileSync(path.join(process.cwd(), "data", "exercise-tips.ko.json"), "utf8");
    expect(raw).not.toMatch(/풀어파트/);
  });
});
