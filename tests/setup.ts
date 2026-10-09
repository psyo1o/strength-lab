import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-"));
process.env.DATABASE_PATH = path.join(dir, "app.db");
process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
