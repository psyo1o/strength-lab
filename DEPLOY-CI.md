# Synology pull deploy / NAS GHCR 배포

NAS must **not** run `next build`. CI builds `linux/arm64` and pushes to GHCR. Everyday update is `./deploy-pull.sh`. Do **not** use `--no-cache` for routine deploys.

NAS에서는 `next build` 하지 않습니다. CI가 `linux/arm64` 이미지를 만들어 GHCR에 올립니다. 일상 업데이트는 `./deploy-pull.sh` 입니다.

## Image

`ghcr.io/psyo1o/strength-lab` — `.github/workflows/docker-ghcr-arm64.yml`.

- push to `main` **and** `cursor/strength-lab-mvp-4f20` (plus `workflow_dispatch`)
- tags: git sha (`type=sha,prefix=`); `latest` only on the default branch
- `GITHUB_TOKEN` + `packages: write`

## First-time NAS login

```sh
# GitHub → Settings → Developer settings → PAT (read:packages)
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
mkdir -p /volume1/docker/strength-lab/data
# .env next to docker-compose.nas.yml must include AUTH_SECRET
./deploy-pull.sh
```

패키지가 private이면 NAS에서 `ghcr.io` 로그인 한 번이 필요합니다.

## Routine update

```sh
./deploy-pull.sh
```

This is `docker compose -f docker-compose.nas.yml pull && up -d --force-recreate --remove-orphans`. No rebuild. No `--no-cache`.

## When to use `--no-cache`

Hotfix only — when the GHCR layer cache served a stale image or a COPY did not invalidate.

```sh
docker build --no-cache --platform linux/arm64 -t ghcr.io/psyo1o/strength-lab:hotfix .
```

Local/dev builds stay on `docker-compose.yml` (`build: .`).
