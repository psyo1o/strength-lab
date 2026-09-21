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
