/**
 * fallback 주를 활성 주로 저장하고 수업 화면에 복사할지의 스위치.
 * 정확히 "1"일 때만 켜진다. 기본값은 꺼짐이다.
 * 결정적 goal_table 다양성(P2)이 고쳐지기 전에는 켜지 않는다.
 */
export function fallbackWeekDisplayEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FALLBACK_WEEK_DISPLAY === "1";
}
