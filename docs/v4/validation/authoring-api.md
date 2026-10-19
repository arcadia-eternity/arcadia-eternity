# Typed effect authoring API integration

2026-10-19. The user explicitly resumed the all-effect migration after the four-example runtime experiment. This is a migration milestone, not catalog completion.

## Implementation

- `packages/battle/src/v4/content/authoring` contains the typed contracts and shared runtime. `effectAuthoring` is a namespace export, avoiding collisions with the existing ValuePlan `values` API.
- `packages/battle/src/v4/official/authored` contains the four readable effect definitions. `officialAuthoredEffects` explicitly compiles them as candidates. Design example files re-export these same definitions; there is no second implementation to drift.
- Existing four `officialHealingEffects` now use the same context lookup, owner query, attribute readers and operators. Their IDs and prior source hashes remain unchanged.
- No official loader switch or bulk fallback was added. The bounded UGC compiler remains separate; authoring parameter helpers now use the existing ParameterCatalog and current source scope; see [parameter evidence](authoring-parameters.md).

## Behavior evidence

`pnpm test:effect-authoring-design` runs 31 authoring scenarios and the existing 19 value-binding tests against the source implementation. Scenarios include collection versus execution time, independent actions, lazy branches, one numeric read per operator, direct HP assignment without healing, `spe` versus `spd`, captured instance/followed stack, followed instance/per-entry captures, removal, replacement, same-instance re-entry without intermediate reads, initial absence, source cleanup, real switching, duplicate keys and self-dependency rejection.

`official-authored.test.ts` compares three non-persistent candidates against current production YAML through the legacy parser and real V4 dispatch: skill/mark sources, missing prerequisite, wrong owner, cancellation, late HP/maxHP/owner changes, consumption hooks, and twelve exact HP threshold values. It compares state, modifier results, effect success/hooks and subsequent RNG. Sixty-six behavioral cases and a four-ID source-hash check pass. This does not constitute full-game or checkpoint acceptance.

Existing `official-healing.test.ts` still passes all 33 cases after adopting the API. `legacy-mark-conditions.test.ts` separately passes 43 checks for the previously restored parser conditions; that restoration is not a new authoring implementation.

Per-ID source hashes and remaining gates are recorded in `authoring-api-candidates.json`; all four remain U. The main production migration inventory has not been reclassified based on these bounded checks.

The damage-modifier batch adds shared `contexts.damage`, `ops.modifyDamage` and ordered condition combinators. Runtime checks cover ancestor reselection, numeric read order, missing values, cross-battle contexts and short-circuiting; type assertions reject using damage operators on pets and passing persistent plans as instant amounts. See [batch evidence](damage-modifiers.md).

The healing-modifier batch adds `contexts.heal`, `ops.modifyHeal`, direct-target healing admission and an ordered probability condition. Damage and healing share numeric reads and ownership enforcement, including rechecking targets after value callbacks. See [healing evidence](heal-modifiers.md).

The skill-power batch adds `contexts.skillUse`, direct-owner admission and `Selector.all()`. Power operations read ordered numeric lists once per selected context and apply all members without rounding. Shared ancestry lookup and action-time reselection are reused; see [skill-power evidence](skill-power.md).

## Review boundaries

Independent Standards and Spec review found mutable declaration defaults and cross-battle writes. Built-in options are now snapshotted, parameter tables and tokens frozen, and every write operator validates target ownership before mutation. Boundary regressions cover changed defaults, parameter tables, binding operation/capture options, healing, stat stages, references and mark stacks. Trusted callback closures remain the author's responsibility.

## Persistent binding boundary

Capture/follow use the existing Evaluation, ValuePlan, synchronous dependency tracker, cycle guards, budget and modifier cleanup. An explicitly opted-in `BindingInputUnavailable` can leave an initially absent plan subscribed. Other initial errors still fail construction; existing callers retain fail-fast behavior.

`missing: detach` means the contribution is unavailable while structural tracking stays alive. A follow can recover; source destruction permanently disposes the binding. Captured absence remains absent, and captured instances never rebind. Per-binding attribute capture retains its original result across subsequent slot changes.

Relation observation now initializes with Pet, Mark and Skill construction and snapshot hydration, before bindings activate. The authoring adapter no longer instruments fields lazily. Pet owns its membership arrays: assignment copies members, while the returned handle supports notified mutations; detached handles cannot notify the current collection. See [domain relation evidence](domain-relations.md) and [authored binding snapshots](authored-binding-snapshots.md).

## Final validation

Final rebuilt artifacts pass all 8,330 V4 tests across 43 files, plus 50 source authoring/binding tests. V4 and authoring typechecks, declaration build, scoped/root lint, formatting and source provenance checks pass. Standards and Spec follow-ups confirmed the reported fixes; the legacy historical-body guard now uses a pinned digest rather than requiring full Git history. Node and real Chrome checkpoint continuation also agree after the persistent factory changes. No production loader cutover is implied by these results.
