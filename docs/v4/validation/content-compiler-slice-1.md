# Single-rule compilation and source guarantees

This implements the first connected rule path in #223 B–E: unknown content → structural limits → schema/default normalization → unique stable node IDs → registered trigger/source guarantees → optional registered predicate → ordered registered actions → the existing Effect pipeline.

`defineTrigger` declares one actually dispatched event and separate guarantees for `skill`, `petMark` and `battleMark`. Unsupported source kinds fail compilation. Runtime classification checks the actual source owner during condition admission and again before each action. A pet-mark rule attached to a field mark therefore cannot obtain ownerPet simply by declaring itself a mark.

`definePredicate` infers parameters from TypeBox and only exposes declared contextual members; it has no mutation operations in its interface. Predicates are trusted code. Their use in `compileRule` does not add guarantees to later actions. Rule predicates run during existing effect collection, not again after BeforeEffect.

`compileRule` returns a frozen successful candidate with normalized rule data and one native Effect, or frozen diagnostics without a partial Effect. All nodes compile before effect construction. It creates no Battle and runs no gameplay callback during compilation. Each action resolves its runtime immediately before that action, so earlier actions can change what a later relational resolver returns. Static action arguments remain separate per use.

Current content supports formatVersion/id, trigger, optional when, ordered actions, priority and optional consumesStacks. Trigger/condition nodeId and action stepId must be unique in the rule. Structural admission limits are 16 levels, 2048 visited values, 65536 text characters and 64 actions; these are not the shared runtime execution budget. Unsupported fields fail validation rather than being ignored.

Diagnostics currently identify content/rule/node/field and distinguish LIMIT_EXCEEDED, DUPLICATE_ID, UNKNOWN_CAPABILITY and CAPABILITY_MISMATCH. Other invalid parameter/schema cases use INVALID_PARAMETERS. Full type/range/reference/lifetime diagnostics remain pending.

Evidence (`content-compiler.test.ts`):

- A real skill compiles and executes default 10-HP plus configured 20-HP healing with a collect-time low-HP predicate. Returned defaults are normalized, caller edits do not change the candidate, and high HP prevents execution.
- A field mark cannot compile an ownerPet predicate, and incorrectly attaching a pet-mark effect to a real field mark does not execute it.
- Duplicate IDs, unknown capabilities, invalid/unknown parameters and structural oversize reject the candidate.
- A noncommutative scenario proves ordering and per-action resolution: action one heals A and redirects a selector to B; action two reads and heals B. A BeforeEffect hook changes the predicate input after collection, but the condition runs only once. Exact observed order is resolve A → when → BeforeEffect → resolve A → first action → resolve B → second action.

Review: both independent axes found no blocking implementation defects. Both requested stronger sequence/timing evidence, now included. The duplicated finite-needs validator was consolidated.

Remaining full-migration gates include roll/RNG admission policy, shared execution budgets, captures/value presets, dynamic/shared Config parameters, template expansion/copying, mark parameter transmission, pack-wide compilation/manifests, richer diagnostics, handwritten production conversions and the per-ID oracle/generation/switch acceptance. This candidate compiler is not exposed as a completed production UGC import path.
