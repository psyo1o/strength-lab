import { describe, expect, it } from "vitest";
import { headReviewErrors, headReviewFormat } from "../src/lib/programming/coaching/contract";
import { applyHeadCells } from "../src/lib/programming/coaching/head-cells";
import { areaShapeErrors } from "../src/lib/programming/coaching/orchestrate";
import { applyHeadPolicy } from "../src/lib/programming/coaching/stage13/revision";
import {
  bannedPurposeWords,
  buildMonthFrame,
  legalMonthlyCellJson,
  monthCellFormat,
  purposeSentence,
  REST_EMPHASIS,
  REST_PURPOSE_KIND,
  tableFromCells,
  TRAINING_EMPHASIS,
  TRAINING_PURPOSE_KINDS,
} from "../src/lib/programming/coaching/goal-candidates";
import { prescribedLoad } from "../src/lib/programming/coaching/movement-catalog";
import { isCoachingSignal } from "../src/lib/programming/coaching/stage13/policy";
import {
  buildSessionFrame,
  expandSlotPayload,
  originAfterCatalogFill,
  quantityOptions,
  sessionSlotFormat,
  type SessionFrame,
} from "../src/lib/programming/coaching/slot-choices";
import { withCoachingPlan } from "../src/lib/programming/coaching/monthly";
import { planCoachedWeek } from "../src/lib/programming/coaching/weekly";
import { fallbackMonth } from "../src/lib/programming/fallback";
import type { SessionDraft } from "../src/lib/programming/types";

function weekPlan() {
  const month = withCoachingPlan(fallbackMonth({ summary_ko: "지난 달은 5/3/1이었습니다.", next_scheme: "531", strength_method: "531" }));
  const plan = planCoachedWeek({ month, weekIndex: 1 });
  const day = plan.days.find((row) => row.primary_training !== "rest" && row.recovery_role !== "rest");
  if (!day) throw new Error("no training day");
  return { day, plan };
}

