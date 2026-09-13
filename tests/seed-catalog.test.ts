import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getSqlite, resetDbConnection } from "../src/lib/db/client";
import { SEED_REVISION } from "../src/lib/programs/seed-revision";

describe("seed catalog revision", () => {
  const prev = process.env.DATABASE_PATH;

  afterEach(() => {
    resetDbConnection();
    if (prev === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = prev;
  });

  it("refreshes olympic completeness when seed_revision is stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strength-lab-seed-"));
    process.env.DATABASE_PATH = path.join(dir, "app.db");
    resetDbConnection();
    const db = getSqlite();
    expect(db.prepare("SELECT completeness FROM programs WHERE slug='bob-takano'").get()).toEqual({
      completeness: "working",
    });
    expect(db.prepare("SELECT completeness FROM programs WHERE slug='lbeb'").get()).toEqual({
      completeness: "working",
    });
    db.prepare("UPDATE programs SET completeness='template' WHERE slug IN ('bob-takano','catalyst','torokhtiy')").run();
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('seed_revision', 'stale')").run();
    resetDbConnection();
    const again = getSqlite();
    expect(again.prepare("SELECT value FROM app_meta WHERE key='seed_revision'").get()).toEqual({
      value: SEED_REVISION,
    });
    for (const slug of ["bob-takano", "catalyst", "torokhtiy"]) {
      expect(again.prepare("SELECT completeness FROM programs WHERE slug=?").get(slug)).toEqual({
        completeness: "working",
      });
    }
    expect(again.prepare("SELECT completeness FROM programs WHERE slug='lbeb'").get()).toEqual({
      completeness: "working",
    });
  });
});
