# Generated fixed mark-application candidates

The offline generator `scripts/effect-migration/mark-applications.mjs` emits 173 native effect candidates with 152 explicit mark dependencies. It recognizes only a single addMark action with a fixed BaseMark ID, self/opponent position, optional finite numeric stack/duration, and selfUseSkill admission on OnHit/OnMiss (including a single-element every wrapper). It rejects extra fields, other selectors/conditions/triggers, Config-backed/raw values and dynamic expressions. The 114 rejected single-root addMark definitions are recorded; nested action lists are outside this scan family.

Generated code consists of individual defineNativeEffect declarations and direct Pet.addMark/AddMarkContext calls. No YAML, legacy parser, DataRepository, selector builder or custom runtime type system is imported. `createGeneratedMarkApplications` requires all declared BaseMark objects with exact matching IDs before publishing the candidate collection. It captures its own resolved map, so clearing or rebinding the caller's map cannot change published dependencies. It does not manufacture missing marks or empty downstream effects. Supplying trusted immutable mark definitions remains the caller's responsibility until the complete official environment is built.

The application semantics are preserved:

- selfUseSkill is collected before BeforeEffect; skill sources require both identity and owner, while mark sources require owner only.
- Self/opponent position is resolved from current source ownership at action execution, including a switch or owner change in BeforeEffect.
- Stack/duration literals are passed to the original AddMarkContext. Both the old parser and operator treat explicit zero as omitted; the generator preserves that behavior. Omitted values use the mark's maxStacks/duration, not an invented one-stack/three-turn default.
- Cancellation, hook changes, merging and creation continue through the existing native mark phases. No new public Config slots are introduced for plain numeric literals.

[The ledger](mark-applications-candidates.json) records each effect hash/path/recipe and its dependency's full source hash/path/downstream Effect IDs. All records remain U. Handwritten shield/application overrides are protected and are never written by the generator. Current recognized records do not overlap those overrides.

The 2,770 runtime tests cover every ID with skill and mark sources across eight variants: normal, different skill, late owner, late opponent, effect cancellation, add-mark cancellation, stack/duration modification and existing-mark merging. Each declared trigger is exercised. Native results are compared to unchanged current effect YAML for mark states, action inputs, creation events and RNG. Normal cases require concrete hook values and a created mark, and cancellation cases require absence of mutations. Exact emitted-ID, dependency-ID, effect-hash and full mark-hash coverage is checked.

These are application-boundary tests. Dependency test doubles use the official mark parser to retain normalized config/tags, then replace downstream effects with an observable creation hook. That replacement exists only in tests; it does not prove the 152 marks' own effects migrated. Dependency closure, real skill/full-game sequences, checkpoint restoration and final E/C classification remain pending. No production catalog is switched.

Reproduce from repository root:

```sh
node scripts/effect-migration/mark-applications.mjs
node scripts/effect-migration/mark-applications.mjs --check
node --test scripts/effect-migration/mark-applications.test.mjs
```

The read-only check fails on any generated-source or ledger drift. Three generator tests cover exact recognition, truthiness semantics, unsupported-field/value rejection and complete reproducibility. Only dedicated generated output and its ledger are written.

Validation: the targeted runtime suite passed all 2,770 tests with the normal two-worker configuration. The complete V4 suite passed 3,685 tests across 34 files; V4 typecheck and lint passed. The three generator tests and exact regeneration check passed. Standards review found no blockers; independent Spec review remains pending its existing availability limit. This evidence does not change the U classifications or authorize production registration.
