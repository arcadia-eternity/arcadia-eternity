# Generated fixed-reference mark-application candidates

The offline generator `scripts/effect-migration/mark-applications.mjs` emits 253 native effect candidates with 176 explicit mark dependencies. It recognizes only a single addMark action with a fixed BaseMark ID, self/opponent position or the current battle, optional literal, configured or supported queried stack/duration, and admission on BeforeHit/OnHit/OnMiss with a required positive selfUseSkill guard. Additional conditions use the shared skill-condition emitter: mark presence, HP comparisons, gender, use count, turn order and conditional weight probability are covered by the current catalog. It rejects extra fields, unsupported selectors/conditions/triggers, unmapped action value expressions. The 77 rejected single-root addMark definitions are recorded; nested action lists are outside this scan family.

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
