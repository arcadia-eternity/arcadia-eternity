# Desktop native runtime validation

## Follow-up: actual installed GUI

The 2026-11-05 follow-up uses a real macOS arm64 ZIP and ASAR application entry. Both first installation and same-version artifact replacement passed editing, hosting, shared management, identity/source/environment preservation and normal process shutdown with zero renderer or HTTP errors. Receipt SHA-256 is `3cd6a1e2b356d1fe468bbec83b1ab51ecfb13d493e4bdda494fea05fc21e67ce`. The exact receipt and observations are in `.omo/evidence/unified-management-followup-2026-11-05.json`; detailed scope is in `docs/v4/validation/unified-management-followup-2026-11-05.md`.

Better Auth is now pinned to 1.7.13 and its production test peer closure is removed. Applicable original jsondiffpatch license text was restored. The current strict gate retains two npm license blockers (`@npmcli/agent@4.0.2`, `@npmcli/redact@4.0.0`); it still reports releaseReady=false. The first installer/GUI CI found a Linux executable-name error and implicit external account discovery on both Macs. Both fixes are prepared and the local Mac ZIP GUI recheck passes with no external service API requests; new four-platform CI is pending. the historical RunAsNode passes below do not establish that result.

## Historical r3 preview verification

- Host: macOS arm64; Electron 41.10.7, embedded Node 24.18.0, module ABI 145.
- Native dependency: better-sqlite3 12.11.1.
- The actual Electron executable created a SQLite database with WAL, wrote data, closed it, reopened it and read the same data.
- Native staging rebuilds an isolated package copy. The source development addon remained byte-identical and still opened a database in system Node.
- Cached offline staging executes the same persistence probe. Corrupted cache bytes are rejected without invoking a rebuild/download.
- An escaping package-code symlink is rejected before its code executes.
- The final self-contained local preview completed electron-builder with exit 0 at 03:21 Asia/Shanghai on 2026-11-05. Both after-pack gates ran against its actual packaged executable and resources: SQLite write/close/reopen and the full managed-host test (1/1, 12.74 seconds; total test process 12.85 seconds).
- That full test covered real UGC npm installation, zero-copy adopted client materials, management preparation independent of play selection, anonymous management denial, drain/stop, retained materials and restart with the same server identity/default binding. The development SQLite addon hash and system-Node load check both passed afterward.
- An earlier clean-CI check exposed that the test packed an ignored local example `dist` directory. The fixture now copies only tracked package/content/source files into an empty temporary directory, explicitly compiles the example there and verifies its declared effect entry is present in the archive. npm lifecycle scripts remain disabled. The final preview's acceptance above uses this corrected fixture.
- The package builder now has `npmRebuild: false`; native rebuilding belongs only to isolated runtime staging.
- Preview resource lists are replaced through a complete builder configuration file, and exactly one resource entry owns `node_modules`. A disposable application-local renderer copy permits isolated web output without changing normal build directories. Missing runtime input returns a failing process exit code.
- Real offline pnpm 11 deployment reproduces source workspace metadata mutation. The staging wrapper restores the original metadata bytes on both success and failure. Its regression also checks the lockfile, manifests, `.modules.yaml` and development-addon marker bytes. Windows CLI resolution includes pnpm 11's `.mjs` entry.

The final portability, staging and pnpm-state regressions passed 24/24 tests, including pinned `PNPM_HOME` precedence on Windows; the opt-in actual-native suite passed both tests separately. The pure provenance validator checks 30 exact package records and 46 preserved-file hashes.

Final artifact: `packages/web-ui/release-preview/mac-arm64/Arcadia Eternity Preview.app`. Build log: `/private/tmp/arcadia-desktop-final-r3-package.log`; stage log: `/private/tmp/arcadia-desktop-final-r3-stage.log`. Server runtime snapshot: `/private/tmp/arcadia-desktop-runtime-final-20261105-r3`; renderer input: the frozen `packages/web-ui/dist`. The offline stage compiled the current CLI into its private temporary output and copied already-built workspace modules. Neither ordinary build directory was written. Packaged CLI files match the staged runtime, all 356 ASAR renderer files match that frozen renderer, all 62 packaged server files match `packages/server/dist`, and the ASAR main process matches the current source:

| Packaged file                           | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `arcadia-server/cli.js`                 | `c111f298fbaedc5fbb24ce8b3ea44fca6830b64fd6cfaac6b6f9e3c87c4679c9` |
| `arcadia-server/server-cli-DhqksZvk.js` | `b49b10c4cdbe70a3825c7e763457db8cc6d1ab498169654ed646c93e6fa4448a` |
| `app.asar/dist/index.html`              | `7208780f9133607aca9c4f3892f69c0d842c3f3617fda2918b5d0c34c6e9365b` |
| `app.asar/electron/main.mjs`            | `3a1ffe408462ec5e1ca450bf1c7c06b1a57e2d6dec3d19695c5955e4d20b0972` |

