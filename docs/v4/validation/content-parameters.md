# Public parameter foundation

Part of #223 / #206, not completion of the UGC compiler. The next compiler slice will assemble triggers, conditions, actions, value presets and instance-parameter transmission around these contracts.

- `normalizeParams(schema, unknown)` clones JSON content, applies TypeBox defaults, validates and freezes it. A closed object schema is required. No coercion: zero and false survive, unknown fields and non-finite values fail. TypeBox `Static` supplies the TS result type.
- `parameterAddress(effectId, nodeId, parameterId)` encodes a tuple, not an array position or dotted path. Different uses of one capability therefore have different addresses.
- `defineParameter` distinguishes the content schema/base value from the explicitly declared effective-value schema. A numeric modifier may exceed the content editing range only if the effective schema allows it. No implicit clamp is introduced.
- `ParameterCatalog` copies definitions and builds an unambiguous legacy-alias table. Registration checks every address before changing the battle config. It does not share mutable values across battles.
- Reads and scoped modifications use the existing ConfigSystem. Allowed operations are checked; effective values are checked when read. The caller owns the returned modifier cleanup and must connect it to its source/phase lifetime. The eventual capability operations will do that wiring.

The import guard now explicitly permits the repository's existing TypeBox dependency for these schema contracts. This is not a new type-language interpreter. `config.ts` adds read-only disposed/registered-key introspection to preflight installation; its aggregation/scoping behavior is unchanged. The pre-commit formatter also normalizes that file's existing layout, and provenance is refreshed after reviewing the diff.

`content-parameters.test.ts` checks defaults/false/zero/errors, per-use and per-Pet scope isolation in a real Battle, modifier cleanup, alias ambiguity, strict effective-value validation, mutable-definition isolation, allowed effective ranges, atomic duplicate preflight and rejected installation after disposal.

Still pending: full RuleSpec/capability compilation, parameter reference slot constraints, preset expansion/copy identity, Config live readers and strict cross-system cycle detection, lifetime wiring, mark instance parameter initialization/conflicts, catalog manifests and snapshot compatibility. This file does not claim these gates have passed.
