# PR #65 배포 체크리스트

병합과 배포는 이 문서가 승인되기 전에는 하지 않는다. 운영 DB와 운영 주는 이 워크스페이스에서 열지 않는다. 키 값은 적지 않는다.

기준 브랜치는 `cursor/coaching-orchestrator-fca8`다. 이미지 이름은 `ghcr.io/psyo1o/strength-lab`다. NAS 데이터는 `/volume1/docker/strength-lab/data`의 `app.db`다. `deploy-pull.sh`는 pull과 `up -d`만 하고 `down -v`와 `app.db` 삭제는 거절한다.

## DB 스키마·마이그레이션

이 PR이 기준 브랜치에 더하는 SQL은 하나다.

| 변경 | 언제 | 내용 |
| --- | --- | --- |
| `programming_shadow_logs` 생성 | `SHADOW_GENERATOR`가 `1`이고 `syncClassWeek`가 돌 때 | `CREATE TABLE IF NOT EXISTS`. 컬럼은 `week_start`, `adopted`, `fallback`, `skeleton_drift`, `retries`, `published`, `created_at` |

기존 테이블의 `ALTER`는 없다. 존 2 A·B와 `performed_option`, `completion_status`, `actual_duration_min`, `actual_rpe`는 `programming_weeks`의 기존 JSON(`intent_json`, `plan_json`, `display_json`) 안에 있다. 컬럼을 더하지 않는다. heavy 하체 다음 날과 하체 날의 존 2에서 `run`을 빼는 것도 그 JSON 안의 enum 제한이다. 스키마 마이그레이션은 없다.

되돌리기. 플래그를 끄면 그 테이블은 더 쓰지 않는다. 테이블까지 지우려면 백업 뒤에 `DROP TABLE IF EXISTS programming_shadow_logs`다. JSON 안의 존 2 필드는 이전 이미지가 읽지 않는다. 행을 고치지 않아도 된다. DB 전체를 배포 전 백업으로 되돌리면 그 테이블과 JSON이 함께 돌아간다.

`src/lib/db/client.ts`의 기동 마이그레이션은 이 PR 이전 기준 브랜치에 이미 있다. main에는 그 파일이 없다. main과 이 브랜치의 머지 충돌은 없고, main에 올리면 그 파일이 새로 들어온다.

## 환경변수

새로 꼭 넣어야 하는 이름은 없다. 이미 운영에 있는 키 변수는 바꾸지 않는다.

새로 읽을 수 있는 이름만 적는다. 값은 적지 않는다.

| 이름 | 기본값 | 켜는 값 |
| --- | --- | --- |
| `SHADOW_GENERATOR` | 꺼짐 | `1` |
| `FALLBACK_WEEK_DISPLAY` | 꺼짐 | `1` |

프로브 전용 `PHASE4_*`는 운영에 넣지 않는다.

## 생성기 플래그

| 이름 | 기본값 | 구 경로 |
| --- | --- | --- |
| `SHADOW_GENERATOR` | 꺼짐. `1`이 아니면 `shadowGeneratorEnabled`는 false | 변수를 비우거나 `1`이 아닌 값으로 둔다. `syncClassWeek`는 새 계획을 수업 화면에 복사한다. `1`이면 화면의 기존 class week를 두고 `programming_shadow_logs`에만 적는다 |
| `FALLBACK_WEEK_DISPLAY` | 꺼짐. `1`이 아니면 `fallbackWeekDisplayEnabled`는 false | 변수를 비운다. fallback 주는 활성 행과 화면 동기화가 되지 않는다. `1`일 때만 fallback도 활성·화면으로 나간다 |

존 2와 짧은 메트콘은 플래그가 없다. 주 6일 생성에 항상 들어간다. 그 경로를 빼려면 이전 이미지로 롤백한다.

`COACHING_PIPELINE`과 `LONGITUDINAL_PLANNING`은 이 PR 이전부터 있고 기본값은 꺼짐이다. 주 생성 함수를 다른 것으로 바꾸지 않는다.

## 기존 기능 스모크

배포 뒤에 운영에서 한 번씩 본다. 이 체크리스트를 쓸 때 아래 항목은 아직 실행하지 않았다.

1. 로그인. `/login`에서 기존 계정으로 들어가고 `/dashboard`가 열린다.
2. 주간 계획 조회. `/plan`에서 이번 주를 열고 `/plan/w/<weekStart>/<day>`가 그 날 블록을 보여 준다.
3. 기록 저장. 세션 또는 WOD에서 한 세트를 저장한다. `set_logs` 또는 `wod_results`에 그 사용자 행이 생긴다.
4. 기록 조회. `/history`에서 방금 저장한 기록이 보인다.
5. 팁. `/wod/<slug>` 또는 세션 날 화면에 팁 문장이 있다.

## 롤백

배포 전에 돌고 있는 이미지 다이제스트를 적는다. 2026-10-11 기록의 운영 태그는 `ghcr.io/psyo1o/strength-lab:9b88b20`다. 그 뒤에 다른 태그가 올라갔으면 배포 직전 태그를 쓴다.

1. `app.db`를 호스트 데이터 디렉터리 밖에 복사한다. 예: `/volume1/docker/strength-lab/data/app.db` → `app.db.bak-<시각>`.
2. `docker-compose.nas.yml`의 `image`를 이전 태그로 고정한다. `:latest`로 두지 않는다.
3. `docker compose -f docker-compose.nas.yml pull` 다음 `up -d --remove-orphans`. `down -v`는 하지 않는다.
4. DB를 배포 전으로 되돌릴 때만 컨테이너를 멈추고 `app.db`를 백업 파일로 덮어쓴다. 덮어쓰기 전에 방금 파일을 한 번 더 복사한다.
5. `SHADOW_GENERATOR`와 `FALLBACK_WEEK_DISPLAY`는 비운다.
