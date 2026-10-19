# Generated fixed-reference mark-application candidates

The offline generator `scripts/effect-migration/mark-applications.mjs` emits 282 native effect candidates with 188 explicit mark dependencies. It recognizes only a single addMark action with a fixed BaseMark ID, self/opponent position, the incoming switch pet or the current battle, optional literal, configured or supported queried stack/duration, and admission on the explicitly supported skill, damage, entry and lifecycle stages described below. Additional conditions use the shared skill-condition emitter: mark presence, HP comparisons, gender, use count, turn order and conditional weight probability are covered by the current catalog. It rejects extra fields, unsupported selectors/conditions/triggers, unmapped action value expressions. The three shapes rejected by this fixed-reference generator are recorded; two now have separate [lucky-mark](random-mark-applications.md) and [curse-status](curse-mark-application.md) candidates. Nested action lists are outside this scan family.

Generated code consists of typed `compileEffect(defineEffect(...))` declarations using shared `conditions.selfUsesSkill`, `targets.ownerPet` / `targets.opponentActive` and `ops.addMark`. Context traversal and mark application are implemented once in the authoring runtime. No YAML, legacy parser, DataRepository, selector builder or custom runtime type system is imported. `createGeneratedMarkApplications` requires all declared BaseMark objects with exact matching IDs before publishing the candidate collection. It captures its own resolved map, so clearing or rebinding the caller's map cannot change published dependencies. It does not manufacture missing marks or empty downstream effects. Supplying trusted immutable mark definitions remains the caller's responsibility until the complete official environment is built.

The application semantics are preserved:

- selfUseSkill is collected before BeforeEffect; skill sources require both identity and owner, while mark sources require owner only.
- Self/opponent position is resolved from current source ownership at action execution, including a switch or owner change in BeforeEffect.
- Stack/duration literals are passed to the original AddMarkContext. Both the old parser and operator treat explicit zero as omitted; the generator preserves that behavior. Omitted values use the mark's maxStacks/duration, not an invented one-stack/three-turn default.
- Cancellation, hook changes, merging and creation continue through the existing native mark phases. No new public Config slots are introduced for plain numeric literals.

[The ledger](mark-applications-candidates.json) records each effect hash/path/recipe and its dependency's full source hash/path/downstream Effect IDs. All records remain U. Handwritten shield/application overrides are protected and are never written by the generator. The recognized `effect_skill_add_mark_shuiwenpingzhang` record retains its handwritten implementation and is excluded from generated candidates.

The initial 2,770 runtime tests cover all 173 unconditional IDs with skill and mark sources across eight variants: normal, different skill, late owner, late opponent, effect cancellation, add-mark cancellation, stack/duration modification and existing-mark merging. Each declared trigger is exercised. Native results are compared to unchanged current effect YAML for mark states, action inputs, creation events and RNG. Normal cases require concrete hook values and a created mark, and cancellation cases require absence of mutations. Exact emitted-ID, dependency-ID, effect-hash and full mark-hash coverage is checked.

These are application-boundary tests. Dependency test doubles use the official mark parser to retain normalized config/tags, then replace downstream effects with an observable creation hook. That replacement exists only in tests; it does not prove the 152 marks' own effects migrated. Dependency closure, real skill/full-game sequences, checkpoint restoration and final E/C classification remain pending. No production catalog is switched.

Reproduce from repository root:

```sh
node scripts/effect-migration/mark-applications.mjs
node scripts/effect-migration/mark-applications.mjs --check
node --test scripts/effect-migration/mark-applications.test.mjs
```

The read-only check fails on any generated-source or ledger drift. The initial three generator tests cover exact recognition, truthiness semantics, unsupported-field/value rejection and complete reproducibility. Only dedicated generated output and its ledger are written.

Initial batch validation: the targeted runtime suite passed all 2,770 tests with the normal two-worker configuration. The complete V4 suite passed 3,685 tests across 34 files; V4 typecheck and lint passed. The three generator tests and exact regeneration check passed. Standards review found no blockers; independent Spec review remains pending its existing availability limit. This evidence does not change the U classifications or authorize production registration.

## Shared authoring API integration

