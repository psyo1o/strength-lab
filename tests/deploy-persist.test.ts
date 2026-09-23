import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("deploy must not wipe sqlite", () => {
  it("pull scripts never delete volumes or the db file", () => {
    for (const rel of ["deploy-pull.sh", "scripts/deploy-pull.sh"]) {
      const sh = read(rel);
      const code = sh
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      expect(sh, rel).toMatch(/pull does not wipe user data/);
      expect(code, rel).not.toMatch(/compose[^\n]*down/);
      expect(code, rel).not.toMatch(/--force-recreate/);
      expect(code, rel).not.toMatch(/volume rm/);
      expect(code, rel).not.toMatch(/\brm\s+(-[^\n]*\s+)*(\$DATABASE_PATH|\$DATA_DIR\/app\.db)/);
      expect(sh, rel).toMatch(/mkdir -p "\$DATA_DIR"/);
      expect(sh, rel).toMatch(/up -d --remove-orphans/);
    }
  });

  it("compose mounts sqlite on a named volume or NAS bind path", () => {
    const compose = read("docker-compose.yml");
    expect(compose).toMatch(/strength-lab-data:\/data/);
    expect(compose).toMatch(/name:\s*strength-lab-data/);
    expect(compose).toMatch(/DATABASE_PATH: \/data\/app\.db/);
    const nas = read("docker-compose.nas.yml");
    expect(nas).toMatch(/\$\{DATA_DIR:-\/volume1\/docker\/strength-lab\/data\}:\/data/);
    expect(nas).toMatch(/DATABASE_PATH: \/data\/app\.db/);
    expect(nas).toMatch(/pull \+ up does NOT wipe/);
  });

  it("entrypoint never deletes sqlite and refuses the image data path", () => {
    const sh = read("docker-entrypoint.sh");
    expect(sh).not.toMatch(/rm .+DATABASE_PATH|rm .+app\.db/);
    expect(sh).toMatch(/\/data\/app\.db/);
    expect(sh).toMatch(/\/app\/data/);
    expect(sh).toMatch(/Never delete/);
  });

  it("seed catalog SQL never deletes users, maxes, sessions, WOD history, or set_logs", () => {
    const seed = read("src/lib/db/seed.ts");
    expect(seed).not.toMatch(/DELETE FROM users\b/);
    expect(seed).not.toMatch(/DELETE FROM user_maxes\b/);
    expect(seed).not.toMatch(/DELETE FROM wod_results\b/);
    expect(seed).not.toMatch(/DELETE FROM sessions\b/);
    expect(seed).not.toMatch(/DELETE FROM set_logs\b/);
    expect(seed).toMatch(/FORCE_RESEED === "1"/);
    expect(seed).toMatch(/upserting catalog in place/);
    expect(seed).toMatch(/seed refused: set_logs would be wiped/);
    expect(seed).toMatch(/seed refused: users would be wiped/);
    const deploy = read("DEPLOY-CI.md");
    expect(deploy).toMatch(/pull does not wipe user data/);
    expect(deploy).toMatch(/pull does not wipe logs/);
  });
});
