# Restore historical numeric selectors

Reference: `61c349fa7ca35c392b0e751c9238759b02aefcb3`, `packages/effectBuilder/src/selector.ts` and the corresponding parser/schema/DSL. `sampleBetween` and `avg` existed in later V1. This restores their operations and dispatch without changing production YAML or promoting any candidate.

`sampleBetween` reads its selector once, uses only the first two results, returns no results for missing/nonnumeric/reversed bounds, and otherwise calls the battle's inclusive randomInt exactly once. Equal bounds still consume a draw. A whitespace-normalized digest pins its historical method body. The historical selector constructor also admits `any` to numeric operations; restoring this is necessary for value-backed selectors, whose declared type is any. No runtime numeric-type inference is invented.

`avg` returns one result, zero for an empty collection, and preserves fractional averages. Its reactive branch uses the existing ReactiveValue system instead of historical RxJS. Empty inputs produce a zero Signal, a single input retains its identity, and multiple inputs use a serializable average projection. It intentionally does not use the existing divide projection, which floors. Snapshot recipe validation and restoration support average; a restored attribute modifier continues following the source skill's attributes.

The two random fixed-damage effect fixtures and their complete-game/checkpoint fixtures now compare with the restored legacy sampleBetween implementation instead of only an independently written formula. The tests still adapt the later selectorValue tag to the imported selector spelling. That explicitly recorded version adapter remains until the broader C07 compatibility restoration; unchanged-YAML acceptance is not claimed yet. C14 metadata reclassification and the larger historical audit remain open.

Validation: 15 focused selector tests, 258 random-damage cases, 10 existing snapshot tests, and four complete-game/checkpoint comparisons. Scoped typechecking, lint, declaration build, provenance and historical-audit reproduction are checked separately. Production registration remains unchanged.
