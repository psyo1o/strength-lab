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
};

const filled = [
  "run",
  "push_up",
  "sit_up",
  "ring_row",
  "handstand",
  "fan_bike",
  "ski",
  "row",
  "lunge",
  "knee_raise",
  "box_jump",
  "burpee",
  "kipping_pull_up",
  "butterfly_pull_up",
  "toes_to_bar",
  "double_under",
  "wall_ball",
  "thruster",
  "kb_swing",
  "pull_up",
  "abs",
  "free_accessory",
  "pause_squat",
  "pin_squat",
  "spoto_press",
  "face_pull",
];

describe("filled exercise tips", () => {
  it("keeps main-lift and Olympic tips that already had two or three sentences", () => {
    for (const [id, cue] of Object.entries(keptCue)) {
      expect(tipFor(id)?.cue).toBe(cue);
    }
    expect(tipFor("bench")?.cue).toContain("견갑을 모아서");
    expect(tipFor("split_jerk")?.cue).toBeTruthy();
    expect(tipFor("thruster")?.youtubeCredit).toBe("CrossFit");
    expect(tipFor("kipping_pull_up")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=r45xLlH7r_M");
    expect(tipFor("double_under")?.youtubeUrl).toBe("https://www.youtube.com/watch?v=-tF3hUsPZAI");
  });

  it("fills the attached short tips as cue, mistake, and swap", () => {
    for (const id of filled) {
      const tip = tipFor(id);
      expect(tip?.cue).toBeTruthy();
      expect(tip?.mistake).toBeTruthy();
      expect(tip?.alternative).toBeTruthy();
      expect(tip?.sheet).toBe(`${tip?.cue} ${tip?.mistake} ${tip?.alternative}`);
    }
    expect(tipFor("run")?.mistake).toContain("발을 멀리 뻗어");
    expect(tipFor("run")?.alternative).toContain("팬바이크나 로우로 바꿔 주세요");
    expect(tipFor("run")?.alternative).toContain("전문가와 상의해 주세요");
    expect(tipFor("row")?.name).toBe("로잉 머신");
    expect(tipFor("row")?.cue).toContain("바벨 로우와는 다른 동작입니다");
    expect(tipFor("ski")?.name).toBe("스키에르그");
    expect(tipFor("fan_bike")?.cue).toContain("구부러질");
    expect(tipFor("sit_up")?.mistake).toContain("튕겨");
    expect(tipFor("wall_ball")?.cue).toContain("팔을 뻗어");
    expect(tipFor("wall_ball")?.mistake).toContain("얕은 스쿼트");
    expect(tipFor("double_under")?.cue).toContain("손잡이가 겨드랑이 근처면 적당합니다");
    expect(tipFor("kipping_pull_up")?.cue).toContain("엄지가 바를 감싸게");
    expect(tipFor("pause_squat")?.cue).toContain("평소 스쿼트와 같게");
    expect(tipFor("pause_squat")?.mistake).toContain("튕기거나");
    expect(tipFor("spoto_press")?.mistake).toBe("바에 튕기거나 정지 없이 터치하는 경우가 많습니다.");
    expect(tipFor("spoto_press")?.alternative).toContain("플로어 프레스로 바꿔 주세요");
    expect(tipFor("face_pull")?.alternative).toContain("밴드 풀어파트");
    expect(tipFor("kb_swing")?.cue).toContain("러시안");
    expect(tipFor("pull_up")?.cue).toContain("견갑을 먼저");
  });

  it("does not add sales language or movements outside the source", () => {
    const body = filled
      .map((id) => {
        const tip = tipFor(id);
        return `${tip?.cue} ${tip?.mistake} ${tip?.alternative}`;
      })
      .join("\n");
    expect(body).not.toMatch(/구매|결제|코칭|크로스핏|전문가에게 보여 주세요|겪드랑이|구부려질/);
    expect(tipFor("thruster")?.alternative).not.toContain("전문가");
    expect(tipFor("handstand")?.alternative).toContain("전문가와 상의해 주세요");
    const pause = EXERCISES.find((row) => row.key === "pause_squat");
    const spoto = EXERCISES.find((row) => row.key === "spoto_press");
    expect(pause?.tipsKo).toContain("튕기거나");
    expect(pause?.tipsKo).toContain("박스 스쿼트로 바꿔 주세요");
    expect(spoto?.tipsKo).toContain("바에 튕기거나");
    expect(spoto?.tipsKo).toContain("플로어 프레스로 바꿔 주세요");
    const raw = readFileSync(path.join(process.cwd(), "data", "exercise-tips.ko.json"), "utf8");
    expect(raw).toContain("로잉 머신");
    expect(raw).not.toContain("전문가에게 보여 주세요");
  });
});
