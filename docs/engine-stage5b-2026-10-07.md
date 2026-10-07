# 프로그래밍 엔진 5B (2026-10-07)

5B는 5단계 스펙의 10–11단계다. 폴백 주가 AI 주와 같은 검증을 통과하고, 라이브 12–16단계를 사람이 누를 수 있는 관리자 동작을 나눈다. 이 브랜치는 `cursor/engine-stage5a-method-1798` 위에 쌓였고, PR의 base도 그 브랜치다. 5A와 합친 전체가 아니라 5B만 보인다.

코드 테스트 PASS는 실제 모델 PASS가 아니다. 모델 이름은 `gpt-5.4-nano`다.

## A. 변경 파일

| 파일 | 이유 | 내용 |
| --- | --- | --- |
| `src/lib/programming/fallback.ts` | 폴백이 저장 전에 같은 판정을 통과해야 한다 | `buildFallbackWeek`, `assignConditioning`, `pairedAmount`, `fallbackConditioningShapes`, `assertFallbackLegal` |
| `src/lib/programming/rules.ts` | 무거운 스쿼트·데드 다음 날의 긴 컨디셔닝 | `constitutionViolations` |
| `src/lib/programming/strength-methods.ts` | 강도 블록 1주 예시가 자기 규칙을 통과하게 한다 | `exampleSets` 1주는 85% × 3을 4세트 |
| `src/lib/programming/types.ts` | 규칙 버전 | `RULES_VERSION` `programming-5` |
| `src/lib/programming/engine.ts` | 폴백 저장이 최근 구조와 리프트 배치를 본다 | `fallbackWeek` |
| `src/lib/programming/admin-tools.ts` | 드라이런과 다른, 이름이 있는 쓰기 시험 | `probeSimilarity`, `saveModelWeek`, `saveForcedFallback`, `seedWeekActual`, `simulateMonthCycle` |
| `src/lib/programming/admin-actions.ts` | 화면이 서버 모듈을 가져오지 않게 한다 | `ENGINE_DRY_ACTIONS`, `ENGINE_WRITE_ACTIONS` |
| `src/components/EngineAdminConsole.tsx` | 드라이런과 저장 시험을 화면에 나눈다 | 버튼 두 묶음 |
| `tests/programming-stage5b.test.ts` | 폴백 품질과 시험 동작 | 아래 G |
| `tests/programming-stage3.test.ts` | 규칙 버전 문자열 | `programming-5` |

`src/lib/month-plan/pieces.ts`는 바꾸지 않았다. 카탈로그의 `12cal`, `15cal`과 관리자 피커의 `팬바이크 12칼로리`는 그대로다. 남녀 짝은 폴백이 주를 조립할 때만 붙인다.

## B. DB

테이블, 컬럼, 인덱스를 추가하지 않았다. `manual_override` 컬럼도 없다.

관리자가 `class_weeks`를 고치면 그 날의 piece id는 `admin-conditioning`이다. sync는 그 날을 유지하고 이유는 `admin_edit`다. actual의 `plan_vs_actual`은 `admin_modified`이고, 주 요약의 `admin_modified_days`와 이전 주 입력에 그 사실이 들어간다. 엔진은 계획과 관리자 수정을 이미 구분한다. 새 기록 칸은 필요 없다.

시험이 쓰는 주는 2099년이다. 끝나면 그 달, 그 주, 시험 회원, 그 회원의 `class_day_scores`와 `wod_results`를 지운다. 집계 함수는 기존 `recomputeWeeklyActual`이다.

## C. Prompt

프롬프트 본문은 바꾸지 않았다. 주 `weekly-program-v5`, 월 `monthly-program-v4`. 모델 `gpt-5.4-nano`. 토큰 주 8000, 월 2500. 대기 주 90초, 월 60초. 엔진 버전 `programming-1`. 입력 요약 `summary-v2`.

