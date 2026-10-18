# First generated native mechanism batch

The offline generator `scripts/effect-migration/instant-literals.mjs` recognizes a deliberately closed family: one finite numeric literal heal/addRage action, a self/opponent target, and either selfUseSkill on OnHit/OnMiss or petIsActive on TurnEnd. A single-element every wrapper is allowed. Unknown definition/action fields, other conditions, dynamic/config-backed values, other targets and trigger combinations are not emitted.

Current output contains 16 native TypeScript candidates. The existing handwritten 90-HP healing implementation is explicitly protected and excluded from generated exports. Forty-four other single-root heal/addRage definitions are recorded with rejection reasons; nested action arrays and other operator families are outside this batch's scan scope. No empty effects, runtime fallback, string-evaluated code or custom runtime type checker are generated.

`packages/battle/src/v4/official/instant-literals.generated.ts` contains individual defineNativeEffect declarations with direct HealContext/RageContext calls. The generated runtime module imports no YAML, legacy parser, selector builder or repository. Source owner/opponent position is resolved when the action executes; literal values remain literal rather than acquiring new public Config slots. Conditions preserve skill identity versus pet-mark ownership and active-pet checks.

[Candidate records](instant-literals-candidates.json) include source paths, normalized source hashes, recognized recipes and explicit generated/handwritten status. Every record remains U. These are candidates for the eventual static catalog, not published production registrations or full acceptance. Existing baseline inventory files remain unchanged.

Regenerate from repository root:

```sh
node scripts/effect-migration/instant-literals.mjs
node scripts/effect-migration/instant-literals.mjs --check
node --test scripts/effect-migration/instant-literals.test.mjs
```

`--check` writes nothing and rejects stale generated TS or ledger output. The generator validates all scanned IDs before writing and rejects duplicates even outside the emitted family. Handwritten overrides are explicitly listed; the generator only writes its dedicated generated module and ledger, never handwritten source files.

Three generator tests cover recognition, unsafe/unsupported structure rejection and exact regeneration. The runtime suite covers each emitted ID, each declared trigger and both skill/mark sources across nine scenarios: normal, inactive owner, wrong skill, late owner change, late opponent switch, cancellation, hook modification, fainted and full states. It compares team HP, rage, hook inputs, messages and the next RNG draw. Each normal case also requires its concrete nonzero effect. There are 307 runtime assertions/tests including source hash and exact emitted-ID coverage.

Fifty-one additional end-to-end tests execute each candidate in real skill/turn phases, including the dual-trigger candidate through guaranteed misses. Across three independently timed comparisons per scenario, the tests cover four complete-game paths: current YAML and native TS, both uninterrupted and JSON-restored at the second selection boundary. They compare event ordering, each turn-end HP/rage/active-pet state, the winner/final state and next RNG draw; each candidate must execute once before the checkpoint and exactly twice before switching its owner out. The persistent turn-end mark remains on the benched pet, exercising active-owner gating. Failed phases and effect/error events fail the test. These use controlled battle fixtures and a trusted local snapshot catalog, not the eventual production content/environment loader.

Complete acceptance classification, official skill/species dependency closure, other mechanism batches, immutable environment publication and production switching remain pending. A successful generated-source check does not turn U into E.

Validation: code/declaration builds, V4 typecheck/lint, all 784 tests across 31 V4 files, source provenance and Node/Chrome host/checkpoint checks pass. Standards review found no blocking issues. Independent Spec review remains pending reviewer availability; this batch does not claim full migration acceptance.

The three full-game comparisons for each scenario run as separate tests, preserving every oracle, restoration and concrete-effect assertion. A combined four-game test exceeded the default five-second timeout under full-suite parallel load; splitting the comparisons keeps the default timeout without weakening coverage.
