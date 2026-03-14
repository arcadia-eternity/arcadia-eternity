# Seer2 V2 Data Pack Format

## Recommended Folder Layout

```text
<pack-root>/
  pack.json
  assets.json
  data/
    effect_*.yaml
    mark*.yaml
    skill*.yaml
    species*.yaml
  locales/
    <locale>/
      *.yaml
```

For this repository's built-in pack package:

- `paths.dataDir = "data"`
- `paths.localesDir = "locales"`

## `pack.json` Fields

- `id`: unique pack id
- `version`: pack version
- `engine`: must be `"seer2-v2"`
- `layoutVersion`: currently `1`
- `assetsRef`: optional assets manifest reference (`assets.json` or URL)
- `paths.dataDir`: base dir for `data.*` file lists
- `paths.localesDir`: base dir for locale files
- `dependencies`: dependent pack list, loaded before current pack
- `data.effects|marks|skills|species`: YAML filenames relative to `dataDir`
- `locales`: locale -> namespace list (namespace maps to `<localesDir>/<locale>/<namespace>.yaml`)

## `assets.json` (optional but recommended)

Used for resource distribution (sprite/sfx/ui/bgm), and can be consumed directly by Web/Tauri runtime.

Recommended fields:

- `id`, `version`, `engine`
- `dependencies`: optional asset-manifest refs (loader resolves deps first)
- `assets`: resource entries
- `mappings`: species/marks/skills mapping table

Dependency item format:

- `path`: relative path to dependent `pack.json`
- `id` (optional): expected dependent pack id (mismatch will fail)
- `optional` (optional): when true, missing/invalid dependency is skipped with warning

## Loader APIs

- `loadV2GameData(dataDir, { packPath })`
- `loadV2GameDataFromPack(packPath)`
- `loadV2GameData(dataDir, { packRef })`
- `loadV2GameDataFromPack(packRef)`

Both return:

- parsed data repository
- optional `locales` bundle: `Record<locale, Record<namespace, unknown>>`

## npm Pack Resolution

`packRef` supports:

- file path: `./packages/data-pack-base/pack.json`
- npm package: `npm:@scope/data-pack`
- npm package with explicit entry: `npm:@scope/data-pack#packs/base/pack.json`

When loading from npm package, loader reads package root `package.json` and uses:

- `arcadiaEternityPack` as manifest entry path, or
- default `pack.json` when field is missing.

## Lockfile

Base pack can generate its own `pack-lock.yaml`:

```bash
pnpm --filter @arcadia-eternity/data-pack-base run generate:lockfile
```

Current generator behavior:

- emits pnpm-like `importers` and `packages`
- records both `pack.json` and `assets.json` as separate package nodes
- uses `workspace:` source refs when package metadata is available
- computes `sha512-*` integrity from local manifest content
