# Strength Lab

시놀로지 NAS에서 돌리는 스트렝스 훈련 웹앱입니다. 체육관 바닥에서 폰으로 보고, 엑셀 없이 세트를 소화하는 것이 목표입니다.

---

## Features / 기능

- 이메일 + 비밀번호 가입/로그인 (세션 쿠키). 가입 시 비밀번호 확인. 여러 계정 가능
- 로그인 후 설정 → 비밀번호 변경. 비밀번호 찾기(`/forgot-password`)는 SMTP가 있으면 메일, 없으면 화면에 1회용 링크(약 1시간)
- 1RM을 kg로 저장, 화면만 kg/lb 전환
- 프로그램 → 주 → 일 → 세트(중량×반복). 큰 버튼, 완료 체크, 휴식 타이머
- 5/3/1은 `MROUND(1RM × 0.9 × pct/100, 2.5)` — TM을 먼저 반올림하지 않음. QA: 1RM 155 → W1 85% = 117.5 (120 아님). 200kg W1 = 117.5 / 135 / 152.5
- 원판 계산기, Epley 1RM 헬퍼, 한국어 종목 팁(사진/영상 선택, `public/exercises/{id}.webp`)
- SQLite 파일을 볼륨에 보관 (`/data`)

프로그램 완성도는 [CHANGELOG.md](./CHANGELOG.md)를 보세요.

---

## Quick start (local)

```bash
cp .env.example .env
# AUTH_SECRET 을 긴 랜덤 문자열로 바꾸세요
# 비밀번호 재설정 링크용: APP_URL=http://soopark.myds.me:7001
# 메일 보내기(선택): SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM
npm install
npm test
npm run dev
```

브라우저에서 http://localhost:3000

시드 데이터를 다시 쓰려면:

```bash
npx tsx scripts/export-seed.ts
DATABASE_PATH=./data/app.db npx tsx src/lib/db/seed.ts
```

`data/seed.json`이 있으면 그 파일을 넣고, 없으면 카탈로그 코드에서 생성합니다. 빈 DB는 첫 기동 때 자동 시드됩니다.

운동 사진: `public/exercises/` 에 `{canonicalId}.webp` 를 넣으면 오프라인 NAS에서도 팁 시트에 나옵니다. 방법은 [public/exercises/README.md](./public/exercises/README.md). 외부 코칭 영상을 스크랩·동봉하지 마세요.

P1 초안 JSON은 `seed-drafts/seed.p1.json` (또는 `SEED_P1_PATH`) — 있으면 프로그램 slug를 덮어씁니다.

---

## Docker / Synology Container Manager

게시 URL: **http://soopark.myds.me:7001**. `.env`에 `APP_URL=http://soopark.myds.me:7001` (재설정 메일/화면 링크).  
`docker-compose.yml`은 **호스트 7001 → 컨테이너 3000**(Next.js `PORT`)입니다. 앱 코드에 호스트를 넣지 말고 `APP_URL`을 쓰세요.

### 한국어 절차

1. 저장소를 NAS 폴더에 둡니다. 예: `/volume1/docker/strength-lab`
2. `.env.example`을 `.env`로 복사하고 `AUTH_SECRET`을 긴 랜덤 문자열로 바꿉니다. **`APP_URL=http://soopark.myds.me:7001`** 을 넣습니다. 재설정 메일을 쓰려면 `SMTP_*`도 넣습니다. SMTP가 없으면 찾기 화면에 1회용 링크가 나타납니다.

```bash
openssl rand -hex 32
```

3. **Container Manager → 프로젝트 → 생성**
   - 경로: 위 폴더 (`docker-compose.yml`이 있어야 함)
   - 프로젝트 이름: `strength-lab`
   - 이미지는 compose의 `build: .`로 **로컬 빌드**됩니다 (레지스트리 풀 아님)
   - 포트: `7001:3000`
   - 볼륨: `strength-lab-data` → 컨테이너 `/data` (SQLite `DATABASE_PATH=/data/app.db`)
   - 빌드 후 시작
