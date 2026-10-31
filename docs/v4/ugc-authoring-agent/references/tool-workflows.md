# Author tool workflows

Start with `arcadia-content workspace <directory> describe` or MCP `workspace_describe`. Use the returned SDK API, capabilities and source revision. Opening or inspecting a project does not import its effect code.

The CLI emits JSON. `query`, `read`, `write` and `save` take JSON on stdin:

```sh
printf '%s' '{"file":"data/skills/strike.yaml"}' | arcadia-content workspace . read
arcadia-content workspace . check
arcadia-content workspace . test --execute
arcadia-content workspace . demo --execute
arcadia-content workspace . pack --execute
```

For file writes, pass `file`, `expectedVersion` and `text`; null version expects a new file. Prefer the coding assistant's normal file editing tools for TypeScript. The workspace watches the same directory, so changes become visible in the game. A failed version check means re-read the source and reconsider the change; do not retry a stale overwrite. Unsaved game forms remain in memory across object navigation. External changes require explicit field reconciliation followed by a separate save; the author can also discard drafts.

For structured edits, query content rows or `kind: locales` first, then use MCP `content_apply` or CLI `save` with `{ changes: [...] }`. Each change includes `kind: record | locale | create-record`, `file`, `expectedVersion` and the complete `record` value. `create-record` uses a new file under the corresponding data directory, a new ID and `expectedVersion: null`; it never overwrites an existing file. New locale files also use null, and may refer to an object created in the same batch. Definition changes retain their `index` (null for a single-object file); locale changes use the content `id`. Preserve unknown fields. `sharedFields` describes read-only YAML anchors, aliases and inherited values; do not detach them to bypass the guard. Edit shared definitions through an intentional external source change. Inspect `complete` and each file in `results`: same-file edits are grouped, but multiple files do not commit as one transaction. On partial success, retain uncommitted work and re-read before retrying.

MCP configuration launches the installed `arcadia-content-mcp` executable with the explicit project directory. `--execute` enables tests, demonstration battles and packaging for a trusted local project; `--read-only` hides writes and tasks that generate files, including checks. The official base package is always read-only in author sessions, even without the flag. Its legacy `pack.json` source layout is indexed directly. Desktop installed-package browsing uses `--published`: this forces read-only access and follows the package manifest’s built content/presentation artifacts, including embedded locales, instead of assuming editable source files are shipped. Inspect capabilities before proposing edits. The default transport is stdio. No external server or model account is required.

Use discovered tool names. Current tools include `workspace_describe`, `workspace_context`, `content_query`, `source_read`, `source_apply`, `content_apply`, `check_start`, `job_get` and `job_cancel`. Execution-enabled sessions also expose `test_start`, `preview_start` and `package_build`. Start returns a job ID; query until a terminal state. Read diagnostics and output. `stale: true` is an old-source result, not proof the current files pass. Cancel stops the task, not source edits.

Standalone MCP and desktop both operate on the same disk files. The desktop connection configuration supplies `--context-file` for live `workspace_context` reads; this optional file is outside the project under Electron userData. It refreshes on navigation/form changes and every 30 seconds, is removed when the workspace closes, and expires after 90 seconds without a refresh. The reader verifies the bound project root. Without this option, `workspace_context` reports `not-configured`. Drafts are context only: source reads still return disk files, and external writes trigger the desktop's external-change behavior. File version checks remain authoritative for saves. No distributed edit lock or cross-file transaction is promised.

Desktop projects default to the Electron userData `ugc/projects` directory; existing directories are opened in place. Use the returned root rather than guessing a platform path. Moving a project to another machine requires its SDK/dependencies there; source export does not bundle node_modules. Source project export and an npm content tgz have different purposes.

Build/check/test use the fixed author commands. A headless demo proves engine execution, not image/audio playback or interactive UI acceptance. npm publication and production deployment are separate tasks.
