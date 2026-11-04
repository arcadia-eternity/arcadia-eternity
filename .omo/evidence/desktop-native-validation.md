# Desktop native runtime validation

## Verified locally

- Host: macOS arm64; Electron 41.10.7, embedded Node 24.18.0, module ABI 145.
- Native dependency: better-sqlite3 12.11.1.
- The actual Electron executable created a SQLite database with WAL, wrote data, closed it, reopened it and read the same data.
- Native staging rebuilds an isolated package copy. The source development addon remained byte-identical and still opened a database in system Node.
- Cached offline staging executes the same persistence probe. Corrupted cache bytes are rejected without invoking a rebuild/download.
- An escaping package-code symlink is rejected before its code executes.
- The final self-contained local preview completed electron-builder with exit 0 on 2026-11-05. Both after-pack gates ran against its actual packaged executable and resources: SQLite write/close/reopen and the full managed-host test (1/1, 13.14 seconds).
- That full test covered real UGC npm installation, zero-copy adopted client materials, management preparation independent of play selection, anonymous management denial, drain/stop, retained materials and restart with the same server identity/default binding. The development SQLite addon hash and system-Node load check both passed afterward.
- The package builder now has `npmRebuild: false`; native rebuilding belongs only to isolated runtime staging.
- Preview resource lists are replaced through a complete builder configuration file, and exactly one resource entry owns `node_modules`. A disposable application-local renderer copy permits isolated web output without changing normal build directories. Missing runtime input returns a failing process exit code.
- Real offline pnpm 11 deployment reproduces source workspace metadata mutation. The staging wrapper restores the original metadata bytes on both success and failure. Its regression also checks the lockfile, manifests, `.modules.yaml` and development-addon marker bytes. Windows CLI resolution includes pnpm 11's `.mjs` entry.

The final portability, staging and pnpm-state regressions passed 23/23 tests; the opt-in actual-native suite passed both tests separately. The pure provenance validator checks 30 exact package records and 46 preserved-file hashes.

Final artifact: `packages/web-ui/release-preview/mac-arm64/Arcadia Eternity Preview.app`. Build log: `/private/tmp/arcadia-desktop-final-package.log`. Server source snapshot: `/private/tmp/arcadia-desktop-runtime-final-20261105-r2`; renderer snapshot: `/private/tmp/ae-personal-web-current`. Packaged CLI files match the staged runtime, the ASAR renderer entry matches that final renderer, and the ASAR main process matches the current source:

| Packaged file                           | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `arcadia-server/cli.js`                 | `6a0d62abe610115e490b7f2e69dd946a35a2701f1906af6f1eaa2eb16fed7404` |
| `arcadia-server/server-cli-DGVzgyVM.js` | `56a5907b282c9dab7bc0dfa0648169dfe9376f869a4fa86246fa4c44397ddcd4` |
| `app.asar/dist/index.html`              | `422e125247069f276f31d61a096aab3f64c58bf3a271f827a07811d2477b11f4` |
| `app.asar/electron/main.mjs`            | `3a1ffe408462ec5e1ca450bf1c7c06b1a57e2d6dec3d19695c5955e4d20b0972` |

## Licensing

The initial staged runtime had 39 unresolved inventory records. Exact original package-text recognition, legacy metadata handling, preserved copyright notices and version-bound upstream source notices reduce that to five:

| Package                    | Remaining evidence gap                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@better-auth/utils@0.5.0` | No complete applicable original notice established at the published source commit.                   |
| `@npmcli/agent@4.0.2`      | No complete applicable original notice established; an unrelated fixture license is not substituted. |
| `jsondiffpatch@0.7.6`      | No complete original notice in the exact published source tree.                                      |
| `stackback@0.0.2`          | No complete original notice in the exact release tree.                                               |
| `@npmcli/redact@4.0.0`     | Exact release metadata declares ISC, while the published and same-commit upstream LICENSE is MIT.    |

The inventory preserves source URLs, commits, registry integrity, original text hashes and unresolved source-audit evidence. Unknown package identities, changed declarations, changed bytes, omitted referenced terms and unresolved reviews do not clear the gate. No generic license text replaces a missing project notice. `releaseReady` remains `false`; no release was published.

The dependency audit identifies one concrete graph-level remediation: `stackback` is reached through Better Auth's optional Vitest peer and its test-only `why-is-node-running` dependency. Production-closure pruning could remove that chain after a separate dependency review; it was not removed during this packaging validation. The other four are on active authentication, battle-state or bundled npm installation paths. They require an applicable original upstream notice, corrected upstream release, or a reviewed upgrade/replacement. No supported substitute notice was established for the currently pinned versions.

## Browser and cross-platform integration

- The real personal Challenge browser acceptance passed 1/1: two clean browser clients imported and edited UGC teams, completed a battle and a same-room rematch, and displayed opposite outcomes in both rounds. Its acceptance JSON records 279 server-worker samples with a maximum of zero. Evidence: `packages/web-ui/test-results/personal-environment/2026-11-04T18-07-25-638Z/personal-environment-unpub-3e8f7-h-a-real-battle-and-rematch/acceptance.json`, with adjacent traces/screenshots. This is browser acceptance, separate from the native packaged-host check.
- The final preview above uses the final server/UI snapshot after that acceptance and the CLI/operation label corrections.
- The nonpublishing GitHub Actions matrix targets macOS arm64/x64, Linux x64 and Windows x64. It stages on the real target and runs both raw SQLite and opt-in full packaged-host checks. The first run (41886687641) exposed Windows build-path handling and pnpm deployment's source-state mutation. Fixes and regression checks are prepared; a fresh four-platform run is still required. Linux's first run passed native SQLite and staging before its later packaging invocation encountered the pnpm-state problem. Simulated Windows path tests do not constitute Windows acceptance.

The preview command accepts `--web-dist <directory>` and `--runtime <directory>` so validation does not reserve or overwrite normal renderer build output.
