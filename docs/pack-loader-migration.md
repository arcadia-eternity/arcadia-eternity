# Pack Loader Migration (v2)

## Goal

Replace `fsloader` / `httploader` old-model loading (`DataRepository + parser(v1)`) with a unified pack-based loader for v2.

## Current Status

- Added new package: `@arcadia-eternity/pack-loader`
- Implemented MVP node source (`node-fs`) based on v2 pack pipeline.
- CLI `online` / `local` commands now use pack preflight (`builtin:base`) for data validation.

## Design

Single API surface:

1. `PackLoader.load(packRef, options)`
2. `PackLoader.summarize(result)`

`PackLoader` output:

1. `repository` (`V2DataRepository`)
2. `pack` manifest
3. `locales`
4. `errors`

## Migration Plan

1. CLI done (preflight + strict validation via pack loader).
2. Server resource loading manager: switch from `fsloader` to `pack-loader`.
3. Web client data bootstrap: add `http` source in `pack-loader`, replace `httploader`.
4. Remove parser-v1 dependency from `fsloader`/`httploader`.
5. Deprecate and delete `fsloader`/`httploader`.

## Constraints

1. Runtime battle creation should consume v2 repository / pack pipeline only.
2. Keep pack ref semantics unified (`builtin:base`, `npm:...`, file path).
3. `http` source must support workshop/CDN distribution model (deferred to phase 3).
