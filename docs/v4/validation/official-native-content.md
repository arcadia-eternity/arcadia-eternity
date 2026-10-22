# Official native content entry

`createOfficialContent` is exported from `@arcadia-eternity/battle/v4`. It loads current mark, skill and species metadata against the compiled TypeScript effect directory. Skill/mark `effect` IDs remain references; the entry does not read or interpret effect DSL definitions.

```ts
const content = createOfficialContent({ marks, skills, species }, trustedBuildRevision)
const battle = content.createBattle(content.parsePlayer(teamA), content.parsePlayer(teamB), {
  rngSeed: 201,
  timerConfig: { enabled: false },
})
content
  .parametersFor('effect_skill_add_mark_shuiwenpingzhang')!
  .set(battle.configSystem, 'effect_skill_add_mark_shuiwenpingzhang.multiply_value', 1.5)
```

The host supplies a revision that identifies the code and metadata together. This entry is for trusted official content. Finite UGC packs continue to use the existing content-pack/environment compiler.

Loading allocates canonical mark prototypes, compiles effects against those prototypes, wires effect references, then resolves skills and species. Duplicate IDs, missing dependencies, unresolved effects and invalid metadata fail before a directory is returned. Published prototype arrays and metadata are frozen. Returned lookup methods resolve the same prototypes used by effect operations and snapshots.

The existing metadata/team parsers accept an injected `PrototypeLookup`; their default path remains available for historical DSL comparisons. The native path injects its own lookup throughout, including initial mark allocation and nested pet parsing. It never consults the legacy singleton. Direct metadata-schema imports keep the legacy effect schema and EffectBuilder out of the native dependency graph.

`content.createBattle` rejects prototypes from other directories, installs every distinct parameter catalog into a fresh ConfigSystem and constructs the existing Battle. Values and modifiers remain per battle. `content.snapshot` checks directory ownership, and `content.restore` resolves against the revision's prototypes, code and authored value factories. Restoring uses saved parameter state without reinstalling defaults. The host must call snapshot only at the existing supported selection boundary.

Validation on October 23:

- All 1065 native effects wire successfully to 416 marks, 966 skills and 145 species. No effect DSL files are supplied to this loader.
- A test makes any legacy singleton access throw while content loading, team parsing and Battle construction proceed. Malformed/dependency cases, canonical references, immutable input copies, independent directories and parameters are covered. Each test checks attribute-system cleanup.
- The complete official action script finishes in seven turns with eight actions per player and winner A. Saving at turn two and restoring from JSON with a newly compiled directory produces identical events and HP/rage checkpoints; an edited parameter retains its value.
- The final related run passed 124 tests across eight suites. V4 types, lint, declarations, source provenance and historical audit passed.
- `pnpm verify:battle-v4-native` builds the source entry for the browser, rejects legacy effect DSL/EffectBuilder, removed RxJS/Prando and foreign runtime dependencies, then imports the minified module and loads all current metadata. This checks the browser-targeted module under Node; real browser host execution remains a separate gate.

PackLoader and the server runtime still select V2. This programmatic native entry is the integration seam for their later cutover; that host migration and final overall acceptance remain open. The earlier complete 27,364-test V4 checkpoint is recorded separately and predates this entry.
