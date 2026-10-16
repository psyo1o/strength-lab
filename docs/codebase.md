# Strength Lab 코드 지도

이 문서는 브랜치 `cursor/coaching-orchestrator-fca8`의 현재 코드를 읽는 순서로 적는다. 생성 조건의 식은 `docs/generation-paths.md`와 같다. 프로브 숫자는 각 `docs/*-results.md`에 있고, 여기 다시 적지 않는다.

앱은 Next.js App Router, TypeScript, Tailwind, SQLite(`better-sqlite3`, Drizzle 스키마)다. 모델 이름은 `src/lib/month-plan/week-model.ts`의 `MONTH_PLAN_OPENAI_MODEL`이고 값은 `gpt-5.4-nano`다. 키는 `MONTH_PLAN_MODEL_KEY`다. 이 문서는 키를 적지 않는다.

## 두 개의 운동 경로

한 앱 안에 경로가 둘이다.

1. **시드 프로그램.** `data/seed.json`의 프로그램, 주, 일, 종목, 세트를 DB에 넣는다. 화면은 `/programs`와 `/session/...`이다. 중량은 `src/lib/calc`가 1RM과 방법으로 계산한다.
2. **클래스 주.** 화면 `/plan`, `/wod`, `GET/POST /api/month-plan`이 `ensureClassWeek`를 탄다. 그 함수는 그 주 `class_weeks` 행이 없으면 `ensureProgrammingWeek`를 부른다. 만든 주의 화면 복사본이 `class_weeks`다.

`month_plans`와 `generatePlanForUser`(`src/lib/month-plan/store.ts`)는 사용자별 예전 생성기다. `resolvePlannedWeek`가 후보 메타콘을 고른다. 현재 앱 라우트는 이 함수를 호출하지 않는다. 테스트 `tests/month-plan.test.ts`, `tests/month-plan-model.test.ts`가 호출한다.

## 클래스 주가 만들어지는 순서

```text
화면 /api/month-plan
  → ensureClassWeek (src/lib/month-plan/class-week.ts)
  → ensureProgrammingWeek (src/lib/programming/engine.ts)
  → writeProgrammingWeek
       월 행이 없으면 writeProgrammingMonth (authorMonth, 스탬프 monthly-program-v4)
       → runCoachingOrchestrator (src/lib/programming/coaching/orchestrator.ts)
  → 결과를 programming_weeks에 저장
  → syncClassWeek (src/lib/programming/sync.ts)가 class_weeks 화면 복사본을 갱신
  → project.ts가 WeekDraft를 화면용 PlannedWeek로 바꾼다
```

`runCoachingOrchestrator`의 반환은 셋이다.

| 반환 | 조건 | 그 다음 |
|---|---|---|
| `no-model` | 키가 문자열이 아니거나 길이가 0 | 모델을 부르지 않는다. 초안 스탬프 `weekly-program-v10`. `no_model`이면 `buildFallbackWeek` |
| `week-document` | 월 코치 응답이 세션 7개인 주 JSON | `persistWeekDocument`. 스탬프 `wod-from-intent-v1` |
| `coaching` | 문자열 키이고 월 응답이 주 JSON이 아님 | `coachWeek` → `coachWeekActive` (`orchestrate.ts`). 스탬프 `coaching-pipeline-v6` |

화면은 `key`를 넘기지 않는다. `undefined`는 `serverModelKey()`가 환경 키를 읽는다. `null`과 빈 문자열은 환경 키를 읽지 않는다.

`COACHING_PIPELINE`이 `"1"`일 때만 월 행에 `withCoachingPlan`이 붙는다. 주 생성 함수를 고르지는 않는다. `LONGITUDINAL_PLANNING`이 `"1"`이면 `planLongitudinal` 결과를 같은 주 함수에 넘긴다. 잠긴 스켈레톤이면 주간 코치 호출을 건너뛴다. `PHASE_C`는 `src`가 읽지 않는다. `STRENGTH_LAB_PROBE === "1"`이고 키가 비어 있지 않으며 `weekStart === "2026-10-05"`이면 오케스트레이터 호출 전에 예외를 던진다.

