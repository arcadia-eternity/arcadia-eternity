# Random stat actions

Three explicit native candidates use the shared authoring APIs, without adding a new DSL interpreter. `randomAction` reads one shuffled choice when the effect executes, then invokes it. Each selected action queries its target at execution time. Paired changes use `actions.sequence`, so the second action queries again even if the first action changes the active opponent or is cancelled.

The admission condition retains source skill ownership, the owner's `mark_emblem_wuxing`, and the opponent active pet's NoGender value. The choices are opponent atk/spa -1; owner atk/spe +1; and opponent [atk, def]/[spa, spd] -1. `spe` is speed and `spd` is special defense.

## Historical comparison and C17

The paired effect compares directly with unchanged YAML. The two flat action selections use explicit correction C17: wrap each action in a singleton array and flatten after randomPick. This makes the restored legacy parser defer action execution until after selection. Original production YAML is untouched. The historical eager-execution behavior is separately characterized in historical-action-selection.md; equality with the corrected oracle is not represented as equality with that bug.

The ledger pins normalized source hashes and records the historical revision and correction separately. The emblem dependency is checked by ID, as in the original condition. These candidates are explicitly exported and are not automatically admitted into the production catalog.

## Validation

Both source kinds and two seeds covering opposite outcomes are tested. Cases include missing emblem, wrong gender, wrong actor, nested contexts, changing the active opponent during the draw, changing it between paired actions, cancelling the first stage application, repeated execution, cancelling the whole effect, and a real SkillPhase. Assertions include exact stat/level results, state before the random draw, subsequent RNG state, target identity after changes, and continuing the second action after cancellation of the first.

The initial independent public-build run passed 108 effect comparisons and 11 historical action-selection checks. The expanded suite including between-action boundaries passed all 132 comparisons against the independent public build. Both TypeScript checks and V4 lint passed. Full-game/fresh-catalog snapshot acceptance and dependency closure remain required before production admission.