The 173 candidates now use the same authoring API as the handwritten examples and power effects; candidate IDs, recipes and all 152 dependency identities are unchanged. `ops.addMark` accepts a trusted BaseMark or an immediate optional BaseMark value and applies to Pet or the current Battle. It snapshots its options object when declared, validates all selected targets before reads, reads mark → stack → duration once per invocation, then checks each target again immediately before writing through AddMarkContext and the existing domain phases.

A missing mark skips the operation before either numeric input is read. Missing stack/duration values use mark defaults. The authored API preserves explicit numeric zero; the migration generator separately retains the legacy parser's literal-zero-as-omitted recipe. These two contracts are intentionally distinct. Numeric callbacks and preceding mark-creation hooks cannot bypass battle ownership checks. Later actions query their owner, opposing slot and numeric sources again.

Five new source tests cover ordered reads shared across targets, declaration option snapshots, missing values, zero, global mark application, foreign targets, ownership changes during numeric reads, a creation hook moving the source before the next action, and a creation hook invalidating a later target in the same operation. The last case preserves the first completed write and rejects the later foreign target. Compile-only negative cases reject instances in place of definitions, skill contexts in place of owners, and persistent plans in place of instant numeric options. All 60 source authoring/binding tests and all 2,770 public differential cases pass; typechecks, scoped lint and exact generator reproduction pass. Both independent review axes pass. The rebuilt full V4 suite passes all 9,780 tests across 43 files; declaration/provenance checks and Node/Chrome checkpoint continuation also pass. The downstream effects/full-game/production gates above remain open.

## Conditional mark applications

Seventeen additional definitions now share the same action implementation. Conditions run in source order at effect collection; mutation in BeforeEffect does not re-evaluate admission. Target selectors still query at action time. Each added definition is exercised for both skill and mark sources with positive admission, failed admission, post-admission condition changes, late owner/opponent changes, cancellation, merging and creation overrides. The reference continues to parse unchanged YAML.

Four first/last-skill definitions record C08 in their recipe: `effect_skill_add_mark_shanbi_if_first`, `effect_skill_add_mark_opponent_shiming_if_first`, `effect_skill_add_mark_opponent_liuxie_40_if_last`, and `effect_skill_add_mark_opponent_mingzhongxiajiang_15_if_opponent_has_kaowen_and_last`. Their comparison uses the already-corrected TurnContext lists; this is not a claim of equivalence to the pre-C08 engine.

The heavier-opponent probability case tests both 40% and 10% branches, success and failure, absent raw weight fields, deliberately conflicting stat weights, changes after admission and subsequent RNG. A missing raw weight chooses the low-probability branch; it does not fall back to the stat field. Seeds 1, 2, 6 and 11 distinguish the two thresholds and show that the low branch can also succeed.

The generator requires a positive self-use guard on a mandatory AND path. An OR branch or negation containing selfUseSkill cannot satisfy that requirement. Five generator checks cover this boundary, stable output, and imports required by shared-emitter context expressions outside the current catalog. A missing dependency is recorded as rejected rather than silently replaced: `effect_skill_add_mark_opponent_liuxue_60_if_chongqunlingyu` refers to nonexistent `mark_liuxue`. Its correction and acceptance remain outstanding.

The rebuilt full V4 suite passes 10,125 tests across 43 files, including all 3,115 mark-application checks and the four probability seeds. V4 types, lint, five generator checks, declaration build, provenance and Node/Chrome continuation pass. Both review axes pass after completing generated context imports. The 190 candidates remain U; downstream dependency closure, full games, checkpoint restoration and production admission are still required.

## Dynamic and parameterized mark options

Nineteen further candidates use action-time numeric queries or tagged number parameters: eleven parameterized stacks and eight dynamic stack/duration expressions. The previously rejected twenty option definitions are now understood; the twentieth is the protected handwritten water-shield effect. The generator preserves all recognized metadata and continues to reject unrelated action config/extra fields.

Dynamic options consume the first selected value, once per action, in mark → stack → duration order. Empty selections and absent raw weight use the destination mark's defaults. Queried/configured zero reaches AddMarkContext; only a literal zero is omitted under the historical parser rule. Multiply/divide retain flooring. The API accepts an optional numeric property without forcing authors to invent a fallback value. Persistent bindings remain inadmissible as immediate options.

