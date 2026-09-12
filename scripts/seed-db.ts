import { applySeed } from "../src/lib/db/seed";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";

resetDbConnection();
applySeed(getSqlite());
console.log("Reseeded", process.env.DATABASE_PATH || "data/app.db");
