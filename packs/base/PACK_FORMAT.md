# Base Content Pack Format

## Recommended Folder Layout

```text
<pack-root>/
  pack.json
  assets/
    assets.json
    *.png|*.jpg|*.webp|*.mp3|...
  data/
    mark*.yaml
    skill*.yaml
    groups/<group>/species.*.yaml
  src/effects/
    *.ts
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
- `assetsRef`: optional asset reference (`assets` directory, `assets.json`, or URL)
- `paths.dataDir`: base dir for `data.*` file lists
- `paths.localesDir`: base dir for locale files
- `dependencies`: dependent pack list, loaded before current pack
- `data.marks|skills|species`: YAML filenames relative to `dataDir`
- `data.effects`: empty in the native base pack; retained for legacy manifest compatibility
- `locales`: locale -> namespace list (namespace maps to `<localesDir>/<locale>/<namespace>.yaml`)

## Assets Manifests (optional but recommended)

Used for resource distribution (sprite/sfx/ui/bgm), and can be consumed directly by Web/Tauri runtime.

When `assetsRef` points to a directory (for example `assets`), loader will:

- prefer `assets/assets.json` as the default manifest
- also load additional `*.json` manifests in that directory (sorted, default first)
- keep non-manifest static files (images/audio) available for direct `iconRef/sfxRef/assetRef` usage

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

Hosts construct `NativePackLoader` with the selected content package's build identity and trusted content factory.

- `load(packRef)`: load metadata, validate references against compiled effects, and return the executable content catalog
- `loadMetadata(packRef)`: read editable species, skill, and mark data for layer composition or resource inspection
- `fromMetadata(data)`: validate and assemble composed or unsaved metadata

File loading also returns locale bundles, asset manifests, and lockfile diagnostics. Native effects are maintained in TypeScript; legacy effect YAML is kept only in regression fixtures.

## npm Pack Resolution

`packRef` supports:

- file path: `./packs/base/pack.json`
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
