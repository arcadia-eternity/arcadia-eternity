# Content-pack development tool

`@arcadia-eternity/content-dev` owns the reusable author tooling in the main repository. Its `arcadia-content` executable is installed as a development dependency of a content pack; templates contain data, effects, scenario configuration and behavior tests.

```json
{
  "scripts": {
    "check": "arcadia-content check",
    "build": "arcadia-content build",
    "rename": "arcadia-content rename",
    "demo": "npm run build && arcadia-content demo",
    "pack": "arcadia-content pack"
  }
}
```

Commands use the caller's working directory. `check` checks `tsconfig.json` and recursive JSON/YAML sources in `data/{species,skills,marks,behaviors}`. `build` compiles TypeScript and generates `dist/content.json`. `rename --name ... --project-id ... --namespace ...` changes local structured references while preserving foreign references, content IDs and YAML comments. `pack` checks, builds and runs `npm pack --ignore-scripts`.

`demo` loads `arcadia.config.mjs`, whose default export supplies `players({ namespace, manifest })`: two ordinary player input records understood by the battle SDK. It packs the project, installs the artifact in a temporary npm project and runs a deterministic local battle using each player's first skill. It fails on effect errors or if the battle exceeds 40 turns. The configuration and behavioral assertions belong to the content pack.

Tests can import `prepareContentPack`, `attack`, `nextTurn`, `cancelled` and `runBattle` from `@arcadia-eternity/content-dev/testing`. `prepareContentPack(root = process.cwd(), { offline = true, cache })` loads that config and returns the installed `environment`, `manifest`, packed `files`, `createBattle(seed)`, `track(battle)` and async `dispose()`. The harness admits code only in the temporary local-development project. It uses the normal npm cache by default; `cache` selects an explicit cache directory. It defaults to offline artifact installation; packs with runtime dependencies need a populated cache or an explicit `{ offline: false }`.

## YAML sharing in author workspaces

Source workspaces and content/locale builds resolve anchors, aliases and `<<` merges with the existing `yaml` library. Snapshot records include `sharedFields`: record-relative paths, the sharing reason (`anchor`, `alias`, or `merge`), anchor name, document-relative definition path and one-based source line/column.

Forms display shared values read-only and can open their definition in an external editor. This includes referenced anchor definitions themselves. Explicit local overrides of merged fields remain editable. Collection controls that would replace a subtree containing shared nodes are disabled. `saveRecord` independently checks the current document's sharing metadata, rejects shared changes with `SHARED_FIELD_READ_ONLY`, edits independent YAML nodes, and verifies both resulting values and anchor/alias structure before writing. No-op saves preserve the original text; other saves may normalize formatting and do not promise byte-for-byte preservation.

Source-text editing (external editors and version-checked CLI/MCP writes) remains available for intentionally changing sharing. External changes invalidate stale form saves. Unresolved aliases, cycles and excessive alias expansion produce diagnostics without rewriting the source. This does not add cross-file YAML anchors, automatic shared edits, or detach/override actions to forms. Localized names/descriptions resolve sharing when read, edited and built; shared text fields remain read-only in forms.

## Before npm publication

The tool and SDK are not published npm releases. Build and stage them from a trusted checkout:

```sh
pnpm --filter @arcadia-eternity/content-dev... run build
node scripts/stage-author-sdk.mjs /new/author-sdk
cd /path/to/content-pack
node /path/to/main-repo/packages/content-dev/src/setup.mjs --sdk-dir /new/author-sdk
```

The installer checks the seven artifact checksums and API/build identities, installs the tool and SDK together without changing the pack's package metadata or creating a lockfile, and records the installation under `.arcadia/`.

The template's initial `setup` entry fetches this repository's `src/setup.mjs` from the exact revision in `arcadia-sdk.json`. This standalone installer uses only Node built-ins. It builds the pinned source with its lockfile, stages the development tool and SDK, and installs them. There is no copied installer in the template. After installation, `npm exec --offline -- arcadia-content setup --sdk-dir ... --offline` supports cached/offline updates. Once these packages are formally released, normal npm installation can replace the initial source bootstrap.

## Object drafts and reviewed saves

The desktop workbench keeps definition and localized name/description drafts while navigating between species, skills, marks and resource usages. References are selected from existing project content. Source paths live in expandable details; code, file organization, content creation/deletion and resource import/replacement remain external workflows. Descriptions use the existing FormatJS renderer with current draft values and mark links. Missing or ambiguous language files must be resolved externally; the form can add a name/description entry for an existing object to an existing language file.

`snapshot.localeSources` exposes language, namespace, file revision, text entries and shared-field provenance. `workspace.saveChanges({ changes })`, session operation `save`, CLI `workspace <directory> save` and MCP `content_apply` share the same structured save path. Each change supplies `kind: record | locale`, `file`, `expectedVersion`, and the complete `record`; definition changes also supply the original `index` (or null), and locale changes supply `id`. The service prepares all changes before writing, combines edits to the same file, and reports `{ complete, results }` with individual saved file revisions. Files commit separately: on failure, already-saved files remain saved and remaining drafts must be retained. This is not a cross-file transaction.

External changes refresh clean views. Dirty sources pause saving and show original/draft/latest values. Every locally changed field requires an explicit choice; untouched fields take the latest source value. Reconciliation updates the draft and its base revision only, and requires a separate save review. Missing, invalid or ambiguous sources keep the draft blocked. A uniquely identified object moved to another source can adopt that location after explicit reconciliation; the old file is never recreated by a form save.
