# Native damage modifier candidates

> Historical baseline review (2026-10-20): later V1 provides behavior missing from the imported oracle. Claims below about C07/C08/C14/C15 require revalidation; see [the audit](historical-v1-audit.md). Earlier passing tests establish agreement with the imported/corrected reference, not with final V1.

The offline generator recognizes 103 candidates from 117 current single-action `addModified` definitions. It preserves the existing handwritten HP-tier candidate separately, and records 13 unsupported definitions with source hashes and rejection reasons. These are candidates only: all records remain U and production loading is unchanged.

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

## Damage-stage turn-order conditions (2026-10-20)

Seven additional definitions now use the existing typed first/last-skill predicates. Admission requires an exact C08 mapping of effect ID, condition path and predicate; unknown IDs, moved nodes and changed predicates are rejected. Their ledger recipes retain these mappings. The generator enables turn-order emission only for this recorded scope; other catalogs reproduce unchanged.

These predicates deliberately require a direct UseSkillContext whose parent is a TurnContext. OnBeforeCalculateDamage provides a DamageContext, so both first/last predicates return false even when its ancestor skill is first or last. Six positive-order effects consequently do not apply. The defensive `effect_ability_damage_reduction_10_percent_when_last` negates the last predicate and applies -10 percent to damage received by its owner. This preserves current behavior, including the mismatch with those effect names; changing predicates to search ancestors is a separate semantic decision. No source YAML or runtime change is included.

All 112 focused public cases pass against unchanged legacy definitions and independent modifier/admission assertions, covering Mark/Skill sources, first/last/empty turn queues, extra context nesting, wrong owner, cancellation, repeat execution and real damage phases. Seven full games and seven fresh-factory checkpoint games match the legacy event sequence, application count, final HP, winner, turn and RNG state. No-op effects explicitly require zero applications; the defensive effect requires actual applications. The source-hash/catalog check also passes: 127 distinct public cases total.

All 171 generator tests, battle types/lint, declarations and unchanged provenance pass. Evidence: `/tmp/damage-order-tests.log`, `/tmp/damage-order-games.log`, `/tmp/damage-order-generators.log` and `/tmp/damage-order-{types,lint,declarations,provenance}.log`. Production loading and overall migration admission remain pending.

## Skill identity and tag corrections (2026-10-20)

Seven definitions now repair their recorded skill-selection path after the existing C07 spelling correction: Yutu-tag damage, Quan-tag damage, Zhongji damage, and the Hongbaoshi/Lanbaoshi/Jiguang/Jueying fixed-damage marks. C09 changes only `/condition/conditions/1/target/chain/0/arg` from `skillId` to `skill`. The classifier rejects changed source nodes; recipes retain both repairs and their decision labels. Each original and spelling-only definition is independently verified to fail parsing before comparison against the explicitly corrected legacy definition. No runtime or YAML changes were made.

The two tag queries inspect the complete flattened skill tag collection, including a match in the second position. Emblem checkSelf remains damage-target ownership. Fixed-damage configuration is sampled when the admitted operation executes; zero remains zero. A skill change after admission does not rerun the condition. The four fixed-damage marks consume their source stack, so a one-stack Mark source cannot fire again after destruction; Skill sources retain their own lifecycle.

All 161 focused cases pass, including both source kinds, wrong owner/skill, nested contexts, second-tag matches, cancellation, late skill/config changes, zero configuration, repetition, and real damage phases. The initial run had four incorrect independent repeat-count assertions (the differential comparisons passed); these were corrected to account for automatic stack consumption, and the entire 161-case suite was rerun with source stack/activity also compared.

All fourteen full-game/checkpoint comparisons and the source/catalog check pass, for 176 distinct scoped public cases. Fresh effect factories are registered on checkpoint restoration. The fixed-ID game fixtures use identical skill definitions with power 300 to complete inside the existing 12-turn bound; the initial power-30 Zhongji fixtures exceeded that bound. Battle event types, application counts, HP, winner, turn and RNG match the corrected legacy reference.

All 172 generator tests, battle types/lint, declarations and unchanged provenance pass. Evidence: `/tmp/damage-selection-tests-final.log`, `/tmp/damage-selection-games-final.log`, `/tmp/damage-selection-generators.log` and `/tmp/damage-selection-{types-final,lint-final,declarations,provenance}.log`. These remain candidates pending overall migration/production admission.

## Damage stat values (2026-10-20)

Two further candidates use exact C09 repairs: `effect_skill_add_damage_spa_sixth` reads `stat.spa` instead of the nonexistent direct `spa` path; `effect_skill_fixed_damage_with_qianggong_stack_if_atk_over_500` compares `stat.atk` instead of direct `atk`. The shared numeric emitter admits these explicit Pet stat paths in damage contexts. Original parsing failures, exact repair metadata and source-drift rejection are verified.

