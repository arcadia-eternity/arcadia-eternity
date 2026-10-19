# Authoring parameters use the battle configuration system

`numberParam` and `booleanParam` now declare real configuration-backed values. Compilation assigns a stable `parameterAddress(effectId, 'parameters', name)`, preserves declared tags and legacy aliases, and produces the existing `ParameterCatalog`. There is no new parameter interpreter or schema type system.

The author writes a normal typed definition:

```ts
const amount = numberParam({ default: 15, legacyAliases: ['old-effect.damage_percent'] })
const effect = compileEffect(
  defineEffect({
    id: 'example/damage',
    on: 'OnBeforeCalculateDamage',
    parameters: { amount },
    when: conditions.selfUsesSkill,
    execute: contexts.damage.apply(ops.modifyDamage({ percent: amount, delta: 0 })),
  }),
)
effectParameters(effect).install(battle.configSystem)
registerEffect(snapshotCatalog, effect)
```

The host installs the catalog once in each new battle, before dispatch. JSON restoration already carries the actual configuration values, so it recompiles the same effect definitions and registers their factories without installing defaults over restored values. Reading an uninstalled or undeclared parameter fails; it never silently falls back to a default. Numbers permit delta and override; booleans permit override. The existing catalog validates effective values and resolves aliases. These trusted declarations do not yet provide a UGC editor or replace the bounded capability schemas.

Declarations own their option arrays and defaults. Reusing a token in different effects yields independent addresses and frame-specific reads. Giving the same token two names within one effect is rejected because its address would be ambiguous. Distinct declarations with conflicting aliases fail compilation through the existing catalog.

Each immediate read queries the current source-instance scope. Persistent plans keep the same explicit temporal choices: `amount.capture({ key, scope: 'binding' })` freezes the first value, while `amount.follow({ key })` observes later configuration changes. Persistent factories carry the compiled parameter catalog and source identity, never a saved trigger frame.

The first restoration test exposed a missing notification in `ConfigSystem`: scoped modifier arrays and scoped base membership were plain maps. A structural revision now invalidates reads after scoped insertion, removal, scope release and phase activation/tracking changes; existing scalar signals still handle value updates. This revision is intentionally broad and may re-evaluate unrelated configuration followers. It changes notification, not modifier ordering or scope precedence.

Evidence includes source-scope isolation, repeated action-time reads, boolean values, missing installation, undeclared tokens, ambiguous names, metadata copying and one token reused across effects and battles. Fresh-factory JSON tests save a nondefault scoped base value, restore both capture and follow plans, then add/remove scoped modifiers, create/release scoped bases, enter/exit a phase and add a modifier while its phase is already active. The tests keep `spe` distinct from `spd`.

This enables the next parameterized official candidate batch. It does not admit additional official IDs or switch production loading.

Validation: all 6,416 V4 tests across 41 files pass (386.18 seconds), plus 43 source authoring/binding tests. V4 and authoring typechecks, declaration generation, scoped lint, provenance and Node/Chrome checkpoint checks pass. Independent Standards and Spec review both pass.
