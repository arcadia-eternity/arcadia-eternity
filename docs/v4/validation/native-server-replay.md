# Native input boundaries and server journal replay

The native host now waits for an actual input boundary. A Battle signals readiness after its normal or switch selection waiter is installed and its decision timers are activated. The signal lives in the existing transient wait container; snapshots rebuild it rather than serialize callbacks. Completion, cancellation and execution faults release pending waits.

`LocalBattleSystemV4.ready()` shares the first readiness promise with concurrent callers. `submitAction()` waits through turn resolution before accepting the next journal action. This prevents a restored input from being cleared by startup or submitted to the preceding execution phase. Selection restoration activates its existing timers without needing to re-emit `TurnAction`. The existing asynchronous-failure contract remains: completion and subsequent host calls report the failure. Server startup checks the native host afterward and preserves the original bootstrap/journal if recovery fails.

A successful surrender records the command through `setSelection` and then invokes the Battle's existing abandonment path. It ends once, without requiring a peer choice. This is needed by the server abandonment interface. Submissions after the end are rejected.

Validation on 2026-10-23:

- Host tests cover concurrent readiness, three completed turns submitted without host polling or prompt waits, immediate single-player surrender with one end event, and rejection of an immediate action after restoring an expired decision deadline. All 26 host cases pass, including the existing quiet restore, reconnect and asynchronous-failure cases.
- Real service startup/recovery replays five raw original-ID commands over two completed turns from the original initial snapshot, a partially submitted latest checkpoint, and a malformed latest checkpoint falling back to the original initial snapshot. Complete visible state and the serialized `sfc32-v1` state match uninterrupted play, with exactly five accepted commands and cursor 5. A fourth case keeps automatic callbacks enabled and exercises the actual service checkpoint writer before recovery.
- Startup rejection at either readiness or the subsequent state check fails recovery while retaining the original bootstrap. Unstarted Redis/metadata recovery compares complete original state and four actual skill identities; it does not rely on an empty pre-start action list.
- Server factory/service suites pass **56 tests**; the strengthened original-ID pair also passes separately. Six related core/content/host/snapshot/timer suites pass **101 tests**. Native core and server types, declarations, lint, provenance and historical audits pass. The server builds successfully.
- The real Node/Chrome HTTP probe again completes the identical seven-turn plan through fresh directories, with 1,065 native effects and zero legacy effect-DSL requests.

Evidence is under `/tmp/effect-native-oct23/native-readiness-*`. The first targeted run records the readiness and surrender failures against the previous host. Default server creation and browser/P2P cutover remain separate work; forced-switch and arbitrary in-flight snapshot export are not added by this change.