`syncClassWeek`는 `programming_weeks`의 활성 행을 기준으로 `class_weeks`를 고친다. 서울 날짜로 이미 지난 날, 점수가 있는 날, 관리자가 고친 날(`admin-conditioning`)은 둔다.

## 키가 있을 때의 코칭 순서

`coachWeekActive` (`src/lib/programming/coaching/orchestrate.ts`)가 한 주를 만든다.

1. `coachMonthly` (`monthly-coach-v2`). 월 전략이다. 세션 7개 주 JSON이면 `WeekDocumentResponse`로 빠진다.
2. 주간 코치 `weekly-coach-v2`. 잠긴 스켈레톤이 있으면 이 호출은 없다. 실패하고 라우터 조건에 맞으면 월 또는 주간을 한 번 더 묻는다 (`MAX_MONTHLY_ROUTER_RETRIES` 1, `MAX_WEEKLY_ROUTER_RETRIES` 1).
3. 훈련일마다 전문 코치 셋. 휴식일은 세션 모델을 부르지 않고 트레이스 사유가 `rest`다.
4. 스키마에 실패한 영역만 하루 복구 1회 (`MAX_DAY_SCHEMA_RECOVERIES`).
5. 부하 코치 `load-coach-v2`. 세트와 킬로그램은 모델이 쓰지 않는다. 스트렝스 숫자는 `strengthFor` 방법 표다.
6. 피로·변이, stage13 전문 코치 검토(생성기가 아님), 헤드 `head-coach-v8`.
7. `runAdjustmentPass`. 칸 수정은 서버가 그 칸만 쓴다. 예전 `action` 목록만 전문 코치를 다시 부르고 `compareEditList`로 한 번 비교한다.
8. `finalWeekReport`. 하드 오류가 남으면 헤드의 APPROVE와 APPROVE_WITH_NOTE는 채택되지 않는다.

`generation_source === "model"`이 되려면 주간 모델 또는 잠긴 스켈레톤이 있고, 훈련일이 모두 모델이며, 헤드가 APPROVE, APPROVE_WITH_NOTE, ADJUST 중 하나이고, 최종 하드 오류가 없어야 한다. 그 외는 fallback이다. fallback은 모델 성공이 아니다.

저장 직전, 코칭 결과가 모델이고 `judgeWeek` 사유가 `too_similar`이면 충돌한 날만 바꾼다. 임계값은 4다. 통과하면 `generation_source`는 `fallback`, 사유는 `too_similar`다. 다른 `judgeWeek` 사유는 이 강등을 하지 않는다. `judgeWeek` 순서는 schema, invented_weight, rule_break(세트), feedback, weekday_pattern, rule_break(구성), too_similar, language다.

상한은 그대로다. `COACHING_POLICY.max_head_revisions`는 2다. `MAX_DAY_SCHEMA_RECOVERIES`는 1이다. `askCoach`는 검증 실패를 그 호출 안에서 한 번 더 고친다. 컨디셔닝을 쓰는 동안 아직 쓰지 않은 훈련일은 자극·유사도 비교에서 뺀다. 첫 거절은 이웃 자극의 허용 값과, 겹친 특징의 실제 값을 재시도에 적는다. 유사도 재시도는 겹친 날의 세션(형식, 시간, 동작 key와 수량, 자극, 패턴, 겹친 요소)을 `overlap_sessions`로 넣고, 그 세션과 다른 형식·자극·동작으로 짜라고 적는다. 임계값은 4다.

## 전문 코치와 복구

`writeSession`이 `askSpecialist`로 나눈다 (`specialist-generate.ts`).

| 역할 | 에이전트 | 프롬프트 | 출력 |
|---|---|---|---|
| 스트렝스 | `strength_coach` | `strength-coach-v3` | 칸 `movement_id`, `quantity_option` |
| 컨디셔닝 | `conditioning_coach` | `conditioning-coach-v10` | 잠긴 메트콘은 Rx `recipe`와 `scale` 번호 |
| 워밍업 | `warmup_coach` | `warmup-coach-v3` | 칸 `movement_id`, `quantity_option` |

