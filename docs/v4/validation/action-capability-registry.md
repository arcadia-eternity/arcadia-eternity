# Registered action foundation

This is the action-definition part of #223 B/D, not the completed ContentCompiler.

`defineAction` keeps the TypeBox parameter schema, finite contextual needs and trusted implementation together. TypeScript infers parameters from that schema and exposes only declared contextual members (`ownerPet`, `skillTarget`, `pendingDamage`) to the callback. Common healing and max-HP operations are available without exposing the whole EffectContext.

`CapabilityRegistry` accepts definitions created by this factory, rejects duplicate IDs, and exposes frozen schema/needs descriptors for authoring. The factory snapshots schemas, needs and callback references. A copied or forged definition cannot replace its descriptor while retaining a different compilation closure.

Each `compileAction` call receives unknown content parameters and the contextual guarantees of its future dispatch. It rejects missing guarantees and invalid content, applies defaults, and returns an immutable action with separate normalized arguments. These are static content parameters; public Config readers and stable use/parameter addresses will be connected by the ContentCompiler. The registry does not infer source guarantees itself.

At execution, all declared needs are checked before invoking the trusted callback; undeclared runtime capabilities are omitted. Healing delegates to the existing HealContext/Pet.heal path, preserving healing phases and hooks. This API is a trusted runtime seam, not a sandbox for arbitrary uploaded JavaScript.

Evidence in `capabilities.test.ts`:

- One registered max-HP healing action compiles into separate 10% default and 25% uses, then runs through a real native Effect and healing phases. Mutating the original content input does not alter either compiled use.
- Missing contextual guarantees, unknown IDs, duplicate definitions, out-of-range parameters and unknown fields are rejected.
- Schema, needs and callback mutations after definition do not change metadata or execution. Missing runtime capabilities fail before callback invocation.
- TypeScript positive/negative checks cover inferred numeric parameters and rejection of undeclared context/parameter fields.

Still pending: registered triggers/predicates/value presets, structured diagnostics, full RuleSpec compilation, source-kind guarantees, shared/dynamic public parameters, Mark parameter transmission, execution budgets, manifests and final UGC acceptance scenarios. No production effect IDs are converted by this slice.

Review: Spec reported no defects within this scope. Standards reported no blocking defects and suggested unifying recursive freezing; parameters and capability descriptors now share the same symbol-aware internal helper. Validation: 96 V4 tests across 13 files; declaration build, V4 typecheck/lint and source verification pass. Existing Node/Chrome checkpoint/host checks pass; the new action scenarios themselves are covered by the Node V4 suite.