Source proof: `/private/tmp/arcadia-desktop-final-r3-source-proof-before.json` and `/private/tmp/arcadia-desktop-final-r3-artifact-proof.json` record before/after file hashes and complete file-tree comparisons. The frozen source includes host initialization markers, fixed initial revision/retention, resource-URL lifetime cleanup and the management operation-stage guard. Its renderer tree digest is `77c664b0334ed80cc1ac8f679a5f7e1fe81ec950b6c1d0df1341bfff1898d1da`; server tree digest is `73d6bd89a4fec5ab0f15279056198965d353151a6b0bbd1e0c4d88758fa5dc91`. Each tree digest hashes the JSON array of `[relativePath, fileSha256]` entries from a name-sorted recursive traversal.

The development addon stayed at SHA-256 `c6fac315df023cf5efec45a3511e6515c6b0f7461a4a284b1b7a79c7ef8febe7` and successfully opened SQLite in system Node afterward. Source workspace state stayed at `cc5c488f0bdb8dc61f0936176b4bd5c6706a6d01a83c588273e5878d8f29a503`, with `dev: true` before and after. `.modules.yaml`, lockfile, package manifests and every recorded source file were also byte-identical. This final packaging run made no source changes.

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

- The final personal Challenge browser acceptance passed 1/1: two clean browser clients imported and edited UGC teams, completed a battle and a same-room rematch, and displayed opposite outcomes in both rounds. Its acceptance JSON records two turns in each round and 292 server-worker samples with a maximum of zero. Evidence: `packages/web-ui/test-results/personal-environment/2026-11-04T19-16-06-975Z/personal-environment-unpub-3e8f7-h-a-real-battle-and-rematch/acceptance.json`, with adjacent traces/screenshots. This is browser acceptance, separate from the native packaged-host check.
- The final preview above uses the subsequent frozen server/UI snapshot with the initialization and resource-lifetime fixes recorded in its source proof.
- The nonpublishing GitHub Actions matrix targets macOS arm64/x64, Linux x64 and Windows x64. It stages on the real target and runs both raw SQLite and opt-in full packaged-host checks. The first run (41886687641) exposed Windows build-path handling and pnpm deployment's source-state mutation. Fixes and regression checks are prepared; a fresh four-platform run is still required. Linux's first run passed native SQLite and staging before its later packaging invocation encountered the pnpm-state problem. Simulated Windows path tests do not constitute Windows acceptance.
- The second run (41889173077) reached the packaged-host test after packaging and SQLite validation on Linux and both macOS architectures, then exposed the clean-example fixture gap described above. Windows also found a test assertion using a fixed POSIX path; it now uses a native absolute temporary path, with staging tests passing 6/6 locally. A fresh target-platform run remains required after these test fixes and the pinned-pnpm selection correction.
- The run (41898956401, head `20fde`) passed the complete packaging, packaged SQLite and managed-host checks on Linux x64, macOS x64 and macOS arm64. Windows passed staging, but its final package audit rejected an absolute `css-calc` junction before packaged execution.

## Windows copied-link correction

Installed `builder-util@26.15.3` `copyDir` (`out/fs.js:245–263`) recreates Windows links with type `junction`. Node's `preprocessSymlinkDestination` resolves that junction text relative to the destination link's parent, making an originally relative package-local link absolute. The installed copier regression demonstrates this target identity directly: the copied `css-calc` link resolves inside the packaged output and differs from the original staged target. On Windows the regression uses actual junction syscalls; on POSIX it simulates only Node's Windows junction preprocessing while running the real Builder copier.

The Windows after-pack hook now checks lexical containment inside Builder's `appOutDir`, rejects linked root/parent directories through that boundary, and invokes the existing complete link preflight before any normalization. Only already-contained absolute links become relative. Staging/external targets, dangling targets and indirect escapes remain failures; no target is guessed or rebased. The original strict layout, native and license checks still follow. POSIX verification does not normalize or change links.

The final r3 runtime contains 1,359 directory symlinks and no file symlinks. The new regression removes the original staged tree, moves the application so its former path is also absent, and verifies the dependency remains readable and passes the strict layout gate. Additional tests cover failure without partial mutation, linked runtime/resources/output directories, a permitted ancestor alias above the trusted output boundary, Windows path casing and unchanged POSIX behavior. The combined staging/portability suite passed 24/24; both changed JavaScript files passed lint and formatting. Log: `/private/tmp/arcadia-windows-copier-regression.log`. Independent review found no remaining required changes. These local checks do not replace the next actual Windows CI run.

The preview command accepts `--web-dist <directory>` and `--runtime <directory>` so validation does not reserve or overwrite normal renderer build output.