세 호출이 끝난 뒤에만 하루를 합친다. 집계 트레이스 `session_coach` (`session-coach-v4`)는 `deterministic: true`라 plan-lab 호출 수에 들어가지 않는다.

컨디셔닝 복구의 라이브 스키마는 `cells`다. 칸은 `catalog_key`, `field`, `value`다. `applyCellsToCoachJson`이 그 칸만 이전 출력에 넣는다. 세션 전체를 돌려주는 복구는 `recoveryDrift`가 `field_edits`에 없는 변경을 거부한다.

## 헤드의 수정

라이브 `revisions` 항목은 `day`, `block`, `catalog_key`, `field`, `value`, `reason`이다. `field`는 `movement`, `amount`, `unit`, `load`다. 서버는 그 칸만 쓰고 전문 코치를 다시 부르지 않는다. 지시부터 카탈로그로 검사한다. 없는 key, 허용되지 않은 단위, 닫힌 범위 밖 수량은 스키마 오류다.

예전 `action` (`replace`, `change_amount`, `delete`, `add`)은 파서가 받는다. 문장만 있으면 `prose-only revision`이고 헤드를 그 호출 안에서 한 번 더 묻는다. `action` 편집은 같은 날·같은 코치로 묶어 최대 2개만 `writeSession`으로 다시 부른다. 칸 편집은 이 예산에 넣지 않는다. 재생성은 `compareEditList`가 목록과 컨디셔닝 동작의 키·수량을 한 번 비교한다.

## 동작 카탈로그

기준 파일은 `data/movement-catalog.json`이다. 버전 `0.4.0-draft`, 동작 138개. 읽는 코드는 `src/lib/programming/coaching/movement-catalog.ts`다.

모델이 고르는 칸은 `movement`, 정수 `amount`, `unit`, `load`다. 화면이 읽는 수량은 `MovementDraft.amount` 문자열이다. `displayAmount`가 표시 문자열을 만든다. 셀 형태 행은 `amount`를 숫자로 유지하고 `key`를 채운다. 장비 목록은 카탈로그 동작의 `equipment`로 서버가 덮어쓴다. 모델이 낸 장비와 장비 보유 여부는 거절 사유가 아니다. 장비 탭은 제휴 상품이다.

사용자 JSON의 `movement_catalog`는 그날 `movement_pattern`과 스트렝스 리프트에 맞는 동작만 담는다. 코드가 검사하는 것은 key 존재, 허용 단위, 닫힌 범위 이탈이다. 닫힌 범위는 `N–M` 또는 `N-M`뿐이다. null, 한 숫자, 주석이 붙은 범위는 단위만 본다. 범위를 만들지 않는다. Rx는 프롬프트 참고다.

`proposed_key`의 대상이 카탈로그 key일 때만 셀 출력이 그 key로 저장된다. 모호한 연결은 `squat`→`back_squat`, `clean`→`squat_clean`, `snatch`→`squat_snatch`다. 대상 key가 없으면 기존 key를 유지한다. 레거시 레시피 key는 자동으로 다시 쓰지 않는다. 문자열 `amount`만 있는 예전 행은 범위 검사하지 않는다.

alias는 `data/wod-exercise-aliases.json`이다. 푸시 저크, 행 클린, 행 파워 클린, 스트릭트 풀업, 니투엘보, 루마니안 데드리프트, 리버스 런지, 워킹 런지, 아메리칸·러시안 케틀벨 스윙, 어썰트 바이크, 에코 바이크는 각자 key다. `jerk`는 alias 파일에서 빠졌다. 팁의 `jerk`→`split_jerk` 영상 연결은 `src/lib/tips.ts`의 `TIP_ALIASES`에 남아 있다. `air-bike`는 `fan_bike`다.

