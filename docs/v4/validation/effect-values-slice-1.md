# Effect values: first runtime slice

Issue contracts: [#205](https://github.com/arcadia-eternity/arcadia-eternity/issues/205), [#206](https://github.com/arcadia-eternity/arcadia-eternity/issues/206), reviewed design dated 2026-10-17. Base: `43a7741dcba5a66b9c85cfecb7402189e29a7226`.

This slice implements the numeric, single active-slot path in the real V4 Battle. It does not complete either issue or switch the official effect catalog.

## Public seam

```ts
const entryDefense = defineValue('my-pack/entry-defense', (opponent: Player) =>
  select
    .activePet(opponent, { key: 'opponent', mode: 'follow' })
    .attribute('def', { key: 'defense', mode: 'capture', captureScope: 'input' })
    .requireOne(),
)

const binding = installValueModifier({
  definition: entryDefense,
  args: opponent,
  source: mark,
  target: ownerPet,
  attribute: 'atk',
  operation: 'override',
  effectId: 'my-pack/effect',
  bindingKey: 'attack',
})
// Optional explicit release. Source destruction also releases the contribution.
binding.dispose()
```

Definitions contain trusted TypeScript and stable IDs. Each install builds independent capture/generation state. `values.constant`, `values.reactive`, `values.combine` and `ValuePlan.map` compose pure calculations with TypeScript inference. Attribute names come from the existing stat type; there is no runtime type-language interpreter. Node keys must be unique within a plan, while reusing the same selection/value object is supported.

- Selection supports `follow` or `capture/binding`; attribute reads support `follow`, `capture/input`, and `capture/binding`.
- Input generations change on actual departure/re-entry, including equal-valued transitions. Attribute changes do not recapture. An entry capture failure stays faulted for that generation.
- Installation prepares before publishing. Replacement keeps the Modifier identity and source cleanup; unsupported changes to operation/priority are rejected. The key includes source, effect, binding and target.
- Each binding owns a live subscription even without consumers. Refresh replaces the numeric contribution, without running apply or RNG. Runtime faults withdraw the contribution and expose `binding.fault`; later valid dependencies can restore it. Suppression excludes contribution while retaining tracking/captures.
- Strict reads track effective attribute dependencies, including cached upstream bindings, before subscribing. Captures remove live dependency edges. The old attribute fallback remains available only outside strict binding evaluation.
- The returned handle exposes value/fault/disposed state and idempotent disposal. Disposing an already replaced handle cannot remove the new contribution. Source destruction releases subscriptions and Modifier records.
- `SnapshotCatalog.registerValueBinding(definition)` resolves trusted factories. Existing graph snapshots store args, target references, captures and member generations; Modifier/source/cleanup graph records retain contribution ownership. Hydration allocates identities first, injects state and eagerly reconnects tracking after domain reconstruction. Missing definitions or capture keys fail restoration. No capture initialization, effect apply or RNG is replayed.

## Scope still pending

Skill/phase lifetime ownership, Config readers and cross-Config cycles, missing policies, collections/branches, bounded UGC capabilities and per-use parameter schemas, execution records/budgets, catalog digest generation, official effect conversion and differential migration remain subsequent slices. General readers must be pure; this API is for trusted TS, not a sandbox for uploaded code. Snapshot compatibility currently uses the existing explicit catalog revision.

## Changes to imported V1 source

The provenance manifest is refreshed only for these reviewed changes:

- `player.ts`: observe the existing own `activePet` property through a per-player Signal, preserving assignment and snapshot field shape.
- `mark.ts`: expose the existing source cleanup registration method in its interface.
- `attributeSystem.ts`: inspect/replace existing contributions, exclude unavailable owned values in calculation and client detail output, and propagate errors during strict reads. The historical calculation order and legacy fallback path are preserved.

`reactiveValue.ts`, `snapshot.ts` and the new `values/` module provide the adapter/runtime support. No RxJS or new runtime dependency is introduced.

## Verification

`test/v4/value-binding.test.ts` exercises four read-mode combinations, captured input plus live multiplier, source cleanup, replacement failure and target independence, live fault recovery, suppression, direct/transitive/dynamic cycles, entry faults, shared selections, frozen self reads, cross-battle ownership rejection, real switch hook/message order, and repeated JSON snapshot round trips, including an entry-faulted binding. Missing factories/renamed capture nodes fail restoration before a successful retry; RNG resumes from the saved position.

Run against the rebuilt public package (`dist`), not a test-only implementation:

```sh
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle build:types
pnpm typecheck:battle-v4
pnpm lint:battle-v4
pnpm test:battle-v4 --maxWorkers=2
pnpm verify:battle-v4-source
pnpm verify:battle-v4-hosts
```

The host check covers the existing Node/browser battle and checkpoint contract. The new value-binding scenarios run in the V4 suite; they are not claimed as a separate browser-driven suite.

### Review fixes (2026-10-18)

Both independent review axes passed after these regressions were repaired:

- A fault in an earlier eager combine input retains later siblings' entry tracking.
- Restore-state errors take precedence over ordinary runtime faults, so a renamed capture cannot be hidden by a faulted sibling.
- A synchronous observer failure during replacement restores the old Modifier value and disposes the candidate.
- Restored bound contributions validate target attribute, source ownership and unique value ownership before activation.

Validation after fixes: 85 tests in all 10 V4 test files; V4 typecheck and lint pass. Existing design drafts and their inventory are outside this implementation commit.
