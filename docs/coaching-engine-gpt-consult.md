# 코칭 엔진 통합 — GPT 협의

이 문서는 PR #64 구현과 2099 한 주 프로브를 다음에 고칠 때 쓰기 위한 기록이다. 임계값 4를 낮추거나 실패 테스트를 지우자는 제안은 받지 않는다. 운영 주 `2026-10-05`, `2026-10-12`는 생성하지 않았다.

## 지금 경로

저장되는 주는 `writeProgrammingWeek` → `runCoachingOrchestrator`다.

- 키가 `null`이거나 빈 문자열이면 `{ kind: "no-model" }`이다. `coachWeek`를 부르지 않고 기존 `weekly-program-v10` / `no_model` 초안을 쓴다. `coachWeekKeyless`는 스탬프가 `coaching-pipeline-v2`라 화면 블록을 바꾸므로 쓰지 않는다.
- 키가 문자열이면 `coachWeekActive`다. 스탬프는 `coaching-pipeline-v6`다.
- 월 코치 응답이 세션 7개면 `authorWeek`가 `wod-from-intent-v1`로 판정한다. 실제 월 JSON은 그 분기가 아니다. 기존 주 JSON 테스트의 의미를 유지하려고 둔 입구다.
- 훈련일은 `strength-coach-v1`, `conditioning-coach-v1`, `warmup-coach-v1`이 각자 스키마로 쓴다. 세트는 방법 표다.
- 헤드가 `target_coach`를 주면 그 날의 그 코치만 다시 부른다. 상한은 `COACHING_POLICY.max_head_revisions`인 2다. 필드 조정은 재생성하지 않는다.
- 월 행은 여전히 `authorMonth` / `monthly-program-v4`다.
- `dry-run-week`는 DB에 쓰지 않는 미리보기이고 `authorWeek`를 직접 부른다. 저장 경로와 다르다. 옮기려면 별도 승인이 필요하다.

## 모킹에서 확인한 것

`vitest run`은 파일 53, 테스트 350이 통과했다. 모델 호출은 없다.

- 한 번에 주 JSON을 돌려주는 기존 테스트는 모델 채택, `wod-from-intent-v1`, `too_similar`, 임계값 4를 유지한다.
- `tests/coaching-schema-adoption.test.ts`는 전문 코치 스키마로 만든 주가 `coaching-pipeline-v6`로 채택되는지, 최근 구조와 4점 이상 겹치면 저장 사유가 `too_similar`인지 본다.
- `tests/coaching-active.test.ts`는 `target_coach`가 그 날만 다시 쓰는지 본다. case 11·12는 필드 조정만 한다.

`sessionFromCoachJson`은 `movement_pattern`을 운동이 아니라 그 날 intent에서 찍는다. `mixed`와 `none`은 `engine`이다. 그래서 mixed인 날들이 시간 영역·자극·볼륨까지 같으면 같은 주 유사도가 4가 된다. 모킹은 화요일을 10분으로 둬 시간 영역을 갈랐다. 임계값은 바꾸지 않았다.

## 2099 한 주

`scripts/plan-lab.ts`, 임시 DB `/tmp/coaching-engine-d-phaseb.db`, 모델 `gpt-5.4-nano`, `PROBE_FLAGS=off`, 시나리오 W1, 패스 A1. 첫 호출은 429가 아니어서 멈추지 않았다. 숫자는 `docs/coaching-engine-refactor-probe.json`이다.

| 주 | 출처 | 사유 | 모델 호출 | 실패 호출 | 토큰 |
|---|---|---|---|---|---|
| 2099-06-29 (선행) | fallback | `fallback_after_model_failure:4/6` | 21 | 2 | 71329 |
| 2099-07-06 (W1) | fallback | `fallback_after_model_failure:5/6` | 22 | 2 | 176730 |

채택된 모델 주는 0이다. W1 요일 출처는 FALLBACK, MODEL, MODEL_REVISED, MODEL, MODEL, MODEL이다. `MODEL_REVISED`는 정규화 표시이고 헤드 재생성이 아니다. 헤드 상태는 `APPROVE_WITH_NOTE`이고 `revisions`는 비어 있으며 `regeneration_calls`는 0이다. 채택된 전문 코치 출력 17건은 다른 영역 키를 쓰지 않았다.

월요일 컨디셔닝은 재시도 1회 뒤 schema다. 로그의 오류는 `push_up`과 `sit_up`의 amount가 `reps`라는 단어이고, 검사 문구는 expected unit도 `reps`라고 한다. 수량이 없어 저장하지 않은 것이다. 선행 주 수요일은 `row`에 reps를 써서 거절됐다. 그 규칙은 유지한다.

월 행 2099-06-01과 2099-07-01은 `generation_source`가 `model`이고 스탬프는 `monthly-program-v4`다. 그 로그에는 `token_usage`가 없다. 토큰은 null이다. 0으로 두지 않았다.

플래그는 둘 다 꺼져 있어 스켈레톤은 잠기지 않았다. 잠금 검증은 이 프로브의 대상이 아니다.

## 완료로 보면 안 되는 것

1. 월 행 작성기는 오케스트레이터 밖이다.
2. 요일을 바꾼 뒤 그 코치만 재검증하는 배치 정책은 없다. 있는 것은 필드 조정이 재생성보다 먼저인 것이다.
3. 실제 주는 하루라도 schema면 주 출처가 fallback이다. 5/6이 모델이어도 모델 주가 아니다.
4. 실제 헤드가 수정 명세를 넘긴 사례는 없다. 모킹만 있다.
5. Phase C와 12주 프로브는 D가 모델 주를 채택하지 않아 실행하지 않았다.
6. `dry-run-week`는 아직 `authorWeek`다.

## 다음에 물을 것

- amount가 단위 이름만 있을 때 전문 코치에게 어떤 수정 명세를 줘야 그 날만 다시 쓰는가. 주 전체를 다시 만들지 않는다.
- 헤드가 `APPROVE_WITH_NOTE`만 반환하면 부분 수정 경로는 모킹으로 충분한가, 실제 모델이 명세를 내게 입력만 고쳐야 하는가.
- 월 행을 `authorMonth`에 두는 것이 단일 경로의 예외로 남을 근거인가.
