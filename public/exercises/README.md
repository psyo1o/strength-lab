# 운동 미디어 (NAS / 오프라인)

P0는 **미디어 URL이 비어 있습니다.** 텍스트 팁만 제공합니다.  
파일을 직접 넣기 전까지 바텀시트는 **미디어 없음**을 보여 줍니다.

## 스키마 (`media` 객체)

| 필드 | 값 |
| --- | --- |
| `imageUrl`, `videoUrl` | nullable. 로컬 경로만 (`/exercises/…` 또는 `/api/media/…`) |
| `credit` | URL이 있을 때만 시트에 표시 |
| `license` | `empty` / `cc-by-3.0` / `cc-by-sa-3.0` / `cc-by-sa-4.0` / `cc0` / `pd` / `self_shot` / `user_upload` |
| `licenseUrl`, `sourcePage`, `alt` | 선택 |
| `origin` | `empty` / `self_shot` / `user_upload` / `cc` |

외부 사이트 핫링크 금지. 유료 코칭 클립을 넣거나 스크랩하지 마세요.

## 파일 넣는 법

1. **이미지에 포함:** 이 폴더에 `{canonicalId}.webp`  
   예: `public/exercises/back_squat.webp`
2. **NAS 볼륨 (재빌드 없이):** 호스트 폴더를 `/data/media`에 마운트

```yaml
# docker-compose.yml
environment:
  MEDIA_PATH: /data/media
volumes:
  - strength-lab-data:/data
  - /volume1/docker/strength-lab/media:/data/media
```

```bash
mkdir -p /volume1/docker/strength-lab/media
cp back_squat.webp /volume1/docker/strength-lab/media/
# 선택: 같은 이름 .mp4 → tips JSON media.videoUrl = "/api/media/back_squat.mp4"
```

조회 순서: `/exercises/{id}.webp` → `/api/media/{id}.webp` → **미디어 없음**.  
크레딧은 `imageUrl`/`videoUrl`을 JSON에 적은 뒤에만 표시합니다.