규칙 버전만 `programming-5`다. 무거운 스쿼트나 데드리프트(세트 85% 이상, 90%와 강도 블록 톱 세트 포함) 다음 날에 긴 컨디셔닝을 두지 않는다.

## D. Schema

주·월 JSON Schema는 5A 그대로다. strict, `additionalProperties: false`, 전송 스키마에는 `minItems`를 넣지 않는다. 서버가 세션 7개를 본다.

## E. Validation

`judgeWeek` 순서는 5A와 같다. 폴백은 저장 전에 `assertFallbackLegal` → `judgeWeek`를 호출한다. 파스, 스키마, 방법 세트, 피드백, 요일 패턴, 같은 주 충돌, similarity, 한국어를 모두 통과해야 한다. 실패하면 그 주를 저장하지 않는다.

추가된 헌법 한 줄: 오늘이 무거운 스쿼트나 데드리프트이면 다음 날 `long_conditioning`은 오류다. `strengthIsHeavy`는 85% 이상이다.

하체 피로가 높다는 판정은 `previousLowerFatigue`와 같다. 피로 신호가 높거나 실제 볼륨이 높으면 높다. 그 주에는 무거운 하체 메트콘을 모든 요일에서 피하고, 피로를 줄인 세트가 아직 85% 이상이면 하체 리프트는 하루만 둔다.

## F. Fallback

같은 입력이면 같은 주다. 월의 `strength_method`를 따른다. 모델이 죽어도 5/3/1로 바꾸지 않는다. 월 계획이 없으면 `DELOAD_RECOVERY`다.

- 칼로리 머신(`row`, `fan_bike`, `bike`, `assault_bike`, `echo_bike`, `ski`, `ski_erg`)의 `15cal`은 `15/13cal`이 된다. 이미 `12/10cal`이면 유지한다. 화면은 기존처럼 남/여로 읽는다.
- 긴 컨디셔닝은 무거운 스쿼트·데드 다음 날이 아니다. 수요일에 고정하지 않는다. 긴 주가 아니면 긴 날을 만들지 않는다.
- 인접한 훈련일의 stimulus는 같지 않다. 무거운 하체 다음 날 무거운 하체를 두지 않는다.
- 최근 구조와 같은 주 안의 다른 날과 similarity 4 미만이다. 벤치마크는 예외다.
- 바벨이 있는 날의 워밍업에는 “빈 바”가 있고, 없는 날에는 없다.
- 세트는 `exampleSets`다. 강도 블록 1주 예시는 85%가 들어 있어 “85% 이상 한 세트”를 통과한다.

메트콘은 카탈로그에 더해 heavy 5개, high_rep 4개, technical 5개다. 긴 날은 카탈로그 `wed-long`과 로잉 긴 조각 중 최근 구조와 안 겹치는 쪽이다. 벤치마크 주는 토요일이다. 목요일 고정 벤치마크와 겹치지 않게 두었다.

`pieces.ts`는 재료다. 폴백이 그 목록만으로 요일을 고르지 않는다.

## G. 테스트

`npx tsc --noEmit` 통과. `npx vitest run` 27개 파일, 155개 통과. 실제 `gpt-5.4-nano` 호출은 하지 않았다.

