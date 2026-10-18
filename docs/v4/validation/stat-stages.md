# Native stat-stage candidates

The offline generator recognizes 58 current single-action statStageBuff definitions and records 44 rejected definitions. It emits ordinary TypeScript calls to Pet.addStatStage, preserving the existing mark creation, level merging, limits and attribute modifiers. No parser, selector builder or runtime DSL is imported by generated code. Production registration is unchanged and every record remains U.

Admission supports selfUseSkill and ordered nested every conditions containing self probability evaluators. Generated boolean expressions preserve short-circuit order, including repeated self tests. The probability value is read before drawing one battle RNG sample, even for 0 or 100 percent. Raw numeric probability values become 42 public parameters with stable effect/node/field addresses, original tags and explicit Config aliases where present. Effective values remain finite numbers without introducing a 0–100 clamp. Tagged modifiers continue to use the source scope; unnamed legacy random keys are not copied into stable addresses.

Probability is read during collection; changing it in BeforeEffect does not reconsider an admitted effect. At application time, current source ownership and opponent active position determine the target. Numeric stage values remain literals. Definitions with other triggers, conditions, selectors, nonliteral stat/value, extra fields or ambiguous shared aliases are rejected rather than partially converted.

The per-ID source hashes and node paths are in stat-stages-candidates.json. Tests compare every candidate to unchanged YAML with skill and mark sources, each declared trigger, late ownership/position changes, wrong skills, effect/add-mark cancellation, existing level merging, probability 0/100, late probability changes and unrelated parameter scopes. They compare stage marks, effective attributes, action inputs and the next RNG sample. Guaranteed-success cases assert a concrete stage mark and changed attribute, preventing matching no-ops from passing.

These tests establish the action and admission boundary only. Full skill/game sequences, fresh-catalog checkpoint continuation, production registration, and E/C acceptance remain pending. Independent Spec review is also pending its existing availability limit.

Reproduce:

```sh
node scripts/effect-migration/stat-stages.mjs
node scripts/effect-migration/stat-stages.mjs --check
node --test scripts/effect-migration/stat-stages.test.mjs
pnpm test:battle-v4 test/v4/stat-stages.test.ts --maxWorkers=2
```

Validation: all 1,277 targeted runtime cases and three generator tests passed; the complete V4 suite passed 4,962 tests across 35 files with normal two-worker settings. Code/declaration builds, V4 typecheck and lint passed. Standards review found no blockers; independent Spec review remains pending.
