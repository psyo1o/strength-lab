import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import {
  decodeGzipBase64,
  inferCompleteness,
  mergePublicSeedById,
  P0_PROGRAM_IDS,
  programsFromDecoded,
} from "../src/lib/programs/seed-merge";
import type { PublicSeedFile, PublicSeedProgram } from "../src/lib/programs/seed-schema";

const emptyWeek = (week: number, days: number): PublicSeedProgram["weeks"][number] => ({
  week,
  days: Array.from({ length: days }, (_, i) => ({ day: i + 1, exercises: [] })),
});

function baseSeed(): PublicSeedFile {
  return {
    meta: { units: "kg", rounding_kg: 2.5 },
    oneRmFields: { squat: { label: "스쿼트" } },
    loadRules: { roundKg: 2.5, tmFactor: 0.9 },
    programs: [
      {
        id: "jim-wendler-531",
        completeness: "full",
        sortOrder: 1,
        weeks: [emptyWeek(1, 4)],
      },
      {
        id: "starting-strength",
        completeness: "working",
        sortOrder: 20,
        weeks: [emptyWeek(1, 2)],
      },
      {
        id: "stronglifts-5x5",
        completeness: "working",
        sortOrder: 21,
        weeks: [emptyWeek(1, 2)],
      },
      {
        id: "madcow-5x5",
        completeness: "working",
        sortOrder: 22,
        weeks: [emptyWeek(1, 3)],
      },
      {
        id: "bob-takano",
        completeness: "template",
        sortOrder: 90,
        weeks: [emptyWeek(1, 4)],
      },
    ],
  };
}

describe("seed merge by program id", () => {
  it("infers working only when every week has days", () => {
    expect(inferCompleteness({ id: "jim-wendler-531", weeks: [emptyWeek(1, 4)] })).toBe("full");
    expect(inferCompleteness({ id: "torokhtiy", declared: "template", weeks: Array.from({ length: 13 }, (_, i) => emptyWeek(i + 1, 5)) })).toBe(
      "working",
    );
    expect(
      inferCompleteness({
        id: "lbeb",
        declared: "working",
        weeks: [...Array.from({ length: 6 }, (_, i) => emptyWeek(i + 1, 4)), emptyWeek(7, 0)],
      }),
    ).toBe("template");
  });

  it("replaces by id, keeps P0, stamps completeness from weeks", () => {
    const incoming: PublicSeedProgram = {
      id: "bob-takano",
      nameKo: "Takano full",
      completeness: "template",
      sortOrder: 90,
      weeks: Array.from({ length: 12 }, (_, i) => emptyWeek(i + 1, 4)),
    };
    const { seed, replaced } = mergePublicSeedById(baseSeed(), [incoming]);
    expect(replaced).toEqual(["bob-takano"]);
    expect(seed.programs.find((p) => p.id === "bob-takano")?.completeness).toBe("working");
    expect(seed.programs.find((p) => p.id === "bob-takano")?.weeks).toHaveLength(12);
    for (const id of P0_PROGRAM_IDS) {
      expect(seed.programs.some((p) => p.id === id), id).toBe(true);
    }
  });

  it("decodes gzip+base64 program payloads", () => {
    const json = JSON.stringify({
      programs: [{ id: "catalyst", weeks: Array.from({ length: 12 }, (_, i) => emptyWeek(i + 1, 4)) }],
    });
    const b64 = zlib.gzipSync(json).toString("base64");
    const decoded = decodeGzipBase64(b64);
    expect(programsFromDecoded(decoded)[0].id).toBe("catalyst");
  });
});
