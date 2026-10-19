# Native damage modifier candidates

The offline generator recognizes 82 candidates from 117 current single-action `addModified` definitions. It preserves the existing handwritten HP-tier candidate separately, and records 34 unsupported definitions with source hashes and rejection reasons. These are candidates only: all records remain U and production loading is unchanged.

## Authoring target

Generated code is ordinary TypeScript using `compileEffect`, reusable `conditions.all/any/not`, target queries and action-time values. `contexts.damage` finds the nearest damage ancestor on every query. `ops.modifyDamage` reads percent and delta, in that order, once per operation; either missing value skips the operation. It validates context ownership before writing. The new selector shares ancestor traversal with `contexts.nearestSkillUse`; effect files do not repeat parent-chain walks.

The generator emits supported owner/opponent HP comparisons, mark-presence checks, damage type/element checks, mark-stack and HP-derived values, numeric arithmetic, clamps and lazy required-value branches. Each multiplication/division retains its own floor. Admission queries and action values remain separate. Only direct damage stages are accepted, so `checkSelf` maps to damage target ownership without broadening its other contextual meanings.

`OnDamage` stays `OnDamage`: in the current engine it runs after HP subtraction. A named reduction at that stage is not silently moved earlier. Actual damage phase and full-game comparisons establish what these definitions currently do.

Six additional parameterized definitions preserve their raw numeric values as `numberParam` declarations: three per-stack percentage modifiers, two opponent max-HP damage formulas and the conditional poison bonus. Stable names use the action field and selector step; explicit legacy aliases retain the effect ID prefix, while anonymous legacy values receive stable addresses. These candidates require `effectParameters(effect).install(battle.configSystem)` before execution in a new battle.

`values.combine(left, right, project)` reads left then right exactly once, including when left is absent. It projects only when both exist and propagates optionality through TypeScript. This preserves the legacy arithmetic read order without embedding context lookup in each effect. Separate arithmetic steps still floor separately, including positive multiplication followed by multiplication by -1.

Parameterized differential cases include zero, negative and fractional overrides, changes in BeforeEffect, another source's override and removed modifiers. Overrides go through the declared legacy alias where present. Full games save nondefault parameter values and restore with fresh native factories. The unchanged legacy definitions are parsed once before constructing battles, so their registered parameter values are inherited and anonymous keys do not change between comparisons.

Four further candidates retain automatic stack consumption or effect tags. `consumesStacks` is delegated to the existing Effect execution policy, so it consumes only mark sources and does so before action reads. Exhausting the final stack does not cancel that already-running action; subsequent dispatch skips the inactive source. `tags` are copied at declaration and preserved on the compiled effect. The emitter validates optional metadata rather than ignoring it.

Ninety-two new differential/full-game cases cover these four definitions. Consumer cases also compare stack count, activity and membership, cancellation without consumption, final-stack execution, exhaustion in BeforeEffect, suppression and repeated dispatch after removal. Source tests independently observe stack values after automatic consumption and verify tags cannot be changed by mutating the caller's array. Review found and fixed null-input handling in the classifier; null, undefined, arrays and primitives now return a rejection reason.

## Strict conversion boundary

Configured divisors, repeated legacy parameter aliases, parameters inside unmapped conditional branches, unsupported stages, unrecognized selectors, chained context targets and other unhandled shapes are rejected. Optional-valued conditional branches require a separate mapping. In particular, the legacy false-zero branch is treated as missing, so it is rejected rather than converted to the normal numeric-zero semantics of `values.choose`. Multi-member comparison is also rejected: legacy compares with `some`, while action values consume a first result. The handwritten HP candidate is explicitly protected with no generated recipe.

The generated factory returns a fresh compiled effect set; the exported default set is frozen. Fresh factories support independent host catalogs and checkpoint restoration. No legacy parser/builder or serialized expression interpreter is imported by the emitted runtime module.

## Evidence and remaining gates

Nine generator tests cover exact recognition, arithmetic order, preservation of late damage stages, unsupported-field/value rejection, both review counterexamples and deterministic regeneration.

The unchanged-YAML public runtime test contains 1,605 checks: per-ID skill/mark source comparisons against unchanged YAML, positive activation with nonzero modification, missing marks, wrong roles, late owner/active-position/value changes, cancellation, alternate damage categories, actual damage phase execution, source hashes, complete games and JSON checkpoint continuation with fresh effect factories. These compare execution hooks, modifiers, HP, damage results, message order, final game state and subsequent RNG. Separate authoring tests cover nested context lookup, per-action reselection, numeric read order, absent inputs, cross-battle rejection and condition short-circuiting.

Standards and Spec review identified and closed the two strict-recognition counterexamples above. The full migration still requires remaining mechanisms, reviewed per-ID E/C decisions, official catalog integration and host cutover. This batch does not change the production acceptance inventory.

Historical validation before the C07 additions: all 6,700 V4 tests across 41 files pass (510.28 seconds), as do 45 source authoring/binding checks, V4 and authoring typechecks, declaration generation, scoped lint, deterministic generation and source provenance. Node and real Chrome checkpoint/continuation checks also pass.

## Six C07 damage conditions

Six definitions now use the shared nearest-skill query for element, category or `multihitResult`: ice and climax damage bonuses, physical vulnerability, fire reduction, the multi-hit percentage bonus and the three-hit fixed bonus. Each correction changes only `/condition/conditions/1/target/base` from `useSkillContext` to `usingSkillContext`; source YAML and legacy parser metadata remain unchanged. `checkSelf` retains damage-target ownership rather than acquiring skill ownership semantics.

The independent reference copies and repairs that exact selector node before parsing. The original definition is also required to fail parsing. The 150-case corrected suite covers skill/mark sources, matching and nonmatching conditions, missing/nested skill ancestry, wrong ownership/skill, late changes after admission, cancellation, actual DamagePhase HP/results and real three-hit SkillPhase execution. Remaining hit counts are 3, 2, 1; the `> 1` bonus applies to the first two hits and the `== 3` bonus only to the first, while ordinal counts are 1, 2, 3. No new ordinal interpretation is introduced by this batch.

Unchanged-YAML oracle scenarios exclude corrected records, but the full ID/source-hash/tag/consumption audit covers all 82 candidates. First/last-skill predicates, unknown skill paths, dynamic missing-value behavior and other unsupported cases remain separate work.

Reproduce:

```sh
node scripts/effect-migration/damage-modifiers.mjs --check
node --test scripts/effect-migration/damage-modifiers.test.mjs
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/damage-modifiers.test.ts test/v4/corrected-damage-modifiers.test.ts
pnpm test:effect-authoring-design
```

C07 integration validation: the damage and stat-stage public suites pass all 3,759 cases together, including the 150 corrected damage cases; all 60 generator checks, typechecks, lint, declaration build and source provenance pass. Final integration reviews pass. The preceding complete regression on `1eae7424` had 19 timeouts (all passed isolated reruns) and is not reported as green; see the migration progress ledger.
