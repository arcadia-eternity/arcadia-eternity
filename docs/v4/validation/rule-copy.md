# Copying a UGC rule

`copyRule(input, newId, registry, options)` implements the single-effect copy boundary from #223 F. It validates unknown source data through the existing compiler, requires a distinct destination Effect ID, and compiles the copy against the same trusted capabilities and source binding. No new expression language or type checker is involved.

The Effect ID is the namespace of all public parameter addresses. Local node IDs and parameter keys remain stable, so multiple actions/conditions/probability expressions that shared a parameter still share one slot in the copy. The returned `parameterRemap` lists old/new addresses for authoring tools. It is descriptive: no runtime Config values, modifiers, active effect state, or snapshot identities are migrated. A copy starts from the saved content's base values.

The clone scope is one rule. Registered action/predicate/trigger IDs, add-mark content IDs, sourceMarkId, instanceParameter references, and ordinary string literals retain their meaning. The implementation does not search and replace matching strings. A copied mark rule still belongs to the same external mark; creating a different mark or copying a whole graph requires an explicitly wider operation.

The result contains normalized frozen rule data and the independently compiled effect/parameter catalog. Save its `rule` as ordinary content and recompile normally. To publish inside a content pack, add the new rule and, for mark rules, its ID to the owning mark's effect list, then compile the complete candidate. The pack compiler detects collisions with other destination definitions. `copyRule` itself has no global directory and only rejects reuse of the source ID; it does not reserve a destination ID in unrelated packs.

Ten regression tests cover simultaneous execution of original and copy with independently modified Config values; shared fan-out; nested conditions and probability references; save/recompile; external add-mark and instance-reader behavior; ordinary string preservation; invalid source/new IDs; and publication through a new pack with duplicate destination rejection. Real effect execution distinguishes separate admission identities as well as parameter isolation.

Standards review found no blocking issue. Independent Spec review remains pending reviewer availability. This implements single-rule copying, not complete preset expansion, multi-definition graph cloning, editor integration, or all U03 acceptance scenarios.