The special-attack formula samples the current owner's stat at operation time and floors division by six. The attack threshold is checked during admission; changing attack afterward does not rerun it. The subsequent qianggong query reads the then-current owner's marks and consumes the first selected stack value, retaining the legacy behavior with duplicate matching marks. Late owner/stat/stack changes, support removal, attack 500/501 boundaries, cancellation, repetition and real damage phases are covered. Independently changing spd and spe does not change the special-attack formula.

All 50 focused cases and five source/full-game/checkpoint checks pass. A fresh factory is used for each restored candidate; full-game event types, applications, final HP, winner, turn and RNG match independently repaired legacy definitions. Three additional legacy probes pass and establish outstanding defects: missing `pet.weight` propagates NaN while zero weight remains valid; `selectAttribute$('stack')` returns a ReactiveValue which legacy addModified does not unwrap, resulting in a string delta and NaN damage. Those definitions remain rejected and are not counted as migrated. The probes currently characterize their legacy behavior; they do not define the future numeric-value policy.

Total: 58 distinct scoped public checks, 173 generator tests, battle types/lint, declarations and unchanged provenance pass. Evidence: `/tmp/damage-stat-tests.log`, `/tmp/damage-stat-games.log`, `/tmp/damage-stat-unmapped.log`, `/tmp/damage-stat-generators.log`, and `/tmp/damage-stat-{types-final,lint-final,declarations,provenance}.log`. Overall production admission remains open.

## Skill element and opponent status conditions (2026-10-20)

Three further candidates compare the current UseSkillContext element with the current owner Pet element, or require a different skill actor and a cuimian mark on the owner's currently opposing active Pet. They reuse shared skill-context, owner and opponent selectors. The two element definitions retain their exact C07 spelling repair; the opponent-actor definition needs no source repair. The generator only accepts the explicitly understood dynamic own-element equality shape.

All 80 focused cases pass against independent legacy references and explicit admission/modifier expectations. Coverage includes both Mark and Skill sources, different elements, wrong actor, absent support, nested contexts, cancellation, repetition, real damage phases and changes to owner, element, support and active opponent. Switching the opposing slot before admission queries the new occupant. Changes after BeforeEffect admission do not rerun the condition.

All six full-game/checkpoint comparisons and the source-hash/catalog check pass, bringing this batch to 87 distinct scoped public checks. The game fixtures use Normal skills to match the fixture pets; fresh factories are registered for restored candidates. Event types, application counts, final HP, winner, turn and RNG match. All 174 generator tests, battle types/lint, declarations and unchanged provenance pass. Evidence: `/tmp/damage-element-tests.log`, `/tmp/damage-element-games.log`, `/tmp/damage-element-generators.log`, and `/tmp/damage-element-{types,lint,declarations,provenance}.log`. Overall production admission remains open.

## C14: inclusive random fixed damage (2026-10-20)

`effect_skill_fixed_damage_30_70` and `effect_skill_fixed_damage_30_70_if_opponent_has_cuimian` now use `values.randomInt(30, 70)`. The original C14 rationale was based only on the older imported oracle, which rejects selectorValue and sampleBetween. That rationale is withdrawn: later V1 implements both and samples the same inclusive bounds. Historical-oracle comparison and metadata reclassification remain pending. The V2 implementation passes secondVal + 1 to an inclusive GameRng.nextInt and can produce 71. The candidate contract is the inclusive interval named by the effects and their [30,70] source values. Both exact source shapes are checked; unknown IDs and changed endpoints are rejected. Source YAML and the legacy parser remain unchanged.

The new Value validates safe integer endpoints and width at declaration, draws through battle RNG only when read, and returns a fresh number on each read. Every read consumes exactly one draw, even for a single-point interval. Persistent capture/follow rejects before drawing. No standalone RNG or stream is introduced.

All 258 focused public cases pass against an independently implemented floor(random \* 41) + 30 reference and seeded RNG expectations. They cover eight seeds, both source kinds, absent condition support, wrong owner, late owner/support changes, cancellation, repetition and real damage phases. Source rejection and exact C14 metadata are pinned. All four complete-game/fresh-factory checkpoint comparisons and the source/catalog check pass: 263 distinct public cases. Restored event types, application count, HP, winner, turn and next RNG match the independent reference.

All 83 design runtime tests pass, including both endpoints across 400 reads, declaration-time validation and persistent-plan rejection without mutation or RNG consumption. New type assertions pass; the separate design-directory typecheck still reports only its pre-existing nested-context error at runtime.test.ts:1491. Battle types/lint, declarations and unchanged provenance pass. The 175 existing generator checks and the added coverage check pass (176 total). Logs: `/tmp/damage-random-{tests,games,design,generators,coverage,types,lint,declarations,provenance}.log`; `/tmp/damage-random-design-types-final.log` records the separate baseline error. Overall production admission remains open.
