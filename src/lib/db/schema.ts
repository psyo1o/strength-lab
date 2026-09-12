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
  },
  (t) => [uniqueIndex("set_logs_user_set").on(t.userId, t.programSetId)],
);
