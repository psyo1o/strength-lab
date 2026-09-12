# P1 seed drafts (data-bot import hook)

이 폴더의 `seed.p1.json` 이 있으면 부팅/`loadSeedFile()` 이 `data/seed.json` 위에 **slug 단위로 덮어씁니다**.

- 경로: `seed-drafts/seed.p1.json` (또는 env `SEED_P1_PATH`)
- 스키마: 공개 seed와 동일 (`meta` → `programs[]` → `weeks[]` → `days[]` → `exercises[]` → `sets[]` with `percent` + `of`: `TM`|`1RM`)
- 세트에 `platePlan` 넣지 마세요. 반올림은 2.5kg.

파일이 없으면 카탈로그/공개 지식 P1 구조(`catalog.ts`)를 씁니다.
