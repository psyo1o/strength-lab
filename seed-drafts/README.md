# P1 seed drafts (data-bot import hook)

프로그램 JSON은 **id 단위**로 `data/seed.json` 에 병합합니다. P0(`jim-wendler-531`, `starting-strength`, `stronglifts-5x5`, `madcow-5x5`)는 유지합니다.

```sh
# gzip+base64 또는 .json / .json.gz
npx tsx scripts/merge-seed-programs.ts payload.b64
npx tsx scripts/merge-seed-programs.ts torokhtiy.json catalyst.json.gz
```

`completeness` 는 시드된 주 중 빈 날이 있으면 `template`, 아니면 `working` (Wendler는 `full`).

부팅 시 `seed.p1.json` (또는 `SEED_P1_PATH`)이 있으면 slug 단위로 한 번 더 덮어씁니다.

- 스키마: 공개 seed와 동일 (`meta` → `programs[]` → `weeks[]` → `days[]` → `exercises[]` → `sets[]` with `percent` + `of`: `TM`|`1RM`)
- 세트에 `platePlan` 넣지 마세요. 반올림은 2.5kg.