The eleven parameters retain their default and tags under stable `parameters.stack` addresses. Supported named legacy aliases are emitted from configId; the protected water-shield's `multiply_value` is recorded without replacing its handwritten implementation. Repeated aliases are rejected until a shared declaration is explicitly mapped.

The new scenarios cover execution-time changes, missing inputs before versus after admission, duplicate memberships with first-only consumption, per-source overrides, zero, removed/foreign overrides and tag targeting. They also separate actual skill target from current opposing active position: B/lead retains seven layers, B/bench receives eleven, the two opponentMarks options read 22/13 from B/bench, and the action still writes to B/lead. Self-sourced options remain unchanged by that target change. Normal, cancellation, merging and owner/position changes continue to compare against unmodified YAML.

Legacy reference effects are parsed before battle construction so registered literal defaults are installed in each reference battle. The fixture initializes the actual target as the real pre-hit phase does. This avoids counting a missing-target exception or unregistered configuration as an accepted comparison.

The focused option suite passes 418 checks. V4/authoring typechecks, lint and seven generator checks pass; both review axes pass after option-only context imports and distinct-target fixtures were corrected. The rebuilt full V4 suite passes 10,848 tests across 43 files, including all 3,838 mark-application checks. The 60 source authoring/binding checks, declaration build, provenance and Node/Chrome continuation also pass; downstream dependency behavior, full games and official admission remain outstanding.

## Parameterized probability admission

Twenty-eight further definitions declare probability parameters through the shared condition emitter, including two BeforeHit sleep applications. Parameters are declared in legacy parser order: conditions, duration, then stack. Runtime option consumption remains stack then duration. Conditions retain ordered short-circuit evaluation and consume RNG only for reached probability predicates. BeforeEffect changes do not re-evaluate the admitted condition.

Differential scenarios cover threshold-adjacent success/failure, zero/full probability, source-scoped and foreign modifiers, removed modifiers, tagged updates and named legacy aliases through ParameterCatalog.modify. Aliases resolve at the parameter API boundary; direct ConfigSystem writes still require canonical addresses. The two-branch suffocation definition separately exercises opposite values for its 10% and 40% parameters with and without its supporting mark, and checks the next RNG draw. Tests use the unchanged YAML oracle.

The ledger now contains 237 generated candidates, one protected handwritten override and 49 rejected definitions. The added candidates remain U pending downstream dependencies and final acceptance. The 506 focused probability checks, eight generator checks, exact regeneration, V4 typecheck and lint pass. Both review axes pass. The complete V4 regression snapshot passes 11,803 tests across 43 files, including 4,793 mark-application checks.

## Element exclusion, consecutive use and field targets

Seven more candidates use first-item element comparisons, including the default consecutive-use frostbite rule. Equality and inequality preserve the old empty-selection result. Consecutive use defaults to at least two uses; Once compares exactly and Continuous compares at least. Both require the direct skill-use context and source owner, then read the skill owner's count. Explicit zero, null, dynamic counts and unknown strategies remain rejected until mapped separately.

Seven fixed-reference field applications reuse contexts.battle and ops.addMark. Public comparison fixtures observe the battle's marks as well as pet marks, including creation input, cancellation, merging and hook overrides. Dedicated scenarios preinstall a different weather and check both its replacement and its preservation when the incoming addition is cancelled. No downstream weather/field behavior is replaced by the application fixture.

The ledger now contains 251 generated candidates, one protected override and 35 rejected definitions. All 358 focused public checks for these fourteen additions pass, including different-weather replacement and cancellation. Eleven generator checks and 27 checks for the other shared-emitter consumers pass. V4 typecheck/lint, declaration build, provenance and Node/Chrome checkpoint checks pass. The previously started full V4 run passed 11,803 tests across 43 files for the 237-candidate snapshot; the subsequent 358 targeted checks cover the fourteen additions. These are separate runs, not a full 251-candidate suite result. Both review axes pass, including the final weather replacement fixture review.

## Shared collection expansion and effect tags

Selector.flatMap expands current membership in order on each use. Following where/select/first/all/apply operations retain the same query contract; snapshots returned by all do not change when membership changes. Type tests infer element types through readonly arrays and reject scalar expansion. The field-condition emitter reuses this API for battle → marks → flat → filters, with no independent runtime interpreter.

