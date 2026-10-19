# Native healing modifier candidates

Five current single-action `addModified` definitions now have handwritten TypeScript candidates in `official/heal-modifiers.ts`: healing -15%, +20%, +40%, -50%, and the emblem's 20% chance of doubled healing. IDs remain unchanged. The manifest pins every source definition; all records remain U pending official catalog admission and full-game acceptance.

The authoring layer adds `contexts.heal`, `conditions.selfBeHealed`, `conditions.chance` and `ops.modifyHeal`. Damage and healing modifiers share one implementation for percent-then-delta reads, missing inputs, finite-number validation and battle ownership. Each action queries the nearest matching context afresh. The condition deliberately checks the direct HealContext target, matching legacy `selfBeHeal` and heal-stage `checkSelf`; it does not broaden admission to ancestors.

Probability uses one `battle.random()` draw and a strict `< percent / 100` comparison on every call, including 0 and 100. The owning condition tree controls short-circuiting. The emblem first checks target ownership, then rolls; a rejected ownership condition consumes no random value. This matches the unchanged legacy evaluator, including cancellation after admission. No random ValuePlan or persistent random subscription is introduced.

The public test covers 320 comparisons (five IDs, skill/mark sources, four seeds and eight scenarios), both probability outcomes, five fresh-catalog JSON continuation scenarios and source hashes: 327 checks total. Real HealPhase scenarios include ordinary healing, wrong target, execution-time source ownership change, effect cancellation, healing cancellation, full HP, fainted targets and repeated healing. Comparisons include modifier values, heal results, HP, emitted messages and subsequent RNG. Effect-failure source IDs are validated against the actual source before normalizing independent instance IDs.

Continuation saves at the actual selection boundary after one healing operation, restores from JSON with newly compiled candidate effects, and performs twenty further healing operations. Native and legacy, uninterrupted and restored, must all agree. This verifies bounded phase continuation, not a completed battle or production loading.

Three source-authoring tests independently exercise nested heal context lookup, ordered reads when percent is absent, probability draws at certainty boundaries and all/any short-circuiting. Review caught a shared-operation regression when a value callback appends a foreign battle context to the selected array; each write now rechecks ownership, preserving the prior damage behavior, and a regression covers damage and healing. The complete source authoring/binding suite passes 48 tests; both TypeScript checks pass. Standards and Spec reviews pass after the ownership regression fix. Declaration build, scoped lint, source provenance and final Node/Chrome host checks pass. Full V4 regression passes all 7,027 tests across 42 files (372.12 seconds).

Reproduce:

```sh
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/heal-modifiers.test.ts
pnpm test:effect-authoring-design
pnpm typecheck:effect-authoring-design
pnpm typecheck:battle-v4
```
