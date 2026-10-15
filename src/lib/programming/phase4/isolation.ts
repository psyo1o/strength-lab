import path from "node:path";

const OPERATIONAL = ["2026-10-05", "2026-10-12"];

/**
 * 프로브 DB는 /tmp 아래이고 경로에 2099가 있어야 한다.
 * 응용 DB와 운영 주 날짜가 있으면 즉시 예외다.
 */
export function assertIsolated2099Database(file: string, rows: { months: readonly string[]; weeks: readonly string[] }): void {
  const base = path.resolve(file);
  if (!base.startsWith("/tmp/")) throw new Error("probe database must live under /tmp");
  if (!base.includes("2099")) throw new Error("probe database path must name 2099");
  if (base.includes(`${path.sep}data${path.sep}`) || base.endsWith(`${path.sep}app.db`)) {
    throw new Error("refusing application database");
  }
  for (const value of [...rows.months, ...rows.weeks]) {
    if (OPERATIONAL.some((banned) => value.includes(banned))) throw new Error(`refusing operational date ${value}`);
    if (!value.startsWith("2099-")) throw new Error(`refusing non-2099 row ${value}`);
  }
}
