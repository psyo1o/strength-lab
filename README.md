# Strength Lab

개인 NAS(시놀로지)에서 돌리는 스트렝스 훈련 웹앱입니다. 체육관 바닥에서 폰으로 보고, 엑셀 없이 세트를 소화하는 것이 목표입니다.

영감을 받은 자료: 비공개 스프레드시트 **「스트렝스 프로그램 Ver 8.0b by TJ 스트렝스」** (YouTube: [TJ Strength](https://youtube.com/tjstrength0423)).  
**개인 사용 전용**이며 원본은 상업적 이용·재배포를 금지합니다. 제휴·공식 앱이 아닙니다.

> Based on TJ Strength materials — personal use only; original forbids commercial use / redistribution.

---

## Features / 기능

- 이메일 + 비밀번호 가입/로그인 (세션 쿠키). 여러 계정 가능
- 1RM을 kg로 저장, 화면만 kg/lb 전환
- 프로그램 → 주 → 일 → 세트(중량×반복). 큰 버튼, 완료 체크, 휴식 타이머
- 5/3/1은 Training Max와 주차 %가 실제 kg로 계산되고 원판 구성까지 표시
- 원판 계산기, Epley 1RM 헬퍼, 한국어 종목 팁
- SQLite 파일을 볼륨에 보관 (`/data`)

프로그램 완성도는 [CHANGELOG.md](./CHANGELOG.md)를 보세요.

---

## Quick start (local)

```bash
cp .env.example .env
# AUTH_SECRET 을 긴 랜덤 문자열로 바꾸세요
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

---

## Docker / Synology Container Manager

대상 NAS: `192.168.50.3`. 게시 URL: **http://192.168.50.3:7001**  
`docker-compose.yml`은 **호스트 7001 → 컨테이너 3000**(Next.js `PORT`)입니다. LAN IP는 앱 코드에 넣지 않습니다.

### 한국어 절차

1. 저장소를 NAS 폴더에 둡니다. 예: `/volume1/docker/strength-lab`
2. `.env.example`을 `.env`로 복사하고 `AUTH_SECRET`을 긴 랜덤 문자열로 바꿉니다.

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

5. 브라우저: [http://192.168.50.3:7001](http://192.168.50.3:7001)

공유 폴더에 DB를 직접 남기려면 volumes를 다음처럼 바꿉니다.

```yaml
volumes:
  - /volume1/docker/strength-lab/data:/data
```

**포트 충돌:** DSM에서 7001이 이미 쓰이면 `docker-compose.yml`의 `"7001:3000"`에서 **앞 숫자(호스트)** 만 바꾸세요. 예: `"7002:3000"` → `http://192.168.50.3:7002`. 컨테이너 쪽 3000은 그대로 둡니다.

HTTPS(리버스 프록시)를 쓰면 `.env`에 `COOKIE_SECURE=1`을 넣을 수 있습니다. 홈 LAN HTTP만 쓰면 넣지 마세요.

### English (Synology)

Publish at **http://192.168.50.3:7001**. Compose maps **host 7001 → container 3000**. Do not put the LAN IP in application code.

1. Copy the repo onto the NAS (e.g. `/volume1/docker/strength-lab`).
2. Copy `.env.example` → `.env` and set `AUTH_SECRET`.
3. **Container Manager → Project → Create** from that folder. The image is built from `Dockerfile` (`build: .`). Persist SQLite with the `/data` volume. Port mapping is `7001:3000`.
4. Or SSH: `docker compose up --build -d`
5. Open http://192.168.50.3:7001

If DSM already uses 7001, change only the **host** side of `"7001:3000"` (e.g. `"7002:3000"`). Leave container port 3000 as-is.

---

## English (short)

Self-hosted Next.js + SQLite strength app. Copy `.env.example` → `.env`, set `AUTH_SECRET`, then `docker compose up --build`. Persist `/data`. Korean UI by default. Personal NAS use only; not affiliated with TJ Strength. See CHANGELOG for full vs template-only programs.

Tests: `npm test` covers signup, login, save 1RM, 5/3/1 week-1 squat loads, and kg/lb plate math. Loads round to 2.5 kg (or 5 lb).

---

## Tech

- Next.js App Router, TypeScript, Tailwind
- SQLite + Drizzle schema + `better-sqlite3`
- Credential auth, httpOnly session cookies
- Seed: `data/seed.json`

Architecture: **programs → weeks → days → exercises → sets**.
