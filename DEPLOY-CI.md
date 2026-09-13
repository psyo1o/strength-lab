# Synology pull deploy / NAS GHCR 배포

Routine NAS updates **pull the prebuilt image**. Do not use `docker build --no-cache` unless a hotfix failed to pick up a file.

일반 업데이트는 **미리 빌드된 이미지를 pull** 합니다. 파일이 안 들어갈 때만 `--no-cache`를 씁니다.

## Image

`ghcr.io/psyo1o/strength-lab` — tags `latest` and `<git sha>`. Built on push to `main` or `cursor/**` (`linux/arm64`).

## First-time NAS login

```sh
# GitHub → Settings → Developer settings → PAT (read:packages)
echo YOUR_PAT | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
mkdir -p /volume1/docker/strength-lab/data /volume1/docker/strength-lab/media
export AUTH_SECRET='a-long-random-secret'
# optional: DATA_PATH, MEDIA_PATH_HOST, HOST_PORT, STRENGTH_LAB_TAG
sh scripts/deploy-pull.sh
```

패키지가 private이면 NAS에서 `ghcr.io` 로그인 한 번이 필요합니다.

## Routine update

```sh
export AUTH_SECRET='same-as-before'
sh scripts/deploy-pull.sh
```

This is `docker compose -f docker-compose.nas.yml pull && up -d`. No rebuild.

## When to use `--no-cache`

Only for hotfixes when the GHCR layer cache served a stale image or a COPY did not invalidate. Example:

```sh
docker build --no-cache --platform linux/arm64 -t ghcr.io/psyo1o/strength-lab:hotfix .
```

Local/dev builds stay on `docker-compose.yml` (`build: .`).
