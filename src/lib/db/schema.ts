import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  unit: text("unit", { enum: ["kg", "lb"] })
    .notNull()
    .default("kg"),
  currentProgram: text("current_program"),
  lastSession: text("last_session"),
  sex: text("sex"),
  isAdmin: integer("is_admin").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
});

export const userMaxes = sqliteTable(
  "user_maxes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    exerciseKey: text("exercise_key").notNull(),
    oneRmKg: real("one_rm_kg").notNull(),
    startKg: real("start_kg"),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [uniqueIndex("user_maxes_user_ex").on(t.userId, t.exerciseKey)],
);

export const exercises = sqliteTable("exercises", {
  key: text("key").primaryKey(),
  nameKo: text("name_ko").notNull(),
  nameEn: text("name_en").notNull(),
  group: text("group").notNull(),
  isMax: integer("is_max", { mode: "boolean" }).notNull().default(false),
  tipsKo: text("tips_ko").notNull().default(""),
  tipsEn: text("tips_en").notNull().default(""),
});

export const programs = sqliteTable("programs", {
  slug: text("slug").primaryKey(),
  nameKo: text("name_ko").notNull(),
  nameEn: text("name_en").notNull(),
  category: text("category").notNull(),
  completeness: text("completeness").notNull(),
  descriptionKo: text("description_ko").notNull(),
  descriptionEn: text("description_en").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const programWeeks = sqliteTable("program_weeks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  programSlug: text("program_slug")
    .notNull()
    .references(() => programs.slug, { onDelete: "cascade" }),
  weekNumber: integer("week_number").notNull(),
  nameKo: text("name_ko").notNull(),
  notesKo: text("notes_ko").notNull().default(""),
});

export const programDays = sqliteTable("program_days", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekId: integer("week_id")
    .notNull()
    .references(() => programWeeks.id, { onDelete: "cascade" }),
  dayNumber: integer("day_number").notNull(),
  nameKo: text("name_ko").notNull(),
  notesKo: text("notes_ko").notNull().default(""),
});

export const programExercises = sqliteTable("program_exercises", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dayId: integer("day_id")
    .notNull()
    .references(() => programDays.id, { onDelete: "cascade" }),
  exerciseKey: text("exercise_key").notNull(),
  role: text("role").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  notesKo: text("notes_ko").notNull().default(""),
});

export const programSets = sqliteTable("program_sets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  exerciseId: integer("exercise_id")
    .notNull()
    .references(() => programExercises.id, { onDelete: "cascade" }),
  setNumber: integer("set_number").notNull(),
  percentBase: text("percent_base").notNull(),
  percent: real("percent"),
  reps: integer("reps").notNull(),
  amrap: integer("amrap", { mode: "boolean" }).notNull().default(false),
  restSec: integer("rest_sec"),
  noteKo: text("note_ko").notNull().default(""),
});

export const passwordResetTokens = sqliteTable("password_reset_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const authThrottle = sqliteTable("auth_throttle", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  throttleKey: text("throttle_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const setLogs = sqliteTable(
  "set_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    programSetId: integer("program_set_id")
      .notNull()
      .references(() => programSets.id, { onDelete: "cascade" }),
    completed: integer("completed", { mode: "boolean" }).notNull().default(true),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
    weightKg: real("weight_kg"),
  },
  (t) => [uniqueIndex("set_logs_user_set").on(t.userId, t.programSetId)],
);

export const wodResults = sqliteTable("wod_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  templateSlug: text("template_slug").notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  tier: text("tier").notNull().default("rx"),
  scoreType: text("score_type").notNull(),
  timeSec: integer("time_sec"),
  rounds: integer("rounds"),
  extraReps: integer("extra_reps"),
  notesKo: text("notes_ko").notNull().default(""),
  scaleNotes: text("scale_notes").notNull().default(""),
  substitutions: text("substitutions").notNull().default(""),
  equipmentJson: text("equipment_json").notNull().default(""),
});

export const monthPlans = sqliteTable("month_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  weekIndex: integer("week_index").notNull(),
  weekStart: text("week_start").notNull(),
  sex: text("sex"),
  planJson: text("plan_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const monthPlanScores = sqliteTable("month_plan_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  planId: integer("plan_id")
    .notNull()
    .references(() => monthPlans.id, { onDelete: "cascade" }),
  dayKey: text("day_key").notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  timeSec: integer("time_sec"),
  rounds: integer("rounds"),
  extraReps: integer("extra_reps"),
  pieceKey: text("piece_key").notNull().default(""),
  pieceNameKo: text("piece_name_ko").notNull().default(""),
  named: integer("named", { mode: "boolean" }).notNull().default(false),
  signature: text("signature").notNull().default(""),
  notesKo: text("notes_ko").notNull().default(""),
});

export const classWeeks = sqliteTable("class_weeks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekIndex: integer("week_index").notNull(),
  weekStart: text("week_start").notNull().unique(),
  sex: text("sex"),
  planJson: text("plan_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const classDayScores = sqliteTable("class_day_scores", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  classWeekId: integer("class_week_id")
    .notNull()
    .references(() => classWeeks.id, { onDelete: "cascade" }),
  dayKey: text("day_key").notNull(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }).notNull(),
  timeSec: integer("time_sec"),
  rounds: integer("rounds"),
  extraReps: integer("extra_reps"),
  pieceKey: text("piece_key").notNull().default(""),
  pieceNameKo: text("piece_name_ko").notNull().default(""),
  named: integer("named", { mode: "boolean" }).notNull().default(false),
  signature: text("signature").notNull().default(""),
  notesKo: text("notes_ko").notNull().default(""),
  scaling: text("scaling").notNull().default(""),
  fatigue: integer("fatigue"),
});

