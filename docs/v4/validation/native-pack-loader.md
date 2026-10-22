# Native package transport

`NativePackLoader` is exported through `@arcadia-eternity/pack-loader/native`. The existing `PackLoader` entry remains available for V2 consumers. Both use the extracted `PackTransport` for manifest traversal, assets, lockfiles, HTTP reads and integrity calculations. Node reference resolution moved unchanged into the effect-independent `@arcadia-eternity/battle/pack` entry, with the cache-identity correction described below. Native imports do not require the V2 loader/interpreter.

```ts
const loader = new NativePackLoader(trustedBuildIdentity)
const loaded = await loader.load(packRef, {
  source: 'http', // node-fs is the default
  enforceLockfile: true,
  expectedRevision,
})
const battle = loaded.content.createBattle(loaded.content.parsePlayer(teamA), loaded.content.parsePlayer(teamB), {
  rngSeed: 201,
})
```

The constructor copies the trusted host build identity before asynchronous work. Native loading always validates the complete metadata/reference closure; there is no partial-content or DSL fallback option. It reads only mark, skill and species arrays from the existing manifest format (`engine: seer2-v2` denotes that metadata format here). Effect-file lists are never fetched. Existing skill/mark effect IDs resolve against compiled TS implementations. Unknown IDs fail loading.

Dependencies load before the entry pack. Assets, conflicts and locales retain the existing transport behavior. Enforced locks require both presence and successful validation. Options used across asynchronous reads are captured at invocation. The native revision covers the trusted core/registry identity, ordered pack IDs/versions and ordered metadata JSON representation, using the shared SHA-512 integrity implementation. Source URLs, locale presentation and assets do not change executable content identity. The revision contract conservatively treats metadata representation/order changes as changes; it is not a semantic canonicalization format. A caller can require an expected revision before content is published.

Two red tests found an existing traversal bug: a repeated file/URL returned immediately from the visited cache without checking the second dependency's expected ID. Both Node and HTTP traversal now check cached identity, retaining their optional-dependency/warning behavior. No effect semantics changed.

October 23 verification:

- All 16 package tests pass, including the original loader/lockfile tests, same-content filesystem/HTTP identity, canonical effect references, locales/assets, absent enforced locks, copied options/build identity, invalid metadata, unknown effects, code-build mismatches, dependency ordering/cycles and the two cached-ID regressions.
- All 40 existing V2 data-loader/repository/parser tests pass after moving reference resolution. Package source/tests type checking, source lint and declaration builds pass.
- `pnpm verify:battle-v4-native-pack` builds a minified browser host probe and rejects old EffectBuilder/effect-schema/parser, V2 runtime, removed RxJS/Prando and foreign runtime dependencies in its graph. Node and actual headless Chrome load all 1065 effects, 416 marks, 966 skills and 145 species over HTTP, execute the complete seven-turn action plan, save at turn two and restore using freshly loaded directories. Their event and HP/rage traces match. The HTTP server refuses effect DSL requests; none occur.

The programmatic native-content entry also passed the separate complete V4 regression at `384ac37b` (146 files, 27,373 tests). PackLoader's native library path and browser/Node host probe are now available. The server and application battle controllers still select their previous V2 runtime; replacing that selection and completing timed recovery remain required before deployment acceptance.

The later [native battle-system adapter](native-battle-system.md) now supplies that interface, and the Chrome/Node probe exercises it directly. Timed recovery and remaining host-control compatibility still gate the default application/server cutover.