| 항목 | 결과 |
| --- | --- |
| 531, ACCUMULATION, INTENSITY_BLOCK, 계획 없는 회복 × 1–4주 × 피로 없음/Case A/Case B 폴백이 `judgeWeek`를 통과 | PASS |
| 같은 입력의 폴백 JSON이 같다 | PASS |
| 맨 `Ncal` 없음, 바벨 워밍업과 긴 날의 전날 | PASS |
| heavy / high_rep / technical 각각 서로 다른 동작 조합 3개 이상 | PASS |
| 모델 HTTP 500 뒤 `generation_source=fallback`, 저장된 `strength_method`는 ACCUMULATION, 85% 5회 세트 없음 | PASS |
| 거의 같은 구조 similarity FAIL, 다른 구조 PASS, 벤치마크 PASS | PASS |
| `save-model-week`는 목 응답을 `generation_source=model`로 저장 | PASS (목) |
| `save-forced-fallback`은 2회 뒤 fallback, 다음 주 입력의 `previous_generation_source=fallback` | PASS |
| `seed-week-actual`이 2099-08 주를 집계한 뒤 점수·회원 행 수가 원래와 같다 | PASS |
| `simulate-month-cycle`이 평가를 만들고, 다음 달 드라이런이 그 평가를 읽고 `wrote`는 false, 2099 행은 삭제 | PASS |
| 드라이런은 주를 늘리지 않는다 | PASS |
| 알 수 없는 동작은 저장하지 않는다 | PASS |
| 공유 수업 금요일 스쿼트, 고전 `buildWeek` 65/75/85 | PASS |
| 실제 모델이 쓴 주의 `generation_source=model` | NOT VERIFIED |
| 라이브 Case A/B, 라이브 similarity, 라이브 다음 달 | NOT VERIFIED |
| 관리자 화면 버튼을 브라우저에서 클릭 | NOT VERIFIED |

## H. 라이브

`generation_source=model`로 실제 API가 저장한 주는 없다. NOT VERIFIED.

관리자 동작 `save-model-week`는 키와 응답이 있으면 현재 수업 주를 저장할 수 있다. 이 작업에서는 그 호출을 하지 않았다. 테스트의 model 저장은 목 JSON이다.

## I. A/B

라이브 모델의 Case A와 Case B는 NOT VERIFIED. 코드는 폴백에 높은 하체 피로와 낮은 하체 피로를 넣어 `judgeWeek`가 둘 다 통과하는지만 보았다. 모델이 두 입력으로 다른 주를 쓰는지는 확인하지 않았다.

| | 코드에서 확인한 것 | 라이브 |
| --- | --- | --- |
| Case A (피로·볼륨 높음) | 폴백이 방법의 피로 감소 세트를 쓰고 판정을 통과 | NOT VERIFIED |
| Case B (피로 낮음) | 폴백이 그 방법의 보통 세트를 쓰고 판정을 통과 | NOT VERIFIED |
| A가 B보다 무겁지 않음 | 5A `heavierThan` 테스트가 그대로 통과 | NOT VERIFIED |

## J. 남은 문제

- 실제 모델 주는 저장되지 않았다. 12–16단계의 라이브 확인은 관리자 화면의 이름 있는 동작으로 사람이 한다.
- 관리자 버튼은 서버 테스트로만 확인했다. 브라우저에서 로그인 뒤 누르는 경로는 NOT VERIFIED.
- 빈 수업 주(회원 점수 없음)의 actual은 빠진 날이 절반 이상이면 피로 신호가 높다. 한 달 폴백은 그 입력을 통과한다. 집계 규칙은 바꾸지 않았다.
- 폴백 메트콘은 작은 추가 목록이다. 40일이 넘는 서로 다른 구조를 무한히 만들지는 않는다.
- `manual_override`는 없다. 관리자 수정은 기존 `admin-conditioning` / `admin_modified`로 구분된다.

## 변경 함수, 이유, 테스트, 남은 문제

이유: 모델이 실패해도 그 달의 방법으로, AI 주와 같은 규칙으로, 결정적인 주를 저장해야 한다. 드라이런은 쓰지 않고, 라이브 확인용 쓰기는 동작 이름으로만 고른다.

함수: `buildFallbackWeek`, `assignConditioning`, `pairedAmount`, `assertFallbackLegal`, `constitutionViolations`, `exampleSets`, `probeSimilarity`, `saveModelWeek`, `saveForcedFallback`, `seedWeekActual`, `simulateMonthCycle`, `runAdminAction`.

테스트: `tsc` 통과, vitest 155 통과. 실제 모델은 NOT VERIFIED.

남은 문제: 위 J와 같다.