export const programmingMonths = sqliteTable(
  "programming_months",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monthStart: text("month_start").notNull(),
    scheme: text("scheme").notNull(),
    directionJson: text("direction_json").notNull(),
    inputSummaryJson: text("input_summary_json").notNull(),
    priorEvaluationId: integer("prior_evaluation_id"),
    generationSource: text("generation_source").notNull(),
    fallbackReason: text("fallback_reason"),
    generatedAt: integer("generated_at").notNull(),
    engineVersion: text("engine_version").notNull(),
    createdAt: integer("created_at").notNull(),
    status: text("status").notNull().default("active"),
    generationVersion: integer("generation_version").notNull().default(1),
    generationAttempt: integer("generation_attempt").notNull().default(1),
    modelName: text("model_name"),
    promptVersion: text("prompt_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    generationTimestamp: integer("generation_timestamp").notNull(),
    inputSummaryVersion: text("input_summary_version").notNull(),
  },
  (t) => [uniqueIndex("programming_months_one_active").on(t.monthStart).where(sql`status = 'active'`)],
);

export const programmingWeeks = sqliteTable(
  "programming_weeks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    monthId: integer("month_id")
      .notNull()
      .references(() => programmingMonths.id),
    weekIndex: integer("week_index").notNull(),
    weekStart: text("week_start").notNull(),
    classWeekId: integer("class_week_id").references(() => classWeeks.id),
    intentJson: text("intent_json").notNull(),
    planJson: text("plan_json").notNull(),
    displayJson: text("display_json").notNull(),
    inputSummaryJson: text("input_summary_json").notNull(),
    generationSource: text("generation_source").notNull(),
    fallbackReason: text("fallback_reason"),
    generatedAt: integer("generated_at").notNull(),
    engineVersion: text("engine_version").notNull(),
    createdAt: integer("created_at").notNull(),
    status: text("status").notNull().default("active"),
    generationVersion: integer("generation_version").notNull().default(1),
    generationAttempt: integer("generation_attempt").notNull().default(1),
    modelName: text("model_name"),
    promptVersion: text("prompt_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    generationTimestamp: integer("generation_timestamp").notNull(),
    inputSummaryVersion: text("input_summary_version").notNull(),
  },
  (t) => [
    uniqueIndex("programming_weeks_one_active_start").on(t.weekStart).where(sql`status = 'active'`),
    uniqueIndex("programming_weeks_one_active_slot").on(t.monthId, t.weekIndex).where(sql`status = 'active'`),
  ],
);

export const programmingSyncs = sqliteTable("programming_syncs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  programmingWeekId: integer("programming_week_id")
    .notNull()
    .references(() => programmingWeeks.id, { onDelete: "cascade" }),
  classWeekId: integer("class_week_id")
    .notNull()
    .references(() => classWeeks.id),
  syncedAt: integer("synced_at").notNull(),
  replacedDays: text("replaced_days").notNull(),
  keptJson: text("kept_json").notNull(),
});

export const programmingMonthProposals = sqliteTable("programming_month_proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monthId: integer("month_id")
    .notNull()
    .references(() => programmingMonths.id),
  proposalJson: text("proposal_json").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: integer("created_at").notNull(),
});

export const programmingGenerationLogs = sqliteTable("programming_generation_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),
  scopeKey: text("scope_key").notNull(),
  planId: integer("plan_id"),
  generationAttempt: integer("generation_attempt").notNull(),
  promptVersion: text("prompt_version").notNull(),
  modelName: text("model_name"),
  rawJson: text("raw_json").notNull(),
  createdAt: integer("created_at").notNull(),
  latencyMs: integer("latency_ms"),
});

export const programmingActuals = sqliteTable("programming_actuals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekId: integer("week_id")
    .notNull()
    .unique()
    .references(() => programmingWeeks.id, { onDelete: "cascade" }),
  actualJson: text("actual_json").notNull(),
  recordedAt: integer("recorded_at").notNull(),
});

export const programmingEvaluations = sqliteTable("programming_evaluations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  monthId: integer("month_id")
    .notNull()
    .unique()
    .references(() => programmingMonths.id, { onDelete: "cascade" }),
  evaluationJson: text("evaluation_json").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const wodStructures = sqliteTable("wod_structures", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  weekId: integer("week_id")
    .notNull()
    .references(() => programmingWeeks.id, { onDelete: "cascade" }),
  dayKey: text("day_key").notNull(),
  format: text("format").notNull(),
  timeDomain: text("time_domain").notNull(),
  stimulus: text("stimulus"),
  movementPatterns: text("movement_patterns").notNull(),
  movements: text("movements").notNull(),
  equipment: text("equipment").notNull(),
  repStructure: text("rep_structure").notNull(),
  workRestStructure: text("work_rest_structure").notNull(),
  durationMin: integer("duration_min").notNull(),
  volume: text("volume").notNull(),
  intensity: text("intensity").notNull(),
  benchmark: integer("benchmark").notNull().default(0),
  longConditioning: integer("long_conditioning").notNull().default(0),
});

export const userEquipment = sqliteTable("user_equipment", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  boxHeightCm: real("box_height_cm"),
  wallBallKg: real("wall_ball_kg"),
  wallBallTargetM: real("wall_ball_target_m"),
  duRope: text("du_rope").notNull().default(""),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
