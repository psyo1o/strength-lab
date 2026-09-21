# Synology pull deploy / NAS GHCR 배포

**pull does not wipe user data.** `./deploy-pull.sh` is `compose pull` + `up -d --remove-orphans` only. It never runs `down -v`, never `docker volume rm`, never deletes `app.db`. SQLite lives on the host bind `/volume1/docker/strength-lab/data` (override `DATA_DIR`) or the named volume `strength-lab-data`.

일상 업데이트는 유저/1RM/세트 로그/WOD 기록을 지우지 않습니다. 프로그램 카탈로그만 `SEED_REVISION`이 바뀔 때 다시 심습니다. 강제 카탈로그 재시드는 `.env`에 `FORCE_RESEED=1` (유저 데이터는 그대로).

NAS must **not** run `next build`. CI builds `linux/arm64` and pushes to GHCR. Everyday update is `./deploy-pull.sh`. Do **not** use `--no-cache` for routine deploys. Do **not** use `docker compose down -v`.

NAS에서는 `next build` 하지 않습니다. CI가 `linux/arm64` 이미지를 만들어 GHCR에 올립니다. 일상 업데이트는 `./deploy-pull.sh` 입니다.

## Image

`ghcr.io/psyo1o/strength-lab` — `.github/workflows/docker-ghcr-arm64.yml`.

- push to `main` **and** `cursor/strength-lab-mvp-4f20` (plus `workflow_dispatch`)
- concurrency group `ghcr-linux-arm64-latest` with `cancel-in-progress` — a newer push cancels a stale build so `:latest` cannot move backwards
- every build is tagged with the git SHA (`:ce9cc71` short and full 40-char). Pin the NAS to a SHA if `:latest` is in doubt: `ghcr.io/psyo1o/strength-lab:ce9cc71`
- `:latest` is promoted **only after** the build, and **only if** `GITHUB_SHA` is still the tip of `cursor/strength-lab-mvp-4f20` or `main`. Stale queued runs do not retag `:latest`.
- do **not** retag `:latest` from a hardcoded older SHA
- `GITHUB_TOKEN` + `packages: write`
- GHCR 패키지는 첫 push 때 **private**가 기본입니다. 레포는 public이어도 익명 `docker pull`은 패키지를 **Public**으로 바꾸기 전까지 401/403입니다.

## Package visibility (익명 pull)

레포 `psyo1o/strength-lab`는 public이라 패키지를 Public으로 바꿀 **수 있습니다**. REST API로는 바꿀 수 없고, 패키지 오너(psyo1o)가 UI에서 해야 합니다.

1. 로그인 후 https://github.com/users/psyo1o/packages/container/package/strength-lab (비로그인·권한 없으면 404)
2. Package settings → Danger Zone → Change visibility → **Public**
3. 패키지 이름 입력 후 확인

Public이 되면 PAT 없이 `docker pull ghcr.io/psyo1o/strength-lab:latest`가 됩니다. Private인 동안은 PAT에 **`read:packages`**가 필요합니다(`repo`만으로는 매니페스트 403).

## First-time NAS login

패키지가 아직 private이면:

```sh
# GitHub → Settings → Developer settings → PAT (read:packages)
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
mkdir -p /volume1/docker/strength-lab/data
# .env next to docker-compose.nas.yml must include AUTH_SECRET
./deploy-pull.sh
```

패키지를 Public으로 바꾼 뒤에는 `docker login` 없이 `./deploy-pull.sh`만 하면 됩니다.

## Routine update

```sh
./deploy-pull.sh
```

This is `docker compose -f docker-compose.nas.yml pull && up -d --remove-orphans`. No rebuild. No `--no-cache`. No `--force-recreate`. No `down -v`.

시드 리비전이 바뀌면 컨테이너가 **프로그램 테이블만** 다시 심습니다(유저/1RM/세트 로그/WOD 기록은 유지). 강제 카탈로그 재시드는 `.env`에 `FORCE_RESEED=1`. 유저 데이터를 지우는 플래그는 없습니다.

비밀번호 재설정 `.env` (NAS `docker-compose.nas.yml`이 읽음). **반드시** 공개 호스트를 넣으세요. HTTPS 종료가 없으면 `http://` 입니다.

```
APP_URL=http://soopark.myds.me:7001
# 선택. 없으면 찾기 화면에 1회용 링크를 보여 줍니다(평문 비밀번호는 보내지 않음).
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=you@example.com
SMTP_PASS=app-password
SMTP_FROM=Strength Lab <you@example.com>
```

compose 기본값도 같습니다:

```yaml
environment:
  APP_URL: ${APP_URL:-http://soopark.myds.me:7001}
```

비밀번호 변경 후 다른 기기 세션은 끊고, 지금 로그인한 기기는 유지합니다. 재설정 링크로 바꾸면 모든 세션이 끊깁니다.

## When to use `--no-cache`

Hotfix only — when the GHCR layer cache served a stale image or a COPY did not invalidate.

```sh
docker build --no-cache --platform linux/arm64 -t ghcr.io/psyo1o/strength-lab:hotfix .
```

Local/dev builds stay on `docker-compose.yml` (`build: .`).