이 카탈로그와 시드 프로그램 카탈로그(`src/lib/programs/catalog.ts`, `data/seed.json`)는 다른 파일이다.

## 디렉터리

| 경로 | 역할 |
|---|---|
| `src/app` | 페이지와 API |
| `src/components` | 화면 컴포넌트 |
| `src/lib/auth.ts` | 세션 쿠키 `sl_session`, 비밀번호, 관리자 |
| `src/lib/db` | SQLite 연결, 스키마, 시드 |
| `src/lib/calc` | 반올림, 원판, 5/3/1, 저거넛, 선형, Epley |
| `src/lib/programs` | 시드 프로그램 조회, 세트 중량, P1 병합 |
| `src/lib/wod` | 벤치마크 WOD, 템플릿, 목적, 추정, 팁 연결 |
| `src/lib/month-plan` | 클래스 주 화면, 오늘, 점수, 메타콘 편집, 예전 사용자 주 |
| `src/lib/programming` | 월·주 생성, 저장, 판정, fallback |
| `src/lib/programming/coaching` | 오케스트레이터와 코치 |
| `src/lib/programming/planning` | 종단 스켈레톤 |
| `data` | 시드, 카탈로그, 팁, 벤치마크, 장비 제휴 |
| `scripts` | plan-lab, 시드, 단계 프로브 |
| `tests` | Vitest |
| `docs` | 생성 경로와 단계 결과 |

## 화면

하단 내비(`src/components/Nav.tsx`)는 오늘 `/dashboard`, 1RM `/maxes`, 본 운동 `/wod`, 프로그램 `/programs`, 장비 `/gear`, 설정 `/settings`다. 관리자는 회원 `/members`, 엔진 `/admin/engine`이 더 있다.

| 경로 | 하는 일 |
|---|---|
| `/`, `/login`, `/register`, `/forgot-password`, `/reset-password` | 로그인 밖 |
| `/dashboard` | 오늘 |
| `/plan`, `/plan/w/[weekStart]`, `/plan/w/[weekStart]/[day]` | 클래스 주와 그 날 |
| `/plan/[planId]`, `/plan/[planId]/[day]` | `month_plans` 행 |
| `/wod`, `/wod/[slug]` | 벤치마크와 클래스 본운동 |
| `/programs`, `/programs/[slug]` | 시드 프로그램 |
| `/session/[slug]/[week]/[day]` | 그 프로그램의 하루 세트 |
| `/maxes` | 1RM |
| `/history` | 완료 기록 |
| `/plates` | 원판 |
| `/helper` | Epley |
| `/benchmarks` | 벤치마크 목록 |
| `/gear` | 장비 제휴 |
| `/settings`, `/account` | 단위, 비밀번호 |
| `/admin/engine` | 엔진 콘솔 |
| `/members` | 회원 |

자주 보는 컴포넌트는 `WorkoutClient`, `WodClient`, `PlanDayView`, `MetconEditor`, `SetRow`, `RestTimer`, `PlateCalc`, `EngineAdminConsole`이다.

## API

| 경로 | 하는 일 |
|---|---|
| `/api/auth/register`, `login`, `logout`, `forgot`, `reset`, `change-password` | 계정 |
| `/api/month-plan` | 클래스 주 확보. `maxDuration` 300 |
| `/api/month-plan/scores` | 클래스 날 점수 |
| `/api/maxes` | 1RM |
| `/api/sets/complete` | 세트 완료 |
| `/api/wod/results` | WOD 결과 |
| `/api/settings` | 설정 |
| `/api/admin/engine` | 엔진 도구 |
| `/api/admin/metcon` | 메타콘 수정 |
| `/api/admin/members` | 회원 |
| `/api/media/[file]` | `/data/media` 사진 |

## 데이터베이스

연결은 `src/lib/db/client.ts`의 `databasePath()`다. 환경 `DATABASE_PATH`가 있으면 그 파일이다. 컨테이너 기본은 `/data/app.db`다. plan-lab은 2099 임시 파일을 `/tmp`에 둔다.

