# P1 seed drafts (data-bot import hook)

프로그램 JSON은 **id 단위**로 `data/seed.json` 에 병합합니다. 채팅에 붙인 거대 gzip+base64는 잘리거나 CRC가 깨지므로 쓰지 마세요. 저장소의 `.json` / `.b64` 파일만 `merge-seed-programs.ts`에 넘깁니다. 자세한 이유와 권장 경로는 `scripts/import-seed-from-url.md`. P0(`jim-wendler-531`, `starting-strength`, `stronglifts-5x5`, `madcow-5x5`)는 유지합니다.

```sh
# gzip+base64 또는 .json / .json.gz
npx tsx scripts/merge-seed-programs.ts payload.b64
npx tsx scripts/merge-seed-programs.ts torokhtiy.json catalyst.json.gz
```

`completeness` 는 시드된 주 중 빈 날이 있으면 `template`, 아니면 `working` (Wendler는 `full`).

부팅 시 `seed.p1.json` (또는 `SEED_P1_PATH`)이 있으면 slug 단위로 한 번 더 덮어씁니다.

`programs-split/` (부모 박스의 torokhtiy 13주·Takano Class III 8 / II 9 / I 12·Catalyst 기본+스페셜티 엑셀)은 **이 저장소에 도착하지 않았습니다.** 유료 주를 추정해 채우지 않습니다. 공개 시드는 생성기 주(Takano 12 / Catalyst 12 / Torokhtiy 13 / LBEB 12, 빈 날 없음 → 진행 가능). LBEB W7–12는 공개 12주 텍스트(`public-lbeb-12w-olympic`).

`cowboy.json.b64` 는 부모 cowboy 원문(B64_LEN=4512). gzip CRC는 깨져 있어도 13주 풀세트는 복구됩니다. 채팅에 다시 붙이지 말고, 복구·변환한 JSON만 `merge-seed-programs.ts`로 id=cowboy 병합하세요.

`juggernaut.part-a.b64` 는 부모 JUG_A 원문. **파트 B가 오기 전에 디코드하지 말 것.** `JUG_A` + `JUG_B` 를 이어 붙인 뒤에만 gunzip 합니다.

P0 교체 원문 (`printf %s "$B64" | base64 -d | gunzip`):

- `madcow-5x5.b64` — 꼬리 CRC/summaryKo 잘림. 복구본 `madcow-5x5.week1.json` (1주+메타). 생성기가 같은 템플릿을 4주로 펼침.
- `starting-strength.b64` — `$<n/` 오염. 디코드 실패. 시드 주를 교체하지 않음.
- `jim-wendler-531.b64` — base64 길이 오류. 디코드 실패. 시드 주를 교체하지 않음.

- 스키마: 공개 seed와 동일 (`meta` → `programs[]` → `weeks[]` → `days[]` → `exercises[]` → `sets[]` with `percent` + `of`: `TM`|`1RM`)
- 세트에 `platePlan` 넣지 마세요. 반올림은 2.5kg.
