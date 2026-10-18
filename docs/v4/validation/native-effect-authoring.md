# Native TypeScript effect authoring

`defineNativeEffect` implements the trusted authoring seam required by #223 D. It produces an existing `Effect<EffectTrigger>` suitable for skill/mark registration. It does not require official TypeScript effects to encode a RuleSpec.

- Callbacks receive a mapped union of `EffectContext<K>`. Narrowing `trigger` narrows `parent`, including when callbacks rely on inference instead of annotations.
- Only triggers with actual V4 `applyEffects` dispatch sites are accepted. `AfterAttacked`, although present in the old context map, has no dispatch and is excluded. A source-backed test compares the list against current direct dispatch sites; indirect dispatch additions require updating that evidence.
- The adapter snapshots callbacks, triggers and tags; the resulting definition and its arrays are frozen. Battle context objects remain the original mutable execution contexts, so intervention and success state retain their existing behavior.
- Trigger membership is checked at the adapter boundary before converting the old generic context to the correlated union. The existing dispatcher remains responsible for constructing the correct parent context.
- Conditions still execute during collection, and actions run through the existing Effect pipeline. This adds no new admission, RNG, consumption or exception policy.

`native-effect.test.ts` runs a multi-trigger effect through a real Battle: TurnStart and OnDamage callbacks receive the expected parent, mutate the actual damage context, and skip apply when the condition fails. Compile-time positive and negative assertions exercise annotated and inferred callback types. Invalid empty, duplicate and unsupported trigger declarations are rejected.

Pending: capability registry, bounded RuleSpec compilation, shared execution budgets/admission records, and handwritten official conversions. This interface alone does not prove those migration gates.
