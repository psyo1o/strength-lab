import type { Equipment, IntensityBand, MovementPattern, Stimulus, VolumeBand, WodFormat } from "../types";

export type PieceRole =
  | "lower"
  | "upper"
  | "pull"
  | "hinge"
  | "gym"
  | "olympic"
  | "engine"
  | "mixed"
  | "long"
  | "easy"
  | "benchmark"
  | "aerobic";

export type Recipe = {
  id: string;
  roles: PieceRole[];
  format: WodFormat;
  minutes: number;
  stimulus: Stimulus;
  patterns: MovementPattern[];
  movements: Array<{ key: string; amount: string; name_ko: string }>;
  equipment: Equipment[];
  intensity: IntensityBand;
  volume: VolumeBand;
  mono: boolean;
};

type Body = {
  id: string;
  roles: PieceRole[];
  patterns: MovementPattern[];
  movements: Recipe["movements"];
  equipment: Equipment[];
};

const BODIES: readonly Body[] = [
  { id: "rings", roles: ["gym", "easy", "benchmark"], patterns: ["gymnastic"], movements: [{ key: "ring_row", amount: "8", name_ko: "링 로우" }, { key: "push_up", amount: "6", name_ko: "푸시업" }], equipment: ["rings", "bodyweight"] },
  { id: "pull", roles: ["pull", "mixed"], patterns: ["pull"], movements: [{ key: "pull_up", amount: "6", name_ko: "풀업" }, { key: "burpee", amount: "8", name_ko: "버피" }], equipment: ["pullup_bar", "bodyweight"] },
  { id: "press", roles: ["upper", "mixed"], patterns: ["press"], movements: [{ key: "db_press", amount: "8", name_ko: "덤벨 프레스" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], equipment: ["dumbbell", "bodyweight"] },
  { id: "row", roles: ["engine", "aerobic", "mixed", "long"], patterns: ["engine"], movements: [{ key: "row", amount: "12/10cal", name_ko: "로잉" }, { key: "burpee", amount: "6", name_ko: "버피" }], equipment: ["rower", "bodyweight"] },
  { id: "clean", roles: ["olympic"], patterns: ["olympic"], movements: [{ key: "power_clean", amount: "3", name_ko: "파워 클린" }, { key: "push_up", amount: "6", name_ko: "푸시업" }], equipment: ["barbell", "bodyweight"] },
  { id: "squat", roles: ["lower", "mixed"], patterns: ["squat"], movements: [{ key: "wall_ball", amount: "10", name_ko: "월볼" }, { key: "box_jump", amount: "8", name_ko: "박스 점프" }], equipment: ["wall_ball", "box"] },
  { id: "hinge", roles: ["hinge", "lower", "easy"], patterns: ["hinge"], movements: [{ key: "kb_swing", amount: "10", name_ko: "케틀벨 스윙" }, { key: "burpee", amount: "6", name_ko: "버피" }], equipment: ["kettlebell", "bodyweight"] },
  { id: "bike", roles: ["aerobic", "engine", "long"], patterns: ["engine"], movements: [{ key: "fan_bike", amount: "10/8cal", name_ko: "팬바이크" }, { key: "double_under", amount: "30", name_ko: "더블언더" }], equipment: ["bike", "jump_rope"] },
  { id: "ski", roles: ["long", "aerobic"], patterns: ["engine"], movements: [{ key: "ski", amount: "200m", name_ko: "스키" }, { key: "row", amount: "12/10cal", name_ko: "로잉" }, { key: "sit_up", amount: "8", name_ko: "싯업" }], equipment: ["ski", "rower", "bodyweight"] },
  { id: "core", roles: ["upper", "easy", "gym"], patterns: ["press"], movements: [{ key: "push_up", amount: "8", name_ko: "푸시업" }, { key: "sit_up", amount: "8", name_ko: "싯업" }], equipment: ["bodyweight"] },
  { id: "chip", roles: ["benchmark", "gym", "mixed", "pull"], patterns: ["gymnastic"], movements: [{ key: "burpee", amount: "8", name_ko: "버피" }, { key: "pull_up", amount: "5", name_ko: "풀업" }, { key: "sit_up", amount: "10", name_ko: "싯업" }], equipment: ["pullup_bar", "bodyweight"] },
  { id: "mono", roles: ["aerobic"], patterns: ["engine"], movements: [{ key: "fan_bike", amount: "12/10cal", name_ko: "팬바이크" }], equipment: ["bike"] },
];

const FORMATS: readonly WodFormat[] = ["amrap", "for_time", "emom", "intervals"];
const STIMULI: readonly Stimulus[] = ["technical", "high_rep"];
const VOLUMES: readonly VolumeBand[] = ["low", "moderate", "high"];

function rotate<T>(rows: readonly T[], salt: number): T[] {
  if (rows.length === 0) return [];
  const start = ((salt % rows.length) + rows.length) % rows.length;
  return [...rows.slice(start), ...rows.slice(0, start)];
}

function minutesFor(longPiece: boolean, shortPiece: boolean, salt: number): number[] {
  if (longPiece) return rotate([32, 34, 36], salt);
  if (shortPiece) return rotate([10, 12], salt);
  return rotate([14, 16, 18], salt);
}

/** Cross of format, stimulus, volume, and movement pair. The search keeps only non-colliding rows. */
export function recipePool(input: { role: PieceRole; salt: number; short: boolean; long: boolean; allowMono: boolean }): Recipe[] {
  const preferred = BODIES.filter((body) => body.roles.includes(input.role) && (input.allowMono || body.movements.length > 1));
  const bodies = rotate(preferred.length ? preferred : BODIES.filter((body) => body.movements.length > 1), input.salt);
  const extra = rotate(BODIES.filter((body) => body.movements.length > 1 && !bodies.includes(body)), input.salt + 1);
  const formats = rotate(FORMATS, input.salt);
  const stimuli = rotate(STIMULI, input.salt);
  const volumes = rotate(VOLUMES, input.salt);
  const minutes = minutesFor(input.long, input.short, input.salt);
  const recipes: Recipe[] = [];
  for (const body of [...bodies, ...extra]) {
    if (!input.allowMono && body.movements.length < 2) continue;
    for (const format of formats) {
      for (const stimulus of stimuli) {
        for (const volume of volumes) {
          for (const minute of minutes) {
            recipes.push({
              id: `${body.id}-${format}-${stimulus}-${volume}-${minute}`,
              roles: body.roles,
              format,
              minutes: minute,
              stimulus,
              patterns: body.patterns,
              movements: body.movements,
              equipment: body.equipment,
              intensity: volume === "low" ? "light" : "moderate",
              volume,
              mono: body.movements.length < 2,
            });
          }
        }
      }
    }
  }
  return recipes;
}

/** Movement keys the session contract, the prompt, and the parser all share. */
export function movementCatalog(): ReadonlyArray<{ key: string; name_ko: string }> {
  const seen = new Map<string, string>();
  for (const body of BODIES) {
    for (const movement of body.movements) seen.set(movement.key, movement.name_ko);
  }
  return [...seen.entries()].map(([key, name_ko]) => ({ key, name_ko }));
}

export function roleFor(primary: string, secondary: string): PieceRole {
  if (secondary === "long_conditioning") return "long";
  if (primary === "recovery") return "easy";
  if (primary === "lower_strength") return "lower";
  if (primary === "posterior_chain") return "hinge";
  if (primary === "upper_strength") return "upper";
  if (primary === "upper_pull") return "pull";
  if (primary === "gymnastics_skill") return "gym";
  if (primary === "olympic_strength" || primary === "olympic_technique") return "olympic";
  if (primary === "aerobic") return "aerobic";
  if (primary === "mixed_modal") return "mixed";
  return "mixed";
}
