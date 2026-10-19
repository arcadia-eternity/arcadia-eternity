# Authored binding snapshot evidence

2026-10-19. This closes the authoring adapter's stable factory registration gap. It does not admit candidates into the production catalog.

## Contract

`compileEffect` collects persistent plans from composed `apply` / `sequence` actions. A custom execution callback declares its plans through `bindings: { key: plan }`. An undeclared or different plan is rejected when installed. Duplicate keys with different plans fail compilation.

`effectAuthoring.registerEffect(catalog, effect)` registers the compiled effect and its factories together. A factory ID encodes the effect ID and binding key as a JSON pair. All identities are checked before registration mutates the catalog: conflicts cannot leave a partial effect or factory set. Re-registering the same compiled effect is allowed; sealed catalogs reject registration.

Factory arguments contain the source mark reference. Rehydration builds a query scope from that restored domain object, without retaining an original EffectContext. Trigger events and action execution are unavailable in persistent evaluation. The existing ValuePlan evaluator restores captured values and identities and re-establishes follow dependencies.

An optional `ValueDefinition.source` accessor ties factory arguments to the contribution's source. Installation, snapshot export and restoration before activation check that identity. A same-battle replacement mark cannot silently become the source by changing the serialized arguments. Existing definitions without this accessor keep their prior contract.

## Evidence

`packages/battle/test/v4/authoring-snapshot.test.ts` contains ten tests using real Battle, marks, modifiers and public snapshot APIs:

- Captured instance/followed stack, followed instance/followed stack, and per-input captured stack retain their distinct behavior through JSON restoration with a fresh catalog.
- Stack changes, mark replacement, same-instance exit/re-entry without an intermediate read, repeated restoration and source consumption exercise restored subscriptions and cleanup.
- Initial absence remains recoverable for follow after restoration.
- Custom callback bindings restore through explicitly declared plans.
- Conflicting compile keys, a conflict in a later factory, repeated registration, sealed registration, missing factories and tampered source references are checked.
- The actual `effect_mark_reduce_speed_ruodian` candidate restores twice using freshly compiled effects; stack changes affect `spe` while `spd` stays unchanged.

Both independent Standards and Spec reviews passed after fixing partial registration and source substitution. Targeted public tests passed 102 cases across four files; the separate source authoring/binding suite passed 35 cases. The final full V4 run passed 5,088 tests across 39 files. Declaration generation, typechecks, scoped lint, formatting and source provenance passed. Node and real Chrome checkpoint continuation agreed; the browser check used an authorized local temporary server after the restricted environment could not listen on its port.

## Remaining boundaries

Domain relation notifications now initialize at construction and hydration; the lazy adapter has been removed. See [domain relation evidence](domain-relations.md) for the owned-list contract and regressions. The weakness-speed candidate's legacy removal decision and full-game comparison remain outstanding. Parameter overrides, official loader admission and the remaining catalog are separate migration work; all four authored candidate records remain U.