계정과 기록: `users`, `sessions`, `user_maxes`, `password_reset_tokens`, `auth_throttle`, `set_logs`, `user_equipment`.

시드 프로그램: `exercises`, `programs`, `program_weeks`, `program_days`, `program_exercises`, `program_sets`.

클래스와 예전 주: `class_weeks`, `class_day_scores`, `month_plans`, `month_plan_scores`, `wod_results`, `wod_structures`.

프로그래밍 엔진: `programming_months`, `programming_weeks`, `programming_syncs`, `programming_month_proposals`, `programming_generation_logs`, `programming_actuals`, `programming_evaluations`.

활성 주만 화면 주로 읽힌다. `status`가 active가 아니면 `getProgrammingWeek`가 그 행을 돌려주지 않는다.

## 데이터 파일

| 파일 | 쓰는 곳 |
|---|---|
| `data/seed.json` | 프로그램 시드. 없으면 카탈로그 코드가 만든다 |
| `data/movement-catalog.json` | 코치 동작 기준 |
| `data/wod-exercise-aliases.json` | 동작 별칭. 팁 id 해석에도 쓴다 |
| `data/exercise-tips.ko.json` | 한국어 팁 |
| `data/exercise-tips.youtube.whitelist.json` | 허용 영상 |
| `data/exercises.canonical.json` | 종목 id |
| `data/benchmark-wods.rx.json`, `benchmark-wods.purpose.ko.json` | 벤치마크 |
| `data/wod-templates.ko.json`, `wod-templates.purpose.ko.json` | 템플릿 |
| `data/wod-scale.suggestions.ko.json` | 스케일 문장 |
| `data/gear-affiliates.json` | 장비 링크. NAS는 `$DATA_DIR/gear-affiliates.json` |

`seed-drafts/`의 P1 JSON이 있으면 프로그램 slug를 덮어쓴다.

## 계산

`src/lib/calc/round.ts`가 반올림이다. 5/3/1은 `src/lib/calc/wendler.ts`의 `MROUND(1RM × 0.9 × pct/100, 2.5)`다. TM을 먼저 반올림하지 않는다. 저거넛은 `juggernaut.ts`, 선형은 `linear.ts`, 원판은 `plates.ts`, Epley는 `epley.ts`다. 방법 표는 `src/lib/programming/strength-methods.ts`다. 5/3/1은 방법 중 하나다.

## 코칭 파일

| 파일 | 역할 |
|---|---|
| `orchestrator.ts` | 키를 보고 `no-model`, `week-document`, `coaching`을 고른다 |
| `pipeline.ts` | `coachWeek`. 프로브가 `2026-10-05`를 막는 검사 |
| `orchestrate.ts` | `coachWeekActive`. 월·주·일·부하·헤드·채택 |
| `monthly.ts`, `weekly.ts` | 월 코치, 주간 intent |
| `specialist-generate.ts` | 세 전문 코치 호출 |
| `session.ts` | 코치 JSON을 `SessionDraft`로 |
| `contract.ts` | 라이브 JSON 스키마, 셀 검증 |
| `prompts.ts` | 프롬프트와 버전 |
| `review.ts` | 헤드 출력 파싱. 칸과 예전 `action` |
| `day-recovery.ts` | 복구 지시, `recoveryDrift` |
| `revision-compliance.ts` | `compareEditList` |
| `movement-catalog.ts` | 카탈로그 로드, 범위, 칸 패치 |
| `llm.ts` | OpenAI 호출 |
| `trace.ts` | 코치 로그 |
| `load.ts`, `fatigue.ts`, `variation.ts`, `score.ts` | 부하, 피로, 변이, 점수 |
| `pieces.ts` | 레시피 동작 이름 |
| `canonical.ts` | 캐논 종목 |
| `models.ts` | `COACHING_PIPELINE` 플래그, 모델 이름 |
| `stage13/` | 정규화, 단위, 검증, 분석 신호, 전문 코치 검토 |
| `stage14/` | 검토를 모아 헤드 판단으로 |
| `stage15/` | 주 구조, 하드 규칙, 방법·안전 정책, 라우터 상한, 프로브 안전 |
| `stage16/` | `runAdjustmentPass`. 필드 조정. 생성기를 다시 부르지 않는 경로 |
| `COACHING_CONSTITUTION.md` | 코치 위계. 분석 신호는 거절이 아니다 |

