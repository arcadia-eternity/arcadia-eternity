# Data Editor Save & Load Architecture

## Modes Matrix

| Mode         | Runtime           | Game Data Load     | Editor Data Load | Save Path          |
| ------------ | ----------------- | ------------------ | ---------------- | ------------------ |
| Web Dev      | Vite + Browser    | PackLoader HTTP    | N/A              | N/A                |
| Web Prod     | Static + Browser  | PackLoader HTTP    | N/A              | N/A                |
| Electron Dev | Vite + Electron   | PackLoader HTTP    | **IPC (disk)**   | IPC → source dir   |
| Electron App | Packaged Electron | PackLoader HTTP    | **IPC (disk)**   | IPC → userData dir |
| Server       | Node.js           | PackLoader node-fs | N/A              | N/A                |
| CLI          | Node.js           | PackLoader node-fs | N/A              | N/A                |

**Key**: Editor data loading is separate from game data loading. Editor reads directly from disk via IPC — no HTTP, no Vite cache, no PackLoader.

## Save Flow

```
User presses Ctrl+S or save button
  → doSave() in DataEditorPage.vue
    → Memory write: clone draft → gameDataStore
    → Disk write:
        find existing record index by row.id
        parse YAML from disk
        upsert record at found index (update existing), or append (new)
        stringify YAML
        IPC writeBasePackFile() → main process → fs.writeFile to source dir
    → isDirty = false
    → ElMessage.success('已保存')
    → reloadDataFromDisk(): IPC readAllBasePackData() → replace gameDataStore
```

## Load Flow (Editor)

```
Editor mounts (onMounted)
  → gameDataStore.initialize()  (populated by App.vue bootstrap)
  → reloadDataFromDisk():
      IPC readAllBasePackData()
        → main process:
            read base pack manifest (pack.json)
            for each kind (species, skills, marks, effects):
              read all listed YAML files
              parse YAML with merge: true
              return concatenated record arrays
      → replace gameDataStore.byId and .allIds
```

## IPC Handlers

| Channel                           | Direction       | Purpose                                              |
| --------------------------------- | --------------- | ---------------------------------------------------- |
| `desktop:read-all-base-pack-data` | renderer → main | Read all pack data files, parse YAML, return objects |
| `desktop:write-base-pack-file`    | renderer → main | Write a single data file to source directory         |
| `desktop:read-base-pack-file`     | renderer → main | Read a single data file from source directory        |
| `desktop:get-base-pack-dir`       | renderer → main | Get base pack source directory path                  |
| `desktop:show-item-in-folder`     | renderer → main | Open Finder at specified path                        |

## Why IPC instead of HTTP

In Electron dev mode, the renderer runs inside Vite's dev server. Data files served through Vite (via `viteStaticCopy` or module imports) are cached and do not reflect on-disk changes. Even the Electron local HTTP server path can be cached by the browser.

Using IPC eliminates all caching layers:

- No Vite module cache
- No viteStaticCopy stale copies
- No browser HTTP cache
- Same mechanism as save (symmetry)

## Vite Config

```ts
server: {
  watch: {
    ignored: ['**/packs/**'],  // prevent HMR on data file saves
  },
},
// viteStaticCopy:
watch: {
  reloadPageOnChange: false,  // don't reload page on data file changes
},
```

## Cache-Control

All pack data files served by the Electron local HTTP server use `Cache-Control: no-store` to prevent Electron's web content from caching responses.

## Dev vs App Mode

In dev mode (`devServerUrl` is set):

- `ensureWorkspaceBasePack()` is skipped — no copy to userData
- Base pack data served from source directory (findBundledBasePackDir)
- Base pack injected into workspace manifest from source
- Save writes to source directory

In app mode (packaged):

- `ensureWorkspaceBasePack()` copies base pack to userData on first launch
- All pack files served from userData
- Save writes to userData

## File Locations

|              | Dev Mode                                                | App Mode                   |
| ------------ | ------------------------------------------------------- | -------------------------- |
| Source dir   | `{projectRoot}/packs/base/`                             | Bundled in app (read-only) |
| userData dir | `~/Library/Application Support/arcadia-eternity/packs/` | Same                       |
| Save target  | Source dir                                              | userData dir               |
| Load target  | Source dir (via IPC)                                    | userData dir (via IPC)     |