Two further candidates cover the night-field condition and tagged consecutive stack growth. Effect tags are validated, copied and passed to defineEffect. The consecutive-use condition is checked at collection, while its stack reads the current counter at execution; changing two uses to one after admission writes explicit zero, and changing it to four writes the capped twenty. Current YAML remains the oracle.

The catalog contains 253 candidates, one protected override and 33 rejected definitions. Forty focused public checks pass. The authoring/value-binding source suite passes 61 tests, including the new collection membership test. The 37 public authoring/binding/checkpoint checks and 40 generator checks pass, as do V4/authoring types, lint, declarations and provenance. Both review axes pass. These scoped checks do not constitute a full 253-candidate regression run.

## Battle-start and switch-in applications

Eight additional candidates cover five OnSwitchIn and three OnBattleStart definitions. Skill stages still require a positive selfUseSkill guard. Entry recognition accepts only the mapped stage/condition combinations: direct selfSwitchIn for OnSwitchIn, or petIsActive / no condition for OnBattleStart. This does not generalize skill admission to every trigger.

Shared ownerSwitchesIn compares the source pet with the direct SwitchPetContext incoming pet. It does not search nested ancestry or require that pet to be active yet. Shared ownerIsActive queries the source pet's actual current position. Source tests distinguish these cases and reject nested switch contexts for the entry predicate.

The separate entry harness preserves the full dependency configuration and compares untouched YAML with candidates for skill and mark sources. It checks wrong/inactive owners, owner/active-position mutation after admission, effect/add cancellation, hook overrides, merging, and RNG. Five entry definitions also run through the real SwitchPetPhase. Downstream applied-mark effects remain fixture dependencies, not accepted migrations.

The catalog now has 261 candidates, one protected override and 25 rejected definitions. The expanded run passes 663 public checks (155 entry cases, existing skill normal paths, dependency and source-hash checks). The 62 source authoring/binding tests, 14 generator checks and 27 other shared-generator checks pass, alongside types, lint and declarations. Both review axes pass. Creation override assertions preserve the domain normalization that persistent marks retain duration -1 even when the incoming context requests seven turns.

## Duration-end and destruction applications

Three additional fixed-reference candidates run at OnMarkDurationEnd or OnMarkDestroy with the original unconditional admission. Recognition remains limited to one lifecycle stage per definition. The existing handwritten destruction damage-increase override is now explicitly recognized as protected; it is not regenerated.

The lifecycle fixture uses actual MarkUpdatePhase and RemoveMarkPhase. It observes source activity/ownership during creation and after removal, inactive and suppressed sources, indestructible marks, permanent/not-yet-expired marks, repeat removal, another source with the same effect, cancellation, existing mark merging and owner changes before execution. Persistent and nonstackable dependency configuration remains intact; downstream dependency effects are replaced only for application-boundary observation.

The catalog contains 264 generated candidates, two protected overrides and 21 rejected definitions. All 192 lifecycle/entry public checks and both full-catalog dependency/source-hash checks pass. Fifteen generator checks, V4 typecheck/lint, declaration build and source provenance pass. Both review axes pass. No full 264-candidate regression or downstream dependency acceptance is claimed by this slice.

## Damage-stage applications

Three additional fixed-reference candidates cover one OnDamage physical-hit application and two PostDamage applications, all with a mandatory positive selfBeDamaged guard. Stage selection controls condition and option semantics: checkSelf resolves to damaged-target ownership at damage stages, including nested predicates and conditional option values. Probability uses the shared emitter in both skill and damage domains. Mixed stage families and guards hidden behind OR remain rejected.

The fixture executes the real DamagePhase against unchanged YAML for skill and mark sources. It checks HP subtraction before admission, PostDamage dispatch only for Pet damage sources, physical/special damage filtering, threshold-adjacent 50% success/failure and next RNG draw, effect/add cancellation, owner/opponent changes before execution, and damage-type changes after admission. The last case preserves collection-time admission rather than testing the condition again during execution. Applied-mark downstream effects remain explicit unaccepted dependencies.

The catalog contains 267 generated candidates, two protected overrides and 18 rejected definitions. The 123 focused public checks pass (55 damage-stage checks, 66 existing probability checks, and two catalog checks), along with 44 generator checks covering all shared-emitter consumers. V4 typecheck/lint, declaration build and source provenance pass. Both review axes pass after correcting damage-stage checkSelf emission. These are scoped results; the latest full regression remains the earlier 237-candidate snapshot.

