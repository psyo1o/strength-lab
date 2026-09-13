# Synology pull deploy / NAS GHCR 배포

NAS must **not** run `next build`. CI builds `linux/arm64` and pushes to GHCR. Everyday update is `./deploy-pull.sh`. Do **not** use `--no-cache` for routine deploys.

NAS에서는 `next build` 하지 않습니다. CI가 `linux/arm64` 이미지를 만들어 GHCR에 올립니다. 일상 업데이트는 `./deploy-pull.sh` 입니다.

## Image

`ghcr.io/psyo1o/strength-lab` — `.github/workflows/docker-ghcr-arm64.yml`.

- push to `main` **and** `cursor/strength-lab-mvp-4f20` (plus `workflow_dispatch`)
- tags: git sha (`type=sha,prefix=`) **and** `latest` (NAS compose pulls `:latest`)
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

This is `docker compose -f docker-compose.nas.yml pull && up -d --force-recreate --remove-orphans`. No rebuild. No `--no-cache`.

## When to use `--no-cache`

Hotfix only — when the GHCR layer cache served a stale image or a COPY did not invalidate.

```sh
docker build --no-cache --platform linux/arm64 -t ghcr.io/psyo1o/strength-lab:hotfix .
```

Local/dev builds stay on `docker-compose.yml` (`build: .`).
