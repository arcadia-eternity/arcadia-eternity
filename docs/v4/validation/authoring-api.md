# Typed effect authoring API integration

2026-10-19. The user explicitly resumed the all-effect migration after the four-example runtime experiment. This is a migration milestone, not catalog completion.

## Implementation

- `packages/battle/src/v4/content/authoring` contains the typed contracts and shared runtime. `effectAuthoring` is a namespace export, avoiding collisions with the existing ValuePlan `values` API.
- `packages/battle/src/v4/official/authored` contains the four readable effect definitions. `officialAuthoredEffects` explicitly compiles them as candidates. Design example files re-export these same definitions; there is no second implementation to drift.
- Existing four `officialHealingEffects` now use the same context lookup, owner query, attribute readers and operators. Their IDs and prior source hashes remain unchanged.
- No official loader switch or bulk fallback was added. The bounded UGC compiler remains separate; the authoring parameter helpers currently read defaults only.

## Behavior evidence

`pnpm test:effect-authoring-design` runs 16 authoring scenarios and the existing 19 value-binding tests against the source implementation. Scenarios include collection versus execution time, independent actions, lazy branches, one numeric read per operator, direct HP assignment without healing, `spe` versus `spd`, captured instance/followed stack, followed instance/per-entry captures, removal, replacement, same-instance re-entry without intermediate reads, initial absence, source cleanup, real switching, duplicate keys and self-dependency rejection.

`official-authored.test.ts` compares three non-persistent candidates against current production YAML through the legacy parser and real V4 dispatch: skill/mark sources, missing prerequisite, wrong owner, cancellation, late HP/maxHP/owner changes, consumption hooks, and twelve exact HP threshold values. It compares state, modifier results, effect success/hooks and subsequent RNG. Sixty-six behavioral cases and a four-ID source-hash check pass. This does not constitute full-game or checkpoint acceptance.

Existing `official-healing.test.ts` still passes all 33 cases after adopting the API. `legacy-mark-conditions.test.ts` separately passes 43 checks for the previously restored parser conditions; that restoration is not a new authoring implementation.

Per-ID source hashes and remaining gates are recorded in `authoring-api-candidates.json`; all four remain U. The main production migration inventory has not been reclassified based on these bounded checks.

## Review boundaries

Independent Standards and Spec review found mutable declaration defaults and cross-battle writes. Built-in options are now snapshotted, parameter tables and tokens frozen, and every write operator validates target ownership before mutation. Boundary regressions cover changed defaults, parameter tables, binding operation/capture options, healing, stat stages, references and mark stacks. Trusted callback closures remain the author's responsibility.

## Persistent binding boundary

Capture/follow use the existing Evaluation, ValuePlan, synchronous dependency tracker, cycle guards, budget and modifier cleanup. An explicitly opted-in `BindingInputUnavailable` can leave an initially absent plan subscribed. Other initial errors still fail construction; existing callers retain fail-fast behavior.

`missing: detach` means the contribution is unavailable while structural tracking stays alive. A follow can recover; source destruction permanently disposes the binding. Captured absence remains absent, and captured instances never rebind. Per-binding attribute capture retains its original result across subsequent slot changes.

Relation observation currently adapts source.owner and Pet.marks lazily. Array mutation methods notify after completing the operation. This is still a temporary seam: raw array aliases retained before instrumentation can bypass notification, and restoring these relation observers has not been validated. Domain-owned mutation notifications and stable plan registration are required before persistent candidates can enter production or pass checkpoint acceptance.
