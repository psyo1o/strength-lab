# 회원 관리 배포 체크리스트

병합과 배포는 이 문서가 승인되기 전에는 하지 않는다. 운영 DB와 운영 주는 이 워크스페이스에서 열지 않는다. 키 값과 비밀번호는 적지 않는다.

기준 브랜치는 `cursor/strength-lab-mvp-4f20`(`05c251e`)이다.

## 마이그레이션

앱이 SQLite를 열 때 `src/lib/db/client.ts`가 아래를 적용한다. 별도 SQL 파일을 실행하지 않는다. 기존 행을 지우지 않는다.

| 대상 | 내용 |
| --- | --- |
| `users.display_name` | 이름. 없으면 NULL |
| `users.birth_date` | 생년월일. 없으면 NULL |
| `users.role` | 기본 `member`. `is_admin = 1`이면 `admin` |
| `users.status` | 기본 `active`. 기존 회원은 활성 |
| `users.rejection_reason` | 거절 사유. 없으면 NULL |
| `audit_log` | 승인, 거절, 상태, 역할, 탈퇴, 비밀번호 재설정, WOD 수정 |
| `week_catalog_pins` | 주가 만들어질 때의 카탈로그 버전. 이미 있는 주는 마이그레이션 시점 버전으로 채운다. 과거 카탈로그 파일은 없다 |
| `wod_editions` | 주 수정 버전. 원본 `programming_weeks.plan_json`은 갱신하지 않는다 |
| `generation_charges` | 회원별 새 주 생성 횟수 |

관리자가 한 명도 없으면 `FIRST_ADMIN_EMAIL`과 이메일이 같은 회원을 관리자로 올리고 상태를 `active`로 둔다. 다른 회원 행과 1RM, 수업 주, 기록은 그대로 둔다.

## 환경변수

값은 적지 않는다. 새로 읽는 이름만 적는다.

| 이름 | 없으면 |
| --- | --- |
| `FIRST_ADMIN_EMAIL` | 코드에 있는 첫 관리자 주소. 올바른 이메일이 있을 때만 그 주소가 첫 관리자다 |
| `MEMBER_GENERATION_CAP` | 7일 창에서 회원당 새 주 4회 |
| `MEMBER_GENERATION_WINDOW_MS` | 7일 |

`AUTH_SECRET`, `DATABASE_PATH`, `APP_URL`은 이전과 같다. 생성 경로와 생성 flag는 바꾸지 않았다.

## 요청마다 상태 검사

Next.js 15 미들웨어는 Edge라 SQLite를 열 수 없다. `src/middleware.ts`는 모든 요청에 경로와 메서드만 붙인다. 상태 검사는 노드의 `guardMemberRequest`가 API 라우트마다 하고, 화면은 `(app)` 레이아웃과 생성 페이지가 한다. `pending`, `suspended`, `withdrawn`은 월간 계획 생성과 기록 쓰기를 하지 못한다.

## 배포 전

1. `app.db`를 데이터 디렉터리 밖에 복사한다.
2. 돌고 있는 이미지 태그를 적는다. `:latest`로 덮어쓰지 않는다.
3. 기존 회원 수와 관리자 이메일이 한 명인지 확인한다. 관리자가 없으면 지정한 주소 한 명만 관리자가 된다.

## 배포 후 스모크

1. 기존 계정으로 로그인하고 오늘 화면이 열린다.
2. 새 가입은 대기이고, 승인 전에는 계획과 기록이 거절된다.
3. 관리자가 승인한 뒤 그 회원이 계획을 연다.
4. 주간 운동 수정은 관리자만 저장하고, 저장 버전이 다르면 거절된다.

이 체크리스트를 쓸 때 운영 서버에서는 위 항목을 실행하지 않았다.

## 롤백

1. 배포 전 이미지 태그로 `docker-compose.nas.yml`의 `image`를 고정한다.
2. `docker compose -f docker-compose.nas.yml pull` 다음 `up -d --remove-orphans`. `down -v`는 하지 않는다.
3. 탈퇴로 지운 이름과 이메일은 코드만 되돌려도 복구되지 않는다. 그 값이 필요하면 배포 전 `app.db` 백업으로 덮어쓴다. 덮어쓰기 전에 현재 파일을 한 번 더 복사한다.
4. 백업으로 되돌리지 않으면 새 컬럼과 `audit_log`, `week_catalog_pins`, `wod_editions`, `generation_charges`는 남아도 이전 이미지가 읽지 않는다. 이전 INSERT는 기본값이 있는 컬럼을 비워 둔다.
5. `FIRST_ADMIN_EMAIL`, `MEMBER_GENERATION_CAP`, `MEMBER_GENERATION_WINDOW_MS`는 비워도 된다.
