# Native damage modifier candidates

The offline generator recognizes 76 candidates from 117 current single-action `addModified` definitions. It preserves the existing handwritten HP-tier candidate separately, and records 40 unsupported definitions with source hashes and rejection reasons. These are candidates only: all records remain U and production loading is unchanged.

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

Configured divisors, repeated legacy parameter aliases, parameters inside unmapped conditional branches, unsupported stages, selector spellings, chained context targets and other unhandled shapes are rejected. Optional-valued conditional branches require a separate mapping. In particular, the legacy false-zero branch is treated as missing, so it is rejected rather than converted to the normal numeric-zero semantics of `values.choose`. Multi-member comparison is also rejected: legacy compares with `some`, while action values consume a first result. The handwritten HP candidate is explicitly protected with no generated recipe.

The generated factory returns a fresh compiled effect set; the exported default set is frozen. Fresh factories support independent host catalogs and checkpoint restoration. No legacy parser/builder or serialized expression interpreter is imported by the emitted runtime module.

## Evidence and remaining gates

Eight generator tests cover exact recognition, arithmetic order, preservation of late damage stages, unsupported-field/value rejection, both review counterexamples and deterministic regeneration.

The public runtime test contains 1,605 checks: per-ID skill/mark source comparisons against unchanged YAML, positive activation with nonzero modification, missing marks, wrong roles, late owner/active-position/value changes, cancellation, alternate damage categories, actual damage phase execution, source hashes, complete games and JSON checkpoint continuation with fresh effect factories. These compare execution hooks, modifiers, HP, damage results, message order, final game state and subsequent RNG. Separate authoring tests cover nested context lookup, per-action reselection, numeric read order, absent inputs, cross-battle rejection and condition short-circuiting.

Standards and Spec review identified and closed the two strict-recognition counterexamples above. The full migration still requires remaining mechanisms, reviewed per-ID E/C decisions, official catalog integration and host cutover. This batch does not change the production acceptance inventory.

Final validation: all 6,700 V4 tests across 41 files pass (510.28 seconds), as do 45 source authoring/binding checks, V4 and authoring typechecks, declaration generation, scoped lint, deterministic generation and source provenance. Node and real Chrome checkpoint/continuation checks also pass.

Remaining-context audit: several rejected definitions use `useSkillContext`, while the legacy BaseSelector and exact-name parser expose `usingSkillContext`. Separately, legacy first/last-skill predicates require a direct UseSkillContext parent, although some current definitions use them at damage stages. The next batch must characterize these parser failures and contextual mismatches before introducing ancestor lookup or naming corrections; neither is covered by these conversions. A direct runtime probe on the current built artifact confirmed first/last are both true with a direct skill parent and both false with a damage parent; parsing the current ice-damage ability fails schema validation on `useSkillContext`.

Reproduce:

```sh
node scripts/effect-migration/damage-modifiers.mjs --check
node --test scripts/effect-migration/damage-modifiers.test.mjs
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/damage-modifiers.test.ts
pnpm test:effect-authoring-design
```