## Target-side evasion and stage-specific ownership

The Yingfeng night-field evasion application adds one candidate using the shared ownerIsSkillTarget predicate. It compares the source Pet with the direct UseSkillContext actualTarget; nested ancestors do not qualify. Missing Pet ownership and a missing target cannot qualify through undefined equality. Admission observes the target and field at collection, while the addMark action queries the current source owner at execution. Changing the active position alone does not reassign that source's owner.

The generator also gives switch-in stages their own condition domain. In particular, checkSelf inside a conditional stack/duration value resolves to the incoming pet of the direct switch context. Skill and damage stages retain their distinct ownership subjects. This repairs an uncovered recognition boundary; no existing entry candidate changes its generated source.

The catalog now has 268 generated candidates, two protected overrides, 181 mark dependencies and 17 rejected definitions. The 236 focused public checks cover target-side evasion (24), entry (155), damage (55) and catalog provenance/dependencies (2). Evasion includes real SkillPhase miss dispatch, wrong targets, missing/removed night field, owner/active/target changes after admission, cancellation, existing-mark merging, duration overrides and subsequent RNG. The 64 source authoring/binding tests, 37 public authoring/binding checks and 46 generator tests pass, alongside V4/authoring types, lint, declarations, provenance and Node/Chrome continuation. Downstream healing is still a dependency, not accepted by this application fixture. Both review axes pass after the missing-owner guard was added. No full 268-candidate regression is claimed.

## Explicit skill-context corrections

Seven more candidates use the existing C07 selector-spelling correction. Five compare the current skill category (Physical, Special or Climax); two additionally require C09 to select the SkillInstance before reading its tags or base ID. The exact named C09 nodes are recorded in [the correction ledger](skill-path-correction.md). The offline helpers are shared with skill-power generation; existing power artifacts remain byte-for-byte reproducible. Source YAML and the production parser are unchanged.

Each new record retains original source hashes, selectorRepairs, optional pathRepairs and additionalDecisions. Tests assert the original parse failure; the two C09 definitions must still fail at skillId after C07 alone. A separately written test reference changes only the reviewed source nodes, then executes the old parser/operators. These comparisons validate the selected corrections, not equivalence with the invalid originals. Records remain U pending dependency closure and final admission.

The corrected fixture covers every declared OnHit/OnMiss trigger with skill and mark sources, positive category/tag/base-ID activation, wrong conditions/owners, another skill on the same owner, condition changes after collection, execution-time owner/opponent changes, effect/add cancellation and existing-mark merging. Eighteen cases execute the real SkillPhase and check actual mark creation and subsequent RNG against the corrected reference. The seven original failures and correction metadata are checked independently of action execution.

The catalog contains 275 candidates, two protected overrides, 186 dependencies and 10 rejected definitions. All 208 focused checks pass (206 corrected cases plus two full-catalog provenance/dependency checks). Another 117 targeted skill-power checks and all 48 shared-generator tests pass. V4 typecheck/lint, declarations and source provenance pass. Both review axes pass. This is scoped verification; no full 275-candidate regression, downstream dependency acceptance or production cutover is claimed.

## Skill-owned damage-result thresholds

Two additional OnDamage candidates compare damageContext.damageResult with a declared threshold parameter (default 100) under a mandatory selfUseSkill guard. The shared number emitter selects the nearest DamageContext and reads damageResult; it does not substitute base damage or actual HP loss. Parameter declarations retain condition-first ordering and source-scoped reads. No new runtime context accessor is needed.

The actual DamagePhase fixture distinguishes 99/100/101 and zero damage, a 101-point hit reduced to 51 by a shield, and 200 points of damage against 10 remaining HP. Admission occurs after HP subtraction. Skill/mark source cases cover another skill on the same owner, wrong ownership, absent/nested skill ancestry, absent damage context, cancelled damage, and effect/add cancellation. Changes to damageResult or threshold after admission do not revoke the collected effect; owner and opponent position changes still affect action targets. Scoped, foreign and removed threshold modifiers retain their respective behavior.