describe("세션 칸 선택", () => {
  it("row_erg 수량 id에 단위가 들어 있고 스쿼트 날에는 back_squat가 없다", () => {
    const ids = quantityOptions("row_erg").map((option) => option.id);
    expect(ids.some((id) => id.startsWith("m:"))).toBe(true);
    expect(ids.some((id) => id.startsWith("cal:"))).toBe(true);
    const { day, plan } = weekPlan();
    const frame = buildSessionFrame({
      area: "conditioning",
      day: { ...day, strength_lift: "squat" },
      slot: plan.conditioning_slots?.[day.day] ?? null,
    });
    expect(frame).not.toBeNull();
    const offered = frame!.slots.flatMap((slot) => slot.movements.map((movement) => movement.key));
    expect(offered).not.toContain("back_squat");
    expect(offered.length).toBeGreaterThan(0);
  });

  it("확장은 단위와 Rx를 채우고 한 칸짜리 enum도 모델이 고르게 한다", () => {
    const options = quantityOptions("american_kettlebell_swing");
    const frame: SessionFrame = {
      area: "conditioning",
      day: "tue",
      piece: { format: "for_time", duration_min: 12, stimulus: "heavy", volume: "moderate", intensity: "heavy" },
      slots: [
        { id: "s0", movements: [{ key: "row_erg", options: quantityOptions("row_erg") }] },
        { id: "s1", movements: [{ key: "american_kettlebell_swing", options }] },
      ],
    };
    const schema = JSON.stringify(sessionSlotFormat(frame));
    expect(schema).toContain("m:400");
    expect(schema).toContain("cal:15");
    const missing = expandSlotPayload(frame, {});
    expect(missing.ok).toBe(false);
    const built = expandSlotPayload(frame, {
      s0: { slot: "s0", movement_id: "row_erg", quantity_option: "m:400" },
      s1: { slot: "s1", movement_id: "american_kettlebell_swing", quantity_option: options[0]!.id },
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const { day } = weekPlan();
    expect(areaShapeErrors("conditioning", built.json, { ...day, day: "tue" })).toEqual([]);
    const movements = (built.json as { conditioning: { movements: Array<{ key: string; unit?: string; load?: { male: string | null } | null }> } }).conditioning.movements;
    expect(movements.find((row) => row.key === "row_erg")?.unit).toBe("m");
    expect(movements.find((row) => row.key === "american_kettlebell_swing")?.load).toEqual(prescribedLoad("american_kettlebell_swing"));
    expect(originAfterCatalogFill("model")).toBe("model");
    const single = sessionSlotFormat({ ...frame, slots: [frame.slots[0]!] });
    const singleSchema = JSON.stringify(single);
    expect(singleSchema).toContain('"row_erg"');
    expect(singleSchema).toContain('"s0"');
  });

  it("헤드의 잘못된 수량만 되돌리고 단위 수정은 거절한다", () => {
    const sessions = [
      {
        day: "mon",
        strength: null,
        conditioning: {
          movements: [
            { key: "row_erg", amount: "500m", name_ko: "로우어", movement: "row_erg", amount_value: 500, unit: "m" },
            { key: "burpee", amount: "15", name_ko: "버피", movement: "burpee", amount_value: 15, unit: "reps" },
          ],
        },
      },
    ] as unknown as SessionDraft[];
    const bad = applyHeadCells(sessions, [
      {
        day: "mon",
        reason: "수량이 범위 밖이다.",
        correction_instruction: "set quantity",
        cell: { day: "mon", block: "conditioning", catalog_key: "row_erg", field: "quantity_option", value: "reps:1", reason: "수량이 범위 밖이다." },
      },
    ]);
    expect(bad.reverted).toBe(1);
    expect(sessions[0]?.conditioning?.movements[0]?.amount).toBe("500m");
    expect(sessions[0]?.conditioning?.movements[1]?.amount).toBe("15");
    const unit = applyHeadCells(sessions, [
      {
        day: "mon",
        reason: "단위를 바꾼다.",
        correction_instruction: "set unit",
        cell: { day: "mon", block: "conditioning", catalog_key: "row_erg", field: "unit", value: "reps", reason: "단위를 바꾼다." },
      },
    ]);
    expect(unit.reverted).toBe(1);
    expect(sessions[0]?.conditioning?.movements[0]?.unit).toBe("m");
    const legal = quantityOptions("row_erg").find((option) => option.id.startsWith("cal:"));
    const applied = applyHeadCells(sessions, [
      {
        day: "mon",
        reason: "칼로리로 바꾼다.",
        correction_instruction: "set quantity",
        cell: { day: "mon", block: "conditioning", catalog_key: "row_erg", field: "quantity_option", value: legal!.id, reason: "칼로리로 바꾼다." },
      },
    ]);
    expect(applied.applied).toBe(1);
    expect(sessions[0]?.conditioning?.movements[0]?.unit).toBe("cal");
    expect(sessions[0]?.conditioning?.movements[1]?.amount).toBe("15");
    const cells = [{ day: "mon", block: "conditioning", catalog_key: "row_erg" }];
    const schema = JSON.stringify(headReviewFormat(["row_erg"], cells));
    expect(schema).toContain("quantity_option");
    expect(schema).toContain(legal!.id);
  });

  it("피로 상한 문장은 경고이고 다른 하드 문장은 그대로다", () => {
    expect(isCoachingSignal("intent says lower load was reduced but the prescription is heavier than the fatigue limit")).toBe(true);
    expect(isCoachingSignal("sets do not match the method table")).toBe(false);
  });

  it("목적 문장은 슬롯으로만 만들고 금지어 검사를 통과한다", () => {
    const month = fallbackMonth({ summary_ko: "5/3/1 블록을 네 주 유지합니다.", next_scheme: "531", strength_method: "531" });
    const framed = buildMonthFrame(month);
    expect(framed.ok).toBe(true);
    if (!framed.ok) return;
    const schema = JSON.stringify(monthCellFormat(framed.frame));
    expect(schema).toContain("purpose_kind");
    expect(schema).toContain("quality");
    expect(schema).not.toContain("\"purpose\"");
    for (const kind of TRAINING_PURPOSE_KINDS) {
      for (const emphasis of TRAINING_EMPHASIS) {
        const line = purposeSentence(kind, emphasis);
        expect(line).toBeTruthy();
        expect(line!.length).toBeLessThanOrEqual(60);
        expect(bannedPurposeWords(line!)).toEqual([]);
        expect(line).not.toMatch(/\d/);
      }
    }
    const rest = purposeSentence(REST_PURPOSE_KIND, REST_EMPHASIS);
    expect(bannedPurposeWords(rest!)).toEqual([]);
    expect(purposeSentence("air_squat", "reps")).toBeNull();
    const json = legalMonthlyCellJson(month);
    const parsed = tableFromCells(framed.frame, json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const bad = structuredClone(json);
    const key = Object.keys(bad.days).find((slot) => bad.days[slot]?.choice)!;
    bad.days[key] = { choice: bad.days[key]!.choice, purpose_kind: "air_squat", emphasis: "reps" };
    const rejected = tableFromCells(framed.frame, bad);
    expect(rejected.ok).toBe(false);
    if (rejected.ok || !rejected.table) return;
    const stored = rejected.table.weeks.flatMap((week) => week.days).find((day) => day.purpose.includes("air_squat") || day.purpose.includes("reps"));
    expect(stored).toBeUndefined();
  });

  it("수정 없는 REVISE는 승인으로 내리지 않고 조정만으로는 칸 수정이 아니다", () => {
    const kept = applyHeadPolicy(
      {
        status: "REVISE",
        note_ko: "사소한 형식 차이입니다.",
        revisions: [{ day: "mon", reason: "형식", correction_instruction: "형식", priority: "low", constraints: "유지" }],
      },
      { must_revise: false, only_minor: true, note_ko: "사소한 지적만 있습니다.", priorities: [] },
    );
    expect(kept.status).toBe("REVISE");
    expect(
      headReviewErrors({
        status: "REVISE",
        note_ko: "칸도 조정도 없습니다.",
        revisions: [],
        adjustments: [],
      }).join(" "),
    ).toMatch(/catalog cell/);
    const schema = JSON.stringify(
      headReviewFormat(
        ["row_erg"],
        [
          {
            day: "mon",
            block: "conditioning",
            catalog_key: "row_erg",
            amount: "250m",
            unit: "m",
            movement_ids: ["row_erg", "bike_erg"],
            quantity_ids: ["m:250", "m:625", "cal:12"],
          },
        ],
      ),
    );
    expect(schema).toContain("m:625");
    expect(schema).toContain("bike_erg");
    expect(schema).not.toContain("m:250");
  });
});