4. 또는 SSH:

```bash
cd /volume1/docker/strength-lab
docker compose up --build -d
```

5. 브라우저: [http://soopark.myds.me:7001](http://soopark.myds.me:7001)

**운동 사진/영상 (오프라인):** Commons를 핫링크하지 마세요. 파일을 NAS에 복사합니다.

```bash
mkdir -p /volume1/docker/strength-lab/media
# 예: back_squat.webp, bench_press.webp
cp my-photo.webp /volume1/docker/strength-lab/media/back_squat.webp
```

`docker-compose.yml`에서 아래 줄을 켜면 컨테이너 `/data/media`로 붙습니다.

```yaml
volumes:
  - strength-lab-data:/data
  - /volume1/docker/strength-lab/media:/data/media
```

앱은 `/exercises/{id}.webp`(이미지에 넣은 파일) 다음 `/api/media/{id}.webp`(`/data/media`)를 봅니다. 없으면 팁 시트에 **미디어 없음**. 외부 코칭 영상은 넣지 마세요.

공유 폴더에 DB를 직접 남기려면 volumes를 다음처럼 바꿉니다.

```yaml
volumes:
  - /volume1/docker/strength-lab/data:/data
```

**포트 충돌:** DSM에서 7001이 이미 쓰이면 `docker-compose.yml`의 `"7001:3000"`에서 **앞 숫자(호스트)** 만 바꾸세요. 예: `"7002:3000"` → `http://soopark.myds.me:7002` 그리고 `APP_URL`도 같은 포트로. 컨테이너 쪽 3000은 그대로 둡니다.

HTTPS(리버스 프록시)를 쓰면 `.env`에 `COOKIE_SECURE=1`을 넣을 수 있습니다. 홈 LAN HTTP만 쓰면 넣지 마세요.

### English (Synology)

Publish at **http://soopark.myds.me:7001**. Set `APP_URL=http://soopark.myds.me:7001`. Compose maps **host 7001 → container 3000**. Do not hardcode the host in application code.

1. Copy the repo onto the NAS (e.g. `/volume1/docker/strength-lab`).
2. Copy `.env.example` → `.env` and set `AUTH_SECRET`.
3. **Container Manager → Project → Create** from that folder. The image is built from `Dockerfile` (`build: .`). Persist SQLite with the `/data` volume. Port mapping is `7001:3000`.
4. Or SSH: `docker compose up --build -d`
5. Open http://soopark.myds.me:7001

If DSM already uses 7001, change only the **host** side of `"7001:3000"` (e.g. `"7002:3000"`). Leave container port 3000 as-is.

Exercise media: copy `{id}.webp` into a host folder and bind-mount it to `/data/media` (see `docker-compose.yml`). Do not hotlink third-party media or bundle coaching videos.

---

## English (short)

Self-hosted Next.js + SQLite strength app. Copy `.env.example` → `.env`, set `AUTH_SECRET`, then `docker compose up --build`. Persist `/data`. Korean UI by default. See CHANGELOG for program completeness.

Tests: `npm test` covers signup, login, save 1RM, 5/3/1 week-1 squat loads (`MROUND(1RM×0.9×pct/100, 2.5)` on the product — 200kg → 117.5/135/152.5; 155kg W1 85% → 117.5), start-weight override on Stronglifts, kg/lb plate math, optional tip media fields, and P1 Juggernaut load.

---

## Tech

- Next.js App Router, TypeScript, Tailwind
- SQLite + Drizzle schema + `better-sqlite3`
- Credential auth, httpOnly session cookies
- Seed: `data/seed.json` (`meta` → `oneRmFields` → `loadRules` → `programs[]` → `weeks[]` → `days[]` → `exercises[]` → `sets[]` with `percent` + `of`: TM|1RM). No `platePlan` on sets.

Architecture: **programs → weeks → days → exercises → sets**.