The catalog now contains 277 generated candidates, two protected overrides, 188 dependencies and eight rejected definitions. The 146 focused public checks pass (89 new threshold cases, 55 prior damage-stage cases and two catalog checks), alongside all 49 shared-generator checks, V4 types/lint, declarations and provenance. Both review axes pass. Downstream follow-up marks remain dependencies; no full 277-candidate regression or production admission is claimed.

## Computed multi-hit admission

The three-hit poison application adds one BeforeMultiHit candidate with the recorded C07 selector-spelling repair. Its shared numeric query reads the current UseSkillContext.multihitResult, not the configured multihit input. BeforeMultiHit admission requires a mandatory selfUseSkill guard and cannot be mixed with unrelated stage families. Unknown fields such as currentHitCount remain rejected.

The corrected-reference fixture now covers eight definitions. For this new case it distinguishes computed results 0, 2, 3 and 4 from the configured count, retains admission when the result changes during BeforeEffect, and re-queries action targets. Real SkillPhase cases prove that the engine computes the result before admission and dispatches the effect before hit handling: three computed hits apply the mark even when the later hit check misses; two and four do not. Skill and mark sources, alternate skill identity, cancellation and existing marks remain covered by the shared fixture.

The ledger contains 278 candidates, two protected overrides, 188 dependencies and seven rejected definitions. All 245 focused checks pass (243 corrected-reference checks plus two full-catalog checks), as do all 50 shared-generator checks, V4 types/lint, declarations and source provenance. Both review axes pass. These results do not constitute a full 278-candidate regression or downstream poison acceptance.

## Switch-target applications (C11)

Three candidates preserve their original OnSwitchOut stage: two use selfSwitchOut and one uses selfSwitchIn. C11 replaces only the nonexistent switchInPetId target path with switchInPet in the three named definitions recorded in the ledger. The original parse failures are asserted; independent reference copies change that single node. Stage and ownership guards remain unchanged. These are correction comparisons, not equivalence claims for the invalid original definitions.

The shared contexts.switchPet selector finds the nearest switch context and re-queries its incoming Pet at action execution. The ownerSwitchesOut predicate requires the direct event and a present outgoing owner. Collection-time guards are not rechecked after BeforeEffect. Real SwitchPetPhase tests prove the mark is applied before the active Pet changes, including the incoming-owner effect collected from the team.

All 70 focused cases pass, covering both skill and mark sources, wrong ownership, changes to source owner/incoming target/outgoing Pet/active position after admission, cancellation, option changes, existing marks and real switch execution. The combined switch/entry/catalog checks pass 227 tests. All 69 source authoring tests and 51 shared-generator tests pass, with V4 and authoring typechecks, lint, declarations, source provenance and Node/Chrome continuation. Both review axes pass. The ledger now contains 281 fixed candidates, two protected overrides, 188 dependencies and four rejects; the separate random candidate remains outside this generator. Downstream dependency closure and production admission remain pending. No new full-suite result is claimed.

## Missing bleeding reference (C12)

`effect_skill_add_mark_opponent_liuxue_60_if_chongqunlingyu` uses a nonexistent `mark_liuxue` reference. Its source comment specifies 60 bleeding stacks, skill_xueji uses the effect, and the existing bleeding definition and other applications consistently use `mark_liuxie`. C12 changes only this named effect's `/apply/mark/value` node to that canonical ID. It retains OnHit, the source-owned insect-field guard, opponent target and stack 60. Unknown IDs are not aliased, and a changed source node is rejected. Production YAML and parser are unchanged.

The source hash still identifies the original definition; markReferenceRepairs and C12 describe the deliberate correction. An independent legacy reference copies only this one node. The original reference is tested to fail at action-time dependency resolution. Shared application cases cover both skill and mark sources, ownership/target changes before execution, cancellation, merging and modified options. Condition tests distinguish a missing insect field from its removal after collection. Real SkillPhase cases prove the corrected action produces 60 bleeding stacks on the opponent. These comparisons validate a correction, not equivalence with the invalid original.

The catalog now contains 282 fixed candidates, two protected overrides, 188 dependencies and three fixed-generator rejects. Two rejects already have separate random candidates. All 350 scoped application/condition/catalog checks and 52 shared-generator checks pass. Both review axes pass, together with V4 typecheck/lint, declaration build and source provenance. Dependency closure and production admission remain pending; no new full-suite result is claimed.
