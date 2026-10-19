# Domain relation notifications

2026-10-19. This closes the lazy observer seam left by the typed effect authoring experiment. It is infrastructure for reliable capture/follow, not acceptance of the full official effect catalog.

## Contract and implementation

`values/relations.ts` owns synchronous relation notifications. Pet construction initializes owner and mark membership; Mark and Skill construction initialize owner. Snapshot hydration initializes the same relations before restored bindings activate. Player active-position notification retains its existing implementation. The authoring runtime only reads domain relations, and its separate lazy adapter is removed.

Pet owns the membership array assigned to `pet.marks`. Assignment copies members; mutating the caller's input array does not change the Pet. Callers mutate the returned `pet.marks` handle instead. A handle obtained before the first selector runs already publishes changes. Replacing the list detaches the old handle: it neither changes current membership nor publishes to current observers. Existing production list assignments use filtered replacement arrays; no production input-array mutation dependency was found.

Standard list methods publish once after the complete operation. Direct index writes, deletion and length writes also publish. Thus a splice does not expose its intermediate index shifts as false exits/re-entries. Follow observes the resulting membership; per-input capture opens a new generation after a real exit/re-entry, even without an intermediate attribute read. No asynchronous scheduler or RxJS was added.

Relation fields stay own and enumerable for the existing explicit snapshot ledger. Runtime signals and proxies are reconstructed rather than serialized. The source-port provenance is refreshed for the reviewed Pet/Mark/Skill constructor changes.

## Evidence

Two regression cases first failed against the lazy adapter: a pre-selection list handle kept a stale per-entry capture (250 instead of 200 speed), and mutation of an assigned input array changed live membership without a reliable observation boundary. Both pass after the change.

Five public domain tests independently cover atomic list-method notifications, direct index/length writes, detached and raw-input isolation, and owner changes for Pet, Mark and Skill. Existing authoring and fresh-catalog snapshot scenarios exercise the same relations through real modifiers, mark replacement, source cleanup and repeated restoration.

Standards review identified detached handles still notifying the current collection. Publication now checks active proxy identity; regression assertions cover stale push, index and length writes without any new notification. Spec review passed the construction/hydration ordering and capture semantics. Standards follow-up independently confirmed the fix. The final full suite passed 5,093 tests across 40 V4 files; 37 separate source authoring/binding cases passed. Targeted public checks passed 111 cases. Typechecks, declaration generation, lint, formatting and provenance checks passed; Node and real Chrome checkpoint continuation agreed on the final build.

## Scope

This does not expose new selectors, change effect IDs, make arbitrary event closures persistent, or admit candidates into production. Arrays passed into membership assignment are now inputs rather than shared mutable storage; membership must be modified through the Pet's current handle. All production effect acceptance records remain unchanged.