`src/lib/programming`의 나머지: `engine.ts`가 월·주 저장의 입구다. `store.ts`가 행을 읽고 쓴다. `rules.ts`와 `evaluate.ts`가 `judgeWeek` 쪽이다. `fallback.ts`가 실패 주 초안이다. `realize-intent.ts`가 intent를 세션으로 만든다. `project.ts`가 화면 블록으로 바꾼다. `actual.ts`가 지난 주 실적이다. `probe-archive.ts`가 plan-lab 원본을 남긴다. `admin-tools.ts`의 `dryRunWeek`는 `authorWeek`를 직접 부르고 DB에 쓰지 않는다.

`src/lib/programming/planning/`은 종단 계획이다. `flag.ts`의 `longitudinalPlanningEnabled`, `plan.ts`의 `planLongitudinal`, 스켈레톤 잠금은 `lock.ts`다. 버전 표기는 `skeleton-v1`, `longitudinal-v1`이다.

## plan-lab

`scripts/plan-lab.ts`만 실제 모델 프로브를 한다. 주는 2099다. 운영 주 `2026-10-05`, `2026-10-12`를 쓰지 않는다.

```text
PROBE_MODE=db PROBE_LABEL=<label> PROBE_FLAGS=off PROBE_SCENARIOS=W1 PROBE_PASSES=A1 npx tsx scripts/plan-lab.ts
```

`PROBE_FLAGS=off`이면 `COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`을 켜지 않는다. 기본 프로브는 둘 다 `"1"`이다. 첫 HTTP 429는 그 실행을 멈춘다.

호출 수는 `deterministic === false`이고 `source === "model"`인 로그다. 토큰은 그 주 로그에서 `total_tokens`가 숫자인 행의 합이다. 숫자가 없으면 0으로 두지 않고 null이다. 직전 주 `2099-06-29` 숫자는 W1 합에 넣지 않는다.

다른 스크립트: `export-seed.ts`, `seed-db.ts`, `check-wod-tips.ts`, `merge-seed-programs.ts`, 단계 프로브 `probe-stage13.ts`부터 `probe-stage17.ts`, `stage20-month-probe.ts`.

## 테스트

`npm test`는 Vitest다. `tests/setup.ts`가 공통 준비다. 프로그래밍 단계는 `programming-stage*.test.ts`다. 이 브랜치의 코치 동작은 `coaching-orchestrator.test.ts`, `coaching-pipeline.test.ts`, `day-recovery.test.ts`, `phase1-revision-compliance.test.ts`, `movement-catalog.test.ts`가 본다. 화면 계약은 `class-wod.test.tsx`, `today-session.test.tsx`, `wod-tip-link.test.ts`다.

모킹 통과는 실제 모델이 칸을 고쳤다는 기록이 아니다. 실제 호출 결과는 `docs/movement-catalog-results.md`와 그 앞의 `docs/*-results.md`에 있다.

## 문서

| 문서 | 내용 |
|---|---|
| `docs/AGENT_GUIDE.md` | 단계 작업 규칙 |
| `docs/generation-paths.md` | 플래그, 진입점, 스탬프, fallback 조건 |
| `docs/coaching-pipeline.md` | 파이프라인 설명 |
| `docs/codebase.md` | 이 지도 |
| `docs/*-results.md` | 그 단계 프로브와 모킹을 구분한 결과 |
| `README.md`, `CHANGELOG.md`, `DEPLOY-CI.md` | 실행, 변경, NAS 배포 |

생성 경로, flag 분기, 프롬프트 버전, fallback 조건을 바꾸는 커밋은 `docs/generation-paths.md`를 같은 커밋에서 고친다.
