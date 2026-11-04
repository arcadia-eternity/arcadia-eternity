# Desktop native runtime validation

## Verified locally

- Host: macOS arm64; Electron 41.10.7, embedded Node 24.18.0, module ABI 145.
- Native dependency: better-sqlite3 12.11.1.
- The actual Electron executable created a SQLite database with WAL, wrote data, closed it, reopened it and read the same data.
- Native staging rebuilds an isolated package copy. The source development addon remained byte-identical and still opened a database in system Node.
- Cached offline staging executes the same persistence probe. Corrupted cache bytes are rejected without invoking a rebuild/download.
- An escaping package-code symlink is rejected before its code executes.
- The first local preview package completed electron-builder and its actual packaged-executable SQLite probe. Its bundled CLI also started with `--help` using packaged resources.
- A separate current-code integration used that actual packaged Electron executable with the fresh isolated server/npm runtime. The full managed-host test passed in 13.3 seconds: real UGC npm installation, zero-copy adopted client materials, management preparation independent of play selection, anonymous management denial, drain/stop, retained materials and restart with the same server identity/default binding. The development SQLite addon hash and system-Node load check both passed afterward.
- The package builder now has `npmRebuild: false`; native rebuilding belongs only to isolated runtime staging.

The latest quick checks passed 30 tests; the opt-in actual-native suite passed both tests separately. The pure provenance validator checks 30 exact package records and 46 preserved-file hashes. JavaScript ESLint and whitespace checks passed for the owned packaging scripts.

## Licensing

The initial staged runtime had 39 unresolved inventory records. Exact original package-text recognition, legacy metadata handling, preserved copyright notices and version-bound upstream source notices reduce that to five:

| Package | Remaining evidence gap |
| --- | --- |
| `@better-auth/utils@0.5.0` | No complete applicable original notice established at the published source commit. |
| `@npmcli/agent@4.0.2` | No complete applicable original notice established; an unrelated fixture license is not substituted. |
| `jsondiffpatch@0.7.6` | No complete original notice in the exact published source tree. |
| `stackback@0.0.2` | No complete original notice in the exact release tree. |
| `@npmcli/redact@4.0.0` | Exact release metadata declares ISC, while the published and same-commit upstream LICENSE is MIT. |

The inventory preserves source URLs, commits, registry integrity, original text hashes and unresolved source-audit evidence. Unknown package identities, changed declarations, changed bytes, omitted referenced terms and unresolved reviews do not clear the gate. No generic license text replaces a missing project notice. `releaseReady` remains `false`; no release was published.

## Outstanding final integration

- The real personal Challenge browser acceptance passed 1/1: two clean browser clients imported and edited UGC teams, completed a battle and a same-room rematch, and displayed opposite outcomes in both rounds. Its acceptance JSON records 279 server-worker samples with a maximum of zero. Evidence: `packages/web-ui/test-results/personal-environment/2026-11-04T18-07-25-638Z/personal-environment-unpub-3e8f7-h-a-real-battle-and-rematch/acceptance.json`, with adjacent traces/screenshots. This is browser acceptance, separate from the native packaged-host check.
- Root is rebuilding the final CLI/web snapshot after that acceptance and two label corrections. The final preview must use that final server runtime and `/private/tmp/ae-personal-web-current`; earlier preview evidence does not claim the final UI/server snapshot.
- The nonpublishing GitHub Actions matrix is prepared for macOS arm64/x64, Linux x64 and Windows x64. It stages on the real target and runs both raw SQLite and opt-in full packaged-host checks. Cross-platform execution remains pending the root branch push; simulated Windows path tests are not Windows acceptance.

The preview command accepts `--web-dist <directory>` and `--runtime <directory>` so validation does not reserve or overwrite normal renderer build output.
