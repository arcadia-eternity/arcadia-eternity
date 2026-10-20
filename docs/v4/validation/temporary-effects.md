# Phase-scoped temporary effects

The pinned later V1 implementation (`61c349fa7ca35c392b0e751c9238759b02aefcb3`) includes temporary effect storage, parser dispatch and entity-effect references, phase selection, and phase-finally cleanup. This restoration reconnects that chain rather than substituting a no-op operation.

## Model and dispatch

Skill and mark instances store temporary entries as effect identity plus phase ID. Permanent `effects` arrays retain their current mutable interface. `getEffects(trigger)` returns permanent entries followed by temporary entries for that trigger; the shared effect collector now uses this view. This differs deliberately from the historical copying `effects` getter, which would silently discard existing `effects.push/splice` callers. Instance transformation continues to update permanent effects; temporary entries remain independent until their phase expires.

The operator reads its value source only after finding a scope, then adds each selected effect to each selected target. Scope priority is the nearest active Skill phase, then Turn, then the current phase. No active phase means no source read or mutation. Both PhaseManager execution paths clear entries in finally after popping the config phase. Cleanup covers battle marks and all pets' skills and marks, matching the historical ownership traversal.

Dispatch still uses the current collector's effect identity deduplication and admission rules. Adding duplicate temporary entries does not introduce an extra execution policy. Clearing one phase preserves permanent effects and other phases' entries.

## Snapshot boundary

The current snapshot format restores settled selection checkpoints, not the active phase stack. Export and import therefore reject active temporary entries rather than retaining phase IDs that can never expire. Cleaned instances include an empty temporary-effect list. Old snapshots without the field initialize it to an empty list on restore. This is the same boundary principle as the existing rejection of active phase-bound config modifiers.

The current xifa definition adds effects during BeforeSort inside the turn; those entries expire before the next selection checkpoint. Mid-phase checkpointing and general active temporary-lifetime hydration remain unsupported and are not claimed by this restoration.

## Evidence

The focused tests cover Skill/Turn/current-phase scope selection, nested skill-versus-turn lifetimes, sync/async success and failure cleanup, no-phase source laziness, permanent/temporary identity duplication, the three owner locations, effect dispatch, checkpoint rejection and fresh-catalog restoration after cleanup (including the older missing-field representation). Four seeded cases parse the unchanged xifa YAML, resolve its effect references from the repository, select and dispatch exactly one dependency, and expire it with its turn. The dependency bodies in these lifecycle tests are controlled observers; they do not establish acceptance of all four real dependency effects.

The native xifa authoring candidate and dependency-closed full-game acceptance are subsequent migration work. Restoring all parser branches is not completion of the native migration.

Validation: 16 temporary-effect checks and 10 snapshot checks pass against the independent public build. The affected execution-lifecycle and random-stat-action suites also passed (11 and 132 tests). Both TypeScript checks, V4 lint, declaration generation, provenance verification and the reproducible historical audit pass. An initial missing-field snapshot test exposed a required-field validator mismatch; the validator now treats the new field as optional for older snapshots, and all 26 snapshot/lifecycle checks were rerun successfully.
