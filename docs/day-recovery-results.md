# 날짜 단위 복구 결과

모킹 테스트와 2099 실제 모델 테스트는 따로 적는다. 폴백은 성공이 아니다. 실행하지 않은 항목은 통과로 적지 않는다.

## 1. 주 전체를 폴백으로 만들던 코드

`writeSession` (`orchestrate.ts`)이 전문 코치 한 곳만 실패해도 `{ draft: input.draft, source: "fallback" }`을 반환했다. `input.draft`는 그 날의 모델 출력이 아니라 `assembleLegalWeek`가 미리 넣어 둔 기본 세션이다. 훈련 루프는 `source === "model"`일 때만 그 날을 바꾼다. 그래서 다른 모델 날은 남고, 깨진 날은 기본 세션으로 남았다.

그 기본 세션은 `finalWeekReport`를 통과했다. 헤드는 스키마 오류를 보지 못한 채 `APPROVE_WITH_NOTE`를 낼 수 있었고, 주는 `fallback_after_model_failure`로 활성 저장되었다. `askCoach`의 내부 재시도만 오류를 받았고, 그 재시도 사용자는 원래 입력을 덮어썼다.

## 2. 바꾼 파일

| 파일 | 역할 |
|---|---|
| `src/lib/programming/coaching/day-recovery.ts` | 복구 페이로드, 일시 오류 구분, 잘못된 수정 명세 판정 |
| `src/lib/programming/coaching/orchestrate.ts` | 실패 영역만 재호출, 미해결 날, 승인 거부 |
| `src/lib/programming/coaching/contract.ts` | 헤드 상태에 `BLOCK` |
| `src/lib/programming/coaching/prompts.ts` | 헤드 프롬프트 `head-coach-v4` |
| `src/lib/programming/coaching/review.ts` | `BLOCK` 파싱 |
| `src/lib/programming/coaching/stage14/merge.ts` | `BLOCK`을 재생성으로 바꾸지 않음 |
| `src/lib/programming/coaching/stage16/pass.ts` | `BLOCK`은 필드 조정으로 가지 않음 |
| `src/lib/programming/coaching/trace.ts` | `revision_rejected`, `approval_refused` |
| `src/lib/programming/engine.ts` | 미해결 주의 사유 보존, `too_similar`는 충돌한 날만 교체 |
| `docs/generation-paths.md` | 같은 커밋의 경로·프롬프트·폴백 설명 |
| `tests/day-recovery.test.ts` | A·B |
| `tests/programming-stage10.test.ts` | 전체 스키마 실패는 활성 주가 아님 |
| `tests/coaching-schema-adoption.test.ts` | 유사도 교체 뒤에도 다른 날의 모델 워밍업이 남음 |

## 3. 날짜 단위 복구

`revisionNumber === 0`이고 사유가 `http_error`나 `timeout`이 아니면, 실패한 영역만 `askSpecialist`를 한 번 더 부른다. 상한은 `MAX_DAY_SCHEMA_RECOVERIES = 1`이다. `COACHING_POLICY.max_head_revisions`는 2 그대로다. 그 호출 사용자에 `day_recovery`가 있다. 월간 방향, 주간 목표, 날의 역할, 기존 세션, `validation_errors`, 실패한 필드와 값, 기대 형식, 이전 시도, 보존·허용·금지, 이웃 날이 들어간다.

`askCoach`는 그 호출 안에서 검증 실패를 한 번 더 고친다. 그래도 실패하면 세 번째 전문 코치 호출은 없다. 그 날은 `day_status` `FAILED`, `final_prescription` null, `day_sources`는 `fallback`이다. 다른 날 세션은 유지한다. 미해결 날이 있으면 `final_validation.ok`는 false이고 활성 정상 주로 저장하지 않는다. HTTP와 timeout은 이 복구를 타지 않는다.

헤드가 시킨 재생성(`revisionNumber > 0`)은 이 복구를 다시 타지 않는다. 그 결과가 무효면 직전 세션을 유지한다.

## 4. 헤드 명세가 전문 코치에게 가는 경로

헤드 JSON을 `parseHeadReview`로 읽는다. `target_coach`가 `strength_coach`, `conditioning_coach`, `warmup_coach` 중 하나이고 그 날이 훈련일이며 `allowed_changes`에 주간 뼈대·월간 방법·다른 날이 없으면, 그 날의 그 코치만 `writeSession`으로 다시 부른다. 상한은 2다. 주간 뼈대와 다른 날은 다시 만들지 않는다. 재검증 범위는 고친 날과 앞뒤 이웃이다. 잘못된 명세는 `revision_rejected`에 남고 호출하지 않는다.

## 5. 승인과 하드 검증

`APPROVE`와 `APPROVE_WITH_NOTE`는 하드 오류를 지우지 않는다. 미해결 날이나 남은 하드 오류가 있으면 `approval_refused`를 남기고 `generation_source`는 `model`이 아니다. `BLOCK`도 채택하지 않는다. `head-coach-v4`가 이 구분을 말한다. 필드 조정은 이전과 같이 생성기를 다시 부르지 않는다.

## 6. 경로와 예외

저장하는 주 생성은 `writeProgrammingWeek` → `runCoachingOrchestrator`다. 화면, admin 저장, plan-lab이 이 입구다.

아직 예외다.

- `dry-run-week`는 `authorWeek`다. DB에 쓰지 않는다. HTTP 500이면 호출 2번, 스탬프 `weekly-program-v10`.
- 월 행은 `authorMonth`, 스탬프 `monthly-program-v4`.
- `simulateFourWeeks`는 점수용이며 키 없는 `coachWeek`다.

