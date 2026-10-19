# Native damage modifier candidates

The offline generator recognizes 66 new candidates from 117 current single-action `addModified` definitions. It preserves the existing handwritten HP-tier candidate separately, and records 50 unsupported definitions with source hashes and rejection reasons. These are candidates only: all records remain U and production loading is unchanged.

## Authoring target

Generated code is ordinary TypeScript using `compileEffect`, reusable `conditions.all/any/not`, target queries and action-time values. `contexts.damage` finds the nearest damage ancestor on every query. `ops.modifyDamage` reads percent and delta, in that order, once per operation; either missing value skips the operation. It validates context ownership before writing. The new selector shares ancestor traversal with `contexts.nearestSkillUse`; effect files do not repeat parent-chain walks.

The generator emits supported owner/opponent HP comparisons, mark-presence checks, damage type/element checks, mark-stack and HP-derived values, numeric arithmetic, clamps and lazy required-value branches. Each multiplication/division retains its own floor. Admission queries and action values remain separate. Only direct damage stages are accepted, so `checkSelf` maps to damage target ownership without broadening its other contextual meanings.

`OnDamage` stays `OnDamage`: in the current engine it runs after HP subtraction. A named reduction at that stage is not silently moved earlier. Actual damage phase and full-game comparisons establish what these definitions currently do.

## Strict conversion boundary

Raw/configured parameters, unsupported stages, selector spellings, chained context targets and other unhandled shapes are rejected. Optional-valued conditional branches require a separate mapping. In particular, the legacy false-zero branch is treated as missing, so it is rejected rather than converted to the normal numeric-zero semantics of `values.choose`. Multi-member comparison is also rejected: legacy compares with `some`, while action values consume a first result. The handwritten HP candidate is explicitly protected with no generated recipe.

The generated factory returns a fresh compiled effect set; the exported default set is frozen. Fresh factories support independent host catalogs and checkpoint restoration. No legacy parser/builder or serialized expression interpreter is imported by the emitted runtime module.

## Evidence and remaining gates

Five generator tests cover exact recognition, arithmetic order, preservation of late damage stages, unsupported-field/value rejection, both review counterexamples and deterministic regeneration.

The public runtime test contains 1,321 checks: per-ID skill/mark source comparisons against unchanged YAML, positive activation with nonzero modification, missing marks, wrong roles, late owner/active-position/value changes, cancellation, alternate damage categories, actual damage phase execution, source hashes, complete games and JSON checkpoint continuation with fresh effect factories. These compare execution hooks, modifiers, HP, damage results, message order, final game state and subsequent RNG. Separate authoring tests cover nested context lookup, per-action reselection, numeric read order, absent inputs, cross-battle rejection and condition short-circuiting.

Standards and Spec review identified and closed the two strict-recognition counterexamples above. The full migration still requires remaining mechanisms, reviewed per-ID E/C decisions, official catalog integration and host cutover. This batch does not change the production acceptance inventory.

Final validation: all 6,414 V4 tests across 41 files pass (531.30 seconds), as do 40 source authoring/binding checks, V4 and authoring typechecks, declaration generation, scoped lint, deterministic generation and source provenance. Node and real Chrome checkpoint/continuation checks also pass.

Reproduce:

```sh
node scripts/effect-migration/damage-modifiers.mjs --check
node --test scripts/effect-migration/damage-modifiers.test.mjs
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/damage-modifiers.test.ts
pnpm test:effect-authoring-design
```
