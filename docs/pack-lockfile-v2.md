# Pack Lockfile v2 (Draft)

`pack-lock.yaml` adopts a pnpm-like shape and is the runtime source of truth for Web/Tauri/Server.

## Shape

- `lockfileVersion`
- `generatedAt`
- `importers`
- `packages`

`packages` snapshots include game-specific fields:

- `kind`: `data | asset`
- `engine`
- `entry` (`pack.json` / `assets.json`)
- `provenance` (`npm|workspace|file|git|http|builtin|unknown`)
- `resolution` (`integrity/resolved/path/tarball/commit`)

## Generator (MVP)

```bash
pnpm --filter @arcadia-eternity/pack-loader run generate:lockfile -- ./packages/data-pack-base/pack.json
```

This currently resolves local `dependencies[].path` and computes `sha512-*` integrity for local manifests.

For the built-in base pack:

```bash
pnpm --filter @arcadia-eternity/data-pack-base run generate:lockfile
```

Current behavior:

- root importer points at `workspace:<package>#pack.json`
- `assetsRef` becomes a separate `kind: asset` package node
- both nodes carry local `resolution.path` and `resolution.integrity`

## Runtime usability threshold

这套机制达到以下条件后，可以认为“可用”：

1. `server` 能从已安装包或 `builtin:base` 读取并强制校验 `pack-lock.yaml`
2. `web` 能从 `Pack Service` 读取 `pack-lock.yaml`，并在 mismatch 时阻止进入战斗
3. `tauri` 能消费本地安装目录或缓存目录里的同一份 lockfile
4. `pack-lock.yaml` 至少覆盖：
   - root data pack
   - `assetsRef` 关联的 asset pack
   - `version`
   - `entry`
   - `source`
   - `resolution.integrity`
5. 战斗房间与回放都只认 lockfile，不重新解依赖

在这之前，它是“可开发、可验证”，但还不是完整的发布态安装体系。
