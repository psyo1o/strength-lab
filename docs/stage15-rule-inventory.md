# Stage 15 rule inventory

Audited before the policy change. The live conflict was METHOD-CUT-001: Load wrote a fatigue cut for bench and overhead press, and the strength validator allows that cut only on squat and deadlift.

| ID | Name | Where it lived | Agents | Validators | Strength | Source of truth | Conflict |
|---|---|---|---|---|---|---|---|
| METHOD-CUT-001 | fatigue cut | `load.ts` `setsForAction`, `strength-methods.ts` | Load | Strength, Final | HARD | `fatigueCutAllowed` | Resolved. Upper body no longer receives the cut row. |
| METHOD-UPPER-001 | upper-body sets | `strengthCheckFatigue`, prompts | Load, Session | Strength | HARD | `setsForMethodAction` | Resolved with METHOD-CUT-001. |
| SAFETY-SEQ-001 | heavy squat after heavy deadlift | `rules.ts` only | Head, once findings are attached | Session sequence, Final | HARD | `safetyViolations` | Was one inline copy. Now one function. |
| WEEK-LONG-001 | long conditioning count | weekly plan, constitution, final gate | Weekly | Weekly, Final | HARD | `longConditioningCountAllowed` | Three copies, one predicate. |
| WEEK-BENCH-001 | benchmark count | weekly plan, constitution | Weekly | Weekly, Final | HARD | `benchmarkCountAllowed` | Two copies, one predicate. |
| WEEK-BENCH-002 | benchmark content | head `weakBenchmark` | Head | none | SOFT | `benchmarkContentConcern` | Content is a concern. Count stays hard. |
| COACH-REPEAT-001 | stimulus or movement repetition | constitution, `isCoachingSignal` | Variation, Head | Final filters it | SOFT | `isCoachingSignal` | Not a day reject. |
| WEEK-DELOAD-001 | deload phase | `weekPlanErrors` | Monthly, Weekly | Weekly | HARD | `weekPlanErrors` plus the bounded router | Heavy progression on a deload week is retried, then stopped. |

The machine-readable copy is `src/lib/programming/coaching/stage15/inventory.ts`.
