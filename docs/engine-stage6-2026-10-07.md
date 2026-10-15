# 프로그래밍 엔진 6단계 (2026-10-07)

6단계는 기능을 더하지 않는다. 라이브에서 주간 모델이 `generation_source=model`로 한 번도 저장되지 못한 이유(스키마 세부, 제약 미반영, DELOAD 폴백)를 고친다.

이 저장소 안의 `tsc`와 vitest는 통과했다. 실제 `gpt-5.4-nano` 호출은 하지 않았다. 유닛 테스트 163개 PASS는 라이브 모델 주 저장의 성공이 아니다. 라이브 채택은 배포 뒤에 `save-model-week`로 확인한다.

모델은 `gpt-5.4-nano`다. 토큰은 주 8000, 월 2500이다. 월 프롬프트는 `monthly-program-v4`다. 주 프롬프트는 `weekly-program-v6`, 규칙 버전은 `programming-6`이다. 재시도는 2회다. 주간 API는 한 번 호출이다.

## A. 리프트 없는 스트렝스 메타데이터

`strength`가 null인데 `strength_purpose` / `strength_volume` / `strength_intensity`만 있으면 스키마 오류다.

- 프롬프트 규칙과 `strength_metadata_rule`: strength가 null이면 세 필드는 null. purpose가 있으면 strength와 lift가 필요하다.
- OpenAI strict는 `if/then`을 거절한다. 세션 스키마는 `anyOf` 두 갈래다. 한 갈래는 strength 객체와 purpose/volume/intensity 문자열. 다른 갈래는 넷 다 null.
- 서버가 최종 권한이다. `weekSchemaErrors`가 `Friday: strength_purpose present but strength null`처럼 요일을 붙여 거절한다.
- 좁은 정규화는 D.

함수: `weekResponseFormat`, `weekSchemaErrors`, `normalizeWeekPayload`.

## B. time_domain과 duration

short 1–12, medium 13–29, long 30–40. short+14는 거절한다. medium+14는 통과한다. 서버는 short+14를 medium으로 고치지 않는다.

주간 프롬프트 `time_domain_rules.order`는 duration을 먼저 고르라고 한다. `time_domain_examples.valid`에 short 10/12, medium 14가 있고, `invalid`에 short 14가 있다.

함수: `TIME_DOMAIN_RANGES`, `weekSchemaErrors`, `weekPrompt`.

## C. stimulus null

컨디셔닝이 있으면 stimulus는 `heavy | high_rep | technical`이다. 목록은 `STIMULI` 한 곳이고, 프롬프트 `enums.stimulus`가 그 배열을 그대로 넣는다.

컨디셔닝 객체의 stimulus는 스키마에서 null이 아니다. 세션 stimulus는 휴식일을 위해 null을 허용하고, 서버가 컨디셔닝 값과 같은지 본다. 엔진 전용·벤치마크의 null 예외는 뺐다.

함수: `weekSchemaErrors`, `weekResponseFormat`, `extractDraft` (화면 재료에 자극이 없으면 같은 enum을 채우고, 바로 앞 훈련일과 겹치면 다른 허용 값으로만 돌린다).

## D. 좁은 자동 보정

허용하는 보정은 하나다. strength가 null인데 purpose/volume/intensity가 있으면 그 셋만 null로 지운다. 시간 영역, 세트, 리프트, 요일은 바꾸지 않는다.

`judgeWeek`가 파스 전에 `normalizeWeekPayload`를 호출한다. 생성 로그 `raw_json`에 `normalizations: [...]`가 들어간다. 컬럼은 추가하지 않았다.

함수: `normalizeWeekPayload`, `judgeWeek`, `insertGenerationLogs`.

## E. 재시도는 요일 단위

2회째 본문에 오류 목록이 그대로 있다. 문장은 `Tuesday: time_domain=short duration=14 is outside 1–12`처럼 요일로 시작한다.

재시도 지시: 맞는 세션과 원래 intent를 유지하고, 적힌 오류만 고친다. 요일을 가로지르는 규칙이 아니면 다른 날을 다시 짜지 않는다. 직전 JSON은 `retry.previous_draft`다.

함수: `authorWithRetries`, `weekPrompt`.

## F. hard_constraints

하체 피로가 high이면 `heavy_lower_sessions_max=1`이다. 스쿼트 90%와 데드리프트 90%를 같은 주에 두면 `feedback`으로 거절한다. 메시지에 요일과 `hard_constraints.heavy_lower_sessions_max=1`이 있다.

프롬프트 순서는 월간 방법 → `strength_prescription` → `hard_constraints` → `strength_constraints`(상한·메트콘·볼륨/강도 방향만, 리프트·요일·구조는 모델이 고름) → 프로그램 → 서버 검증이다. `authority`는 `MUST NOT EXCEED`다.

스키마 오류가 있어도 feedback 오류를 같은 재시도 목록에 넣는다. 이유 코드는 먼저 실패한 단계다.

함수: `hardConstraints`, `feedbackViolations`, `judgeWeek`, `weekPrompt`. 드라이런 `feedback.hard_constraints`도 같은 객체다.

