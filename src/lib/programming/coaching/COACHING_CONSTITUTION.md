# Strength Lab Coaching Constitution

This is the top rule for the coaching pipeline (`COACHING_PIPELINE=1`). Stage 10 does not read it. When a heuristic and this document disagree, this document wins. Hard invariants stay hard.

## Principles

A. Repetition is not a failure. A repeated squat in a 5/3/1 progression, a benchmark retest, skill practice, or a weakness block can be intentional. `movement repeated = FAIL` is forbidden.

B. A different name is not a different stimulus. Pull-up, chest-to-bar, and toes-to-bar can share pulling stress. The same movement at a different volume, intensity, duration, or purpose is not the same session.

C. A validator is not coaching truth. It may reject only schema, catalog, equipment, unit, number shape, class time, obvious safety, obvious method-table violations, and impossible prescriptions. Everything else is a signal, a risk, or a concern.

D. Coaching judgment depends on context. "Pull-up appeared three times" is a fact. "Therefore the week is bad" is not. The analyzer states the fact. A specialist interprets it. The head coach decides.

## Hierarchy

```text
COACHING CONSTITUTION
  → MONTHLY BLOCK / METHOD
  → WEEKLY INTENT
  → SESSION INTENT
  → HARD VALIDATION
  → ANALYZERS
  → SPECIALIST COACHES
  → HEAD COACH
  → REVISION
  → FINAL HARD VALIDATION
  → FINAL HEAD DECISION
```

An analyzer must not sit above the session and forbid a day outright.

## Rule categories

| Category | What it may do |
| --- | --- |
| HARD_INVARIANT | Reject. Schema, enum, movement catalog, equipment catalog, unit, class clock, obvious safety, impossible prescription. |
| METHOD_RULE | Apply only to the method the monthly coach kept. 5/3/1 is not the universal law. Sets that contradict the active method table are rejected. |
| ANALYTICAL_SIGNAL | State facts. Frequency, pattern, volume, intensity, time domain, similarity score, fatigue. A score of 4 is a fact. |
| COACHING_CONCERN | Name a possible problem. Do not reject. |
| SPECIALIST_JUDGMENT | One domain. Status is PASS, CONCERN, or CRITICAL. No rewritten WOD. |
| HEAD_DECISION | APPROVE, APPROVE_WITH_NOTE, or REVISE. Only the head chooses a revision. |

## Similarity

The threshold remains 4 (`COACHING_POLICY.similarity_threshold`). Stage 13 records that score as a signal. It does not reject a day or a week for similarity, movement repetition, or structure repetition. Stage 10 `judgeWeek` is unchanged and still treats the same threshold as a hard check on the production path.

## Repetition intent

A repeated exposure carries one of: `progression`, `benchmark`, `skill_practice`, `weakness_focus`, `method_requirement`, `none`. Variation does not reject `progression`.

## Roles

- Monthly coach: month strategy. No workouts.
- Weekly coach: seven purposes. No movements or sets. Week rules from the month are immutable.
- Session coach: one day. It does not judge the rest of the week.
- Load coach: progress, hold, or cut. After a revised session it judges again. The method table supplies the numbers.
- Analyzers: facts only.
- Specialists: one judgment each.
- Head coach: the only role that approves, notes, or asks for a revision. It does not write the workout.
- Head decision order: evidence, risk, priority, trade-off, smallest action, then APPROVE, APPROVE_WITH_NOTE, or REVISE.
- Similarity alone is at most MINOR and priority P3. It does not revise the week.
- A specialist CONCERN is not a revision. Three minor notes are not a revision.
- P0 safety and impossible execution are revised in code, whatever the model confidence is.
- Low confidence prefers APPROVE_WITH_NOTE unless a P0 issue is present.
- Revision router: sends the problem to the smallest owning agent. Weekly rule failures call the weekly coach. Monthly conflicts call monthly, then weekly, then the affected sessions. Maximum two rounds.
- A week that fails final validation is stored as failed and is not the active week.

## What this pipeline will not do

```text
movement repeated → FAIL
similarity >= 4 → FAIL
same structure → FAIL
specialist says bad → replace the WOD
concern → REVISE
similarity >= threshold → REVISE
three minor issues → REVISE
head writes a new WOD
```

The chain is fact, signal, specialist interpretation, head judgment, then action.