## 7. 테스트

실제 모델 호출 0.

- `tests/day-recovery.test.ts` 8개 통과. 월요일만 미해결, 수정 성공 시 월요일만 교체, 오류가 다음 호출에 포함, 한도 후 기본 세션으로 채택하지 않음, 무효한 재수정이 유효 세션을 덮지 않음, 하드 오류가 있는 승인 거부, 잘못된 코치·범위 거부, `BLOCK` 거부, 미리보기 무기록, 저장 경로는 `coaching-pipeline-v6`, 미해결 주는 활성 행이 아님.
- 유사도 국소 교체는 `tests/coaching-schema-adoption.test.ts`. 임계값 4. 복사 토큰은 빠지고 다른 날의 `모델` 워밍업은 남는다.
- `tsc --noEmit` 통과.
- Vitest 54파일 358개 통과. Phase B 테스트는 이 브랜치 스위트에 포함된다. Phase C 브랜치는 실행하지 않았다.

## 8. 모킹과 실제 모델

위의 Vitest는 픽스처다. 헤드가 실제 모델에서 명세를 냈다는 증거가 아니다. 아래 9·10만 `gpt-5.4-nano`, 임시 DB `/tmp/day-recovery-phaseb.db`, `PROBE_FLAGS=off`, `PROBE_SCENARIOS=W1`, `PROBE_PASSES=A1`이다. 첫 호출은 429가 아니었다. 키는 출력하지 않았다. 길이는 164였다.

## 9. 2099 실제 결과

`2099-07-06` W1은 활성 행이다. `generation_source`는 `model`, `fallback_reason`은 null, 스탬프트는 `coaching-pipeline-v6`, `week_status`는 `VALIDATED`, `final_status`는 `APPROVE_WITH_NOTE`, `prescription_source`는 `model_revised`다. 훈련 6일 모두 `MODEL_REVISED`이고 `FAILED`는 없다.

스키마 복구는 화요일과 금요일 컨디셔닝이다. 화요일 `fan_bike` 수량 `cal`은 횟수가 없었다. 복구 호출에 그 오류와 필드 값이 들어갔고, 통과한 출력은 `fan_bike:10cal`, `double_under:30`이다. 금요일 `row` 수량 `0.5 cal`도 복구 호출에 오류가 들어갔고, 통과한 출력은 `kb_swing:10reps`, `burpee:6reps`다. `row`는 빠졌다. 서버는 스키마를 통과한 모델 출력을 저장했다. 그 수량을 기존 합의 규칙으로 적지는 않았다.

헤드는 `head-coach-v4`로 `REVISE`를 냈고 `target_coach`는 `conditioning_coach`, 날은 목요일이다. `revision_scope`는 `wed, thu, fri`, 다시 쓴 날은 `thu`만, `regeneration_calls` 1, `budget` 2다. 목요일 밖 날은 헤드 재생성으로 바뀌지 않았다. 목요일 출력은 `power_clean:6 reps`, `box_jump:6 reps`다. 헤드 문장이 요구한 동작 교체와는 다르다. 경로는 실행되었고, 내용이 명세를 그대로 따르지는 않았다.

직전 주 `2099-06-29`도 활성 `model`이다. 월요일 `push_up` 수량 `reps`, 화요일 `fan_bike` 문장, 토요일 `row` 수량 `cal`을 복구했다. 이 주의 헤드는 `APPROVE_WITH_NOTE`이고 수정 명세는 없다. 이 주는 실제 헤드 수정 경로의 증거가 아니다.

저장본에 `judgeWeek`를 다시 돌리면 두 주 모두 `rule_break`다. 기술 자극 반복과 점수 4 유사 쌍이 있다. 코칭 파이프라인은 이 문장을 신호가 아닌 하드 오류로 보지 않아서 `final_validation`은 통과했다. 저장 훅은 사유가 정확히 `too_similar`일 때만 충돌 날을 바꾼다. 이번 저장 사유는 `rule_break`가 먼저라 그 훅은 돌지 않았다.

`2099-07-01` 월 행은 `fallback`, 스탬프 `monthly-program-v4`, 사유 `language`, 시도 2다. 토큰은 없다. `2099-06-01` 월 행은 `model`이고 토큰은 없다. 없는 토큰을 0으로 두지 않았다.

## 10. 호출과 토큰

W1 `2099-07-06`: 모델 호출 23, 실패한 모델 트레이스 2, 토큰 164954. plan-lab 요약과 같다. 미해결 날은 0이다. plan-lab의 `unresolved_days: 0`은 스켈레톤 계수다.

직전 주 `2099-06-29`: 모델 호출 23, 실패한 모델 트레이스 3, 토큰 77471. 이 수는 W1 요약에 더하지 않았다.

월 로그에는 `token_usage`가 없다. null이다.

12주 프로브는 실행하지 않았다. 한 주 채택과 실제 헤드 명세는 나왔지만, 저장본에 점수 4 유사와 자극 반복이 남아 있다.

## 11. 남은 문제

- 복구 모델이 깨진 필드 밖을 바꿀 수 있다. 금요일은 `row`가 빠졌다. 화요일은 동작이 늘었다.
- 헤드가 목요일 동작 교체를 말했지만, 통과한 출력은 같은 동작의 수량 변경이다.
- 채택된 주에도 `judgeWeek` 기준 자극 반복과 점수 4 유사 쌍이 남는다. 파이프라인은 이것을 신호로 둔다. 임계값은 4에서 내리지 않았다.
- `dry-run-week`와 `authorMonth`는 주 오케스트레이터 밖이다.
- 12주와 Phase C는 실행하지 않았다.
