/**
 * 저장된 주에 finalWeekReport를 다시 계산해 hard 개수와 규칙 유형을 출력한다.
 * 데이터베이스를 열 때는 readonly다. 행을 고치거나 상태를 바꾸지 않는다.
 * 운영 주 2026-10-05, 2026-10-12는 조회에서 뺀다.
 *
 * 필요한 데이터: DATABASE_PATH가 가리키는 격리 SQLite.
 * programming_months.direction_json과 programming_weeks.plan_json이 있어야 한다.
 * 경로가 없으면 data/app.db를 열지 않고 끝낸다.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { finalWeekReport } from "../src/lib/programming/coaching/stage13/validators";
import { extractWeekRules } from "../src/lib/programming/coaching/stage13/rules";
import { classifyProgramError } from "../src/lib/programming/coaching/stage15/hard-rules";
import type { MonthDirection, WeekDraft, WeekIndex } from "../src/lib/programming/types";

const EXCLUDED = ["2026-10-05", "2026-10-12"];

type WeekSql = {
  id: number;
  month_id: number;
  week_index: number;
  week_start: string;
  status: string;
  plan_json: string;
};

type MonthSql = { id: number; direction_json: string };

function isWeekIndex(value: number): value is WeekIndex {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

function main() {
  const file = process.env.DATABASE_PATH?.trim();
  if (!file) {
    console.log("측정할 격리 데이터베이스가 없다. DATABASE_PATH에 programming_weeks가 있는 SQLite 경로가 필요하다. 운영 데이터베이스와 2026-10-05, 2026-10-12는 대상이 아니다.");
    return;
  }
  if (!fs.existsSync(file)) {
    console.log(`파일이 없다: ${file}`);
    return;
  }
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const months = new Map<number, MonthDirection>();
    for (const row of db.prepare("SELECT id, direction_json FROM programming_months").all() as MonthSql[]) {
      months.set(row.id, JSON.parse(row.direction_json) as MonthDirection);
    }
    const weeks = db
      .prepare(
        `SELECT id, month_id, week_index, week_start, status, plan_json
         FROM programming_weeks
         WHERE week_start NOT IN (${EXCLUDED.map(() => "?").join(", ")})
         ORDER BY week_start, id`,
      )
      .all(...EXCLUDED) as WeekSql[];
    if (weeks.length === 0) {
      console.log("제외 주를 빼고 나면 측정할 주가 없다.");
      return;
    }
    const byCode = new Map<string, number>();
    let hardTotal = 0;
    for (const week of weeks) {
      const month = months.get(week.month_id);
      if (!month || !isWeekIndex(week.week_index)) {
        console.log(`${week.week_start} id=${week.id} status=${week.status} 측정 불가: 월 방향 또는 week_index`);
        continue;
      }
      const draft = JSON.parse(week.plan_json) as WeekDraft;
      const report = finalWeekReport({
        draft,
        month,
        weekIndex: week.week_index,
        recent: [],
        rules: extractWeekRules({ month, weekIndex: week.week_index }),
      });
      hardTotal += report.hard.length;
      const local = new Map<string, number>();
      for (const error of report.hard) {
        const classified = classifyProgramError(error);
        const code = "code" in classified ? classified.code : "NOT_HARD";
        local.set(code, (local.get(code) ?? 0) + 1);
        byCode.set(code, (byCode.get(code) ?? 0) + 1);
      }
      const spread = [...local.entries()].map(([code, count]) => `${code}=${count}`).join(", ") || "없음";
      console.log(`${week.week_start} id=${week.id} status=${week.status} hard=${report.hard.length} ${spread}`);
    }
    const summary = [...byCode.entries()].map(([code, count]) => `${code}=${count}`).join(", ") || "없음";
    console.log(`주 ${weeks.length}개, hard 합계 ${hardTotal}, 유형 ${summary}`);
  } finally {
    db.close();
  }
}

main();
