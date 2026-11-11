# Base Content Pack Format

## Authoring Source Layout

```text
<pack-root>/
  pack.json
  assets/
    *.png|*.jpg|*.webp|*.mp3|...
  data/
    mark*.yaml
    skill*.yaml
    groups/<group>/species.*.yaml
    presentations/*.yaml
    resources/*.yaml
  dist/presentation.json  # generated display manifest v2
  src/effects/
    *.ts
  locales/
    <locale>/
      *.yaml
```

For this repository's built-in pack package:

- `paths.dataDir = "data"`
- `paths.localesDir = "locales"`

## Published npm Layout

The npm package is an immutable distribution artifact. It does not include `pack.json`, `data/`, `locales/`, or `src/` from the source tree.

```text
@arcadia-eternity/data-pack-base/
  package.json
  LICENSE
  assets/
  dist/
    pack.json
    pack-lock.yaml
    content.json
    presentation.json
    catalog.json
    arcadia-effects.json
    locales/<locale>/<namespace>.json
```

`package.json#arcadiaEternityPack` points to `dist/pack.json`. The published manifest has `content` and `presentation` entries plus empty `data.*` file lists; runtime content comes from the compiled JSON files. `dist/pack-lock.yaml` is a generated lock record, not authoring source. Installed packages are opened read-only.

## `pack.json` Fields

- `id`: unique pack id
- `version`: pack version
- `engine`: must be `"seer2-v2"`
- `layoutVersion`: currently `1`
- `presentation`: generated display manifest path (`dist/presentation.json`)
- `paths.dataDir`: base dir for `data.*` file lists in source manifests
- `paths.localesDir`: base dir for locale files
- `dependencies`: dependent pack list, loaded before current pack
- `data.marks|skills|species`: YAML filenames relative to `dataDir` in source manifests; empty in published manifests
- `data.effects`: empty in the native base pack; retained for legacy manifest compatibility
- `locales`: source manifests use locale -> namespace lists; published manifests list the compiled JSON files

## Presentation and resources

Source definitions live in `data/presentations/` and `data/resources/`. Presentation records target content by kind and ID; slots reference stable resource IDs. Resource definitions own locations and media kinds. Gameplay records contain no paths or presentation fields.

The base build emits `dist/presentation.json` version 2. HTTP resources remain declarations. `loadMetadata` returns this separately from rules and locales; display consumers join it by content ID. Source movement does not change IDs. Changing a media location only updates its resource definition.

The previous `assets.json` mappings and duplicated resource YAML maps have been migrated. See [the presentation contract](../../docs/guides/content-presentation.md).

Dependency item format:

- `path`: relative path to dependent `pack.json`
- `id` (optional): expected dependent pack id (mismatch will fail)
- `optional` (optional): when true, missing/invalid dependency is skipped with warning

## Loader APIs

Hosts construct `NativePackLoader` with the selected content package's build identity and trusted content factory.

- `load(packRef)`: load metadata, validate references against compiled effects, and return the executable content catalog
- `loadMetadata(packRef)`: read editable species, skill, and mark data for layer composition or resource inspection
- `fromMetadata(data)`: validate and assemble composed or unsaved metadata

File loading also returns locale bundles, presentation manifests, and lockfile diagnostics. Native effects are maintained in TypeScript; legacy effect YAML is kept only in regression fixtures.

## npm Pack Resolution

`packRef` supports:

- file path: `./packs/base/pack.json`
- npm package: `npm:@scope/data-pack`
- npm package with explicit entry: `npm:@scope/data-pack#packs/base/pack.json`

When loading from npm package, loader reads package root `package.json` and uses:

- `arcadiaEternityPack` as manifest entry path, or
- default `pack.json` when field is missing.

Published base and UGC packages use compiled content and presentation JSON. YAML remains an authoring input in the source repository and is not part of the npm archive.

## Lockfile

Base pack can generate its own `pack-lock.yaml`:

```bash
pnpm --filter @arcadia-eternity/data-pack-base run generate:lockfile
```

Current generator behavior:

- emits pnpm-like `importers` and `packages`
- records the `pack.json` package node; presentation metadata is generated separately
- uses the explicitly supplied workspace package and source entry for the root `workspace:` ref; the published entry remains `arcadiaEternityPack`
- computes `sha512-*` integrity from local manifest content

The base build also emits `dist/pack-lock.yaml` for the compiled manifest. Consumers that load `dist/pack.json` enforce that generated lock record.
