# First handwritten official healing candidates

Four current production IDs now have native TypeScript candidate definitions in `packages/battle/src/v4/official/healing.ts`. They retain the existing Effect IDs and are exported for explicit testing; the production loader still uses its existing catalog. No duplicate registration or automatic cutover is introduced.

The [candidate ledger](official-healing-candidates.json) pins source hashes, source node paths, old/expected behavior and scenario names. Classification remains U pending complete per-ID acceptance; the proposed semantic decision is E (preserve). The initial inventory remains an unmodified baseline.

The candidates are fixed-90 healing and one-half/one-third/one-quarter maximum-HP healing. They preserve collect-time selfUseSkill, resolve the source owner again at execution, read current maximum HP after BeforeEffect, and floor division before constructing HealContext. The last detail affects OnBeforeHeal input and would be lost by relying only on final HP rounding. These source literals have no public Config address; this family does not yet prove the parameterized authoring flow.

`official-healing.test.ts` parses the current YAML without rewriting it and compares each candidate on normal healing, full HP, fainted target, a different skill, effect cancellation, healing cancellation, a late maximum-HP change and a late source-owner change. It compares all team HP, healing hook values, healing/failure messages and the next RNG draw. Normal-case assertions also require concrete healing amounts, so matching no-ops cannot pass. A hash/coverage check rejects stale source mappings or a missing candidate.

This is effect-dispatch/HealPhase differential evidence. Full-game oracle traces, source Mark ownership cases, snapshots/catalog registration, configurable samples and complex sustained-value families remain required before full conversion or switch.
