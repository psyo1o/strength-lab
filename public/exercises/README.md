# 운동 미디어 (NAS / 오프라인)

세션 팁 바텀시트는 아래 경로를 **먼저** 찾습니다.

```
/exercises/{canonicalId}.webp
```

예: 스쿼트 → `public/exercises/back_squat.webp`  
벤치 → `public/exercises/bench_press.webp`

## 로컬 파일 넣기

1. 이 폴더에 `{id}.webp` 를 복사합니다. (jpg/png를 쓰면 `imageUrl`에 `/exercises/파일명`을 적으세요.)
2. 선택: 같은 이름으로 `.mp4` 를 두고 `data/exercise-tips.ko.json` 의 `videoUrl`에 `/exercises/{id}.mp4` 를 넣습니다.
3. 앱을 다시 빌드하거나, 아래처럼 볼륨으로 덮어씁니다.

### Synology Container Manager

두 곳 중 하나에 넣으면 됩니다.

1. 이미지 안 `public/exercises/{id}.webp` (빌드에 포함)
2. 볼륨 `/data/media/{id}.webp` — compose의 `MEDIA_PATH=/data/media`  
   호스트 예: `/volume1/docker/strength-lab/media:/data/media`

실패 시 `/exercises/{id}.webp` 다음 `/api/media/{id}.webp` 를 시도하고, 둘 다 없으면 **미디어 없음**.

Commons 등을 핫링크하지 마세요. 파일을 NAS에 복사합니다.

## 필드

`data/exercise-tips.ko.json` / `data/exercises.canonical.json` 각 종목:

| 필드 | 설명 |
| --- | --- |
| `imageUrl` | 비어 있으면 `/exercises/{id}.webp` |
| `videoUrl` | 선택. `/….mp4` 또는 YouTube/Vimeo URL (탭해야 로드, 자동재생 없음) |
| `credit` | 선택 출처 표기 |

파일이 없거나 로드 실패하면 **미디어 없음** 자리만 보이고, 큐/실수/대안 텍스트는 바로 나옵니다.

**TJ Strength 영상·사진을 스크랩하거나 이미지에 넣지 마세요.** 원본은 재배포를 금지합니다. 본인 촬영분 또는 사용 허가된 자료만 넣으세요.
