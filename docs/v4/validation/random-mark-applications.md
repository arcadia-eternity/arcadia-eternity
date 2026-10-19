# Random mark application candidate

`effect_skill_add_mark_zhaocai_or_jinbao` is implemented as readable TypeScript in `official/random-mark-applications.ts`: a fixed definition list, a full shuffle, its first item, and the shared owner/addMark action. Its ordered dependencies are `mark_zhaocai`, then `mark_jinbao`. The factory validates exact BaseMark identities and copies membership; later mutation of the input Map cannot replace resolved definitions. The source/dependency hashes and downstream effect IDs are recorded in `random-mark-applications.json`. It remains U pending dependency acceptance and production admission.

## C10: selector value type name

The unchanged source fails schema validation because `/apply/mark/type` is `selectorValue`. The parser and schema require `selector`. The test reference copies the source and changes only that node. Production YAML and parser remain unchanged, and the original failure is asserted. This validates the chosen correction, not equivalence with the invalid original.

## Selection and RNG contract

`selectFrom(readonlyMembers)` copies fixed membership at definition time while retaining member identities. Selector.shuffled queries its upstream again on every use and applies the battle's full Fisher-Yates shuffle to a copy. Later where/select/first/all operations compose normally. Empty and singleton lists consume no RNG. A list of N members consumes N-1 draws even if only the first member is ultimately used; replacing this with one random index would change replay state for larger lists.

Shuffling requires an immediate trigger frame. Persistent capture/follow evaluation is rejected before reading the list or consuming RNG; failed installation leaves the attribute unchanged. Persistently captured random outcomes need their own explicit lifecycle and snapshot design and are not implemented by this operation.

The mark action resolves a fresh random choice at execution, once per action, before stack and duration. Cancelling the collected effect before execution consumes no draw. Cancelling mark creation after selection still consumes the draw. Repeated dispatch selects again. Source-owner changes before execution change the destination. The existing fortune-marks mutex controls replacement.

## Evidence

The 20 public random tests cover skill and mark sources, both outcomes, another skill on the same owner, execution-time ownership changes, effect/add cancellation, mutex replacement, repeated dispatch, duration overrides, real SkillPhase execution, dependency identity validation, original rejection and source hashes. Each behavioral case checks subsequent RNG against both the corrected legacy reference and an independent seeded shuffle expectation. The candidate is not registered in the production loader, and dependency effects are excluded only within the application fixture.

The 68 source authoring/binding tests pass, including fixed membership copying, dynamic membership requery, successive shuffles, post-shuffle filtering, zero/one member behavior, and persistent rejection without RNG or attribute changes. The combined public random/authoring/binding run passes 57 tests. Typechecks, lint, declarations, provenance and Node/Chrome continuation pass. Both review axes pass. The fixed-reference generator still rejects this shape by design; its 278-candidate count does not include this handwritten candidate.