## G. DELOAD_RECOVERY 폴백

`no legal fallback conditioning`은 카탈로그 탐색이 최근 구조·인접 자극·체인에서 막힐 때 났다. 강도 블록 4주가 앞 3주의 구조를 보면 재현됐다. 빈 DB의 4주 회복 달력만으로는 안 났다.

카탈로그 탐색이 실패하면 `assignGuaranteedConditioning`이 자극·시간·형식이 맞는 조각을 만든다. 그 주도 `assertFallbackLegal` → `judgeWeek`를 통과해야 한다. 방법을 531로 바꾸지 않는다. 회복 방법의 세트는 70% 이하이고 AMRAP이 없다.

함수: `assignConditioning`, `assignGuaranteedConditioning`, `assertFallbackLegal`, `buildFallbackWeek`.

## H. 테스트

`npx tsc --noEmit` 통과. `npx vitest run` 28파일, 163개 통과. 모델 호출은 목이다.

| 항목 | 결과 |
| --- | --- |
| A strength null + purpose → 정규화 후 채택, 로그에 normalizations | PASS |
| B short+14 → 거절, time_domain을 고치지 않음 | PASS |
| C medium+14 → 채택 | PASS |
| D conditioning + stimulus null → 거절 | PASS |
| E 하체 피로 high + 무거운 하체 2회, max=1 → feedback 거절 | PASS |
| F–I DELOAD / 531 / ACCUMULATION / INTENSITY_BLOCK, 1–4주, 피로 없음/high/low, 앞 주 구조를 넘기며 judgeWeek | PASS |
| 재시도 본문에 요일 오류와 previous_draft | PASS |

## I. 바꾼 파일

| 파일 | 함수 |
| --- | --- |
| `src/lib/programming/rules.ts` | `dayLabel`, `normalizeWeekPayload`, `weekSchemaErrors`, `hardConstraints`, `feedbackViolations`, `judgeWeek` |
| `src/lib/programming/model.ts` | `weekResponseFormat`, `weekPrompt`, `authorWithRetries`, `authorWeek` |
| `src/lib/programming/fallback.ts` | `extractDraft`, `assignConditioning`, `assignGuaranteedConditioning` |
| `src/lib/programming/store.ts` | `insertGenerationLogs` |
| `src/lib/programming/admin-tools.ts` | `dryRunWeek`의 `feedback.hard_constraints` |
| `src/lib/programming/types.ts` | `RULES_VERSION` `programming-6`, `WEEKLY_PROMPT_VERSION` `weekly-program-v6` |
| `tests/programming-stage6.test.ts` | A–I |
| `tests/programming-stage3.test.ts`, `tests/programming-stage5a.test.ts` | 버전 문자열, 스키마 anyOf, short 14 메시지 |

테이블, 컬럼, 인덱스는 없다. actual 집계, similarity, 벤치마크 예외, class_weeks sync, 재시도 2회, 토큰, 모델 이름은 그대로다. 방법은 531, ACCUMULATION, INTENSITY_BLOCK, DELOAD_RECOVERY만 동작한다.

## J. 라이브에서 확인할 것

이 작업은 운영 DB를 읽거나 쓰지 않았다. 배포 전에 10월 월의 active 행을 남긴다. 버전, `strength_method`, 연결된 주, `generation_source`, `class_week_id`, 점수, 관리자 수정 여부.

쓰기 시험은 2099 고립 주만 쓰고, 끝나면 그 달·주·시험 회원을 지운다. `2026-10-05` 수업 주를 다시 쓰지 않는다.

월을 다시 만들 때는 기존 active를 `superseded`로 두고 `generation_version`을 올린다. 지난 주 행을 새 방법인 것처럼 덮어쓰지 않는다. `insertProgrammingMonth`의 regenerate가 그 방식이다.

성공 기준은 주간 한 행이 `generation_source=model`로 저장되는 것이다. 월간 ACCUMULATION, 한국어, similarity, 유닛 테스트는 그 기준이 아니다.

## K. 스키마를 OpenAI가 거절하면

strict가 `anyOf` 세션을 400으로 거절하면 기존처럼 `json_object`로 한 번 더 보낸다. 그 경우에도 서버 검증과 D의 정규화는 같다. 컨디셔닝 stimulus의 null 금지는 스키마와 서버 양쪽에 있다.

## L. 하지 않은 것

개인화, 설문, 결제, 랭킹, 제휴, 코칭, TECHNIQUE_SKILL / POWER_SPEED / HYBRID의 구현, 주간 2단계 API, DB 재설계, 모델 변경, 엔진 전면 재작성.

카탈로그가 막혀도 합성 경로가 항상 성공한다고 수학적으로 보장하지는 않는다. 같은 시간 영역·자극·형식·볼륨 버킷이 최근 구조로 가득 차면 similarity 점수 4를 피할 수 없다. 4주 연쇄와 피로 high/low, 그리고 그 앞의 추가 주 몇 개는 테스트에서 `judgeWeek`를 통과했다.
