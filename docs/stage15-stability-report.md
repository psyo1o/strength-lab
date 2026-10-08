# Stage 15 stability report

Cloud run has no model key. Live model weeks were not generated here. Typecheck, the full vitest suite (275), and `scripts/probe-stage15.ts` (deterministic, two passes) were run.

## 1. Rule inventory

- Duplicate rules: fatigue cut, long-day count, benchmark count. See `docs/stage15-rule-inventory.md`.
- Conflicting rule: METHOD-CUT-001. Load wrote an upper-body fatigue cut. The strength validator allows that cut only on squat and deadlift.
- Unified rules: `fatigueCutAllowed`, `setsForMethodAction`, `safetyViolations`, `longConditioningCountAllowed`, `benchmarkCountAllowed`.

## 2. Single source of truth

- Method: `src/lib/programming/coaching/stage15/fatigue-cut.ts` and `method-policy.ts`.
- Load: `setsForAction` calls `setsForMethodAction`. An upper-body cut stays on the method table.
- Validator: `validateStrengthPrescription` uses `fatigueCutAllowed`.
- Weekly: long-day and benchmark counts use `week-policy.ts`.
- Benchmark: count is hard. Accessory content is a coaching concern.

## 3. Error isolation

- A day hard error replaces only that day, then validates the fallback once.
- A week-level rule does not rewrite the other days.
- A fallback that is still illegal is `FAILED`. The original model session stays in `day_records.original_model_output`.
- Week status `FAILED` does not relabel healthy days as fallback.
- A failed week with surviving model days is stored as a failed row. It is not replaced by a whole-week legacy program.

## 4. Head

- `hard_rule_findings` is on the head input, from the same hard report the final gate uses.
- Similarity and repetition stay concerns. They do not reject a day.
- The head decision policy is unchanged. Scores are recorded and do not choose REVISE.

## 5. Agent contracts

- Variation judge has its own prompt, schema, and parser. A head payload is invalid.
- Recovery judge is separate. It runs for high-risk or ambiguous fatigue, not for a clear pass.
- Weekly retry: one extra attempt after a week-rule failure (`MAX_WEEKLY_ROUTER_RETRIES = 1`).
- Monthly retry: one monthly call, then one weekly call, when the failure is a deload alignment error.

## 6. Probe safety

- `scripts/probe-stage15.ts` refuses any week that is not 2099.
- If the previous programming week is `2026-10-05` or any other non-2099 week, the database probe aborts before it writes.
- `STRENGTH_LAB_PROBE=1` makes `recomputeWeeklyActual` skip every non-2099 week.
- A stored actual whose note is `프로브 수행` is not recomputed again.
- Deterministic probe: structure hash `da5ece044a2c4fa1`, stable across two runs. No database writes.

## 7. Regression

Covered by `tests/programming-stage15.test.ts`: load/method, day isolation, weekly retry, monthly retry, variation schema, recovery gating, benchmark hard/soft split, intentional repetition, same stimulus, probe hash.

## 8. Simulation

Deterministic keyless pass only. W1–W4 and S1–S2 completed twice with the same structure. Model days were not counted because this environment has no model key.

## 9. Model days

Not measured live. The pipeline no longer deletes a valid model day to repair a neighbor.

## 10. Fallback

Fallback days are validated once. A second failure is `FAILED`, not another recipe. Quality fields are stored and do not decide.

## 11. Remaining bugs

- Live model behavior of the new judge schemas is untested until the NAS probe.
- The week column `generation_source` is still `model` or `fallback` so older readers stay valid. The four-way source is `day_records.final_source`.
- A week with no surviving model day can still fall through to one legacy week. That path is not a loop.

## 12. Next stage

After a NAS probe shows late hard rules at zero, use the stored dimension scores. Do not add a score threshold until the method, validator, and fallback rows agree on the same weeks.
