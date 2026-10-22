# Native server creation and pinned recovery

The server runtime factory now has an explicit native creation branch. It loads metadata through `NativePackLoader`, constructs the compiled TypeScript effect directory, and returns an unstarted `LocalBattleSystemV4`. The descriptor records the public core/registry build identity, content revision, and actual initial snapshot. Both teams' schemas and prototype references are validated before allocating either team. Imported draft pet IDs receive independent battle identities; caller data is preserved.

Native creation persists its complete descriptor to Redis and room metadata before publishing the local instance. At least one store must succeed. Recovery selects the implementation from this descriptor, checks the pinned build/content revision and restores the original instance IDs. Historical untagged records select V2; damaged native records do not acquire that default. Recovery preserves the original bootstrap instead of replacing it with newly generated IDs.

The checkpoint reader accepts V2 world v2 and native v1/v2 frames. Native recovery uses a compatible latest checkpoint only when its action sequence does not exceed the journal or an unfinished phase's replay baseline. Otherwise it restores the original initial snapshot before replay. A failed latest restore also falls back to that same native initial state. Native startup bypasses the old DSL resource readiness gate and preserves restored reconnect deadlines. Default creation still selects V2 pending native input/readiness and multi-turn service replay acceptance.

Validation on 2026-10-23:

- Server factory and service: **50 tests passed**, including the unchanged 21 legacy assertions. Native cases cover original IDs, rule configuration fallback, malformed input, build/revision mismatch, persistence before publication, Redis/metadata recovery, failed storage, damaged bootstrap refusal, latest-checkpoint recovery without duplicate actions, and an unfinished phase requiring initial-state replay. Tests verify that both persisted recovery fixtures are actually readable before dropping the source.
- The expanded server test type project passes, including the service test file. Native factory/runtime and service source lint pass. Server code and declarations build successfully.
- Related native core, content, host, initial/selection snapshots and timer suites: **97 tests passed** across six files. Each native service case checks attribute ownership and zero remaining scheduled timers.
- Actual Node and Chrome HTTP pack probe: 1,065 effects, identical seven-turn continuation through fresh directories, initial and animated/timed/reconnect restoration, and zero old effect-DSL requests. Provenance and historical parser audit checks pass.

The service tests now release the V2 instances they replace and clean up their services. This exposed a V2 stop race: stopping during startup/switch execution could enter a new human decision poll afterward. The orchestrator now checks its stopped state after those waits. Service shutdown also flushes player and spectator message batches. The first expanded run reproduced the race as a teardown timeout; the corrected run passes without clearing timers to hide leaks.

Local evidence: `/tmp/effect-native-oct23/server-pin-{final-tests,core-tests,final-types,final-lint,build,browser,provenance,audit}.log`. Earlier diagnostic logs retain the ignored-native-checkpoint assertion and lifecycle failures. This checkpoint does not claim native default cutover or full multi-turn server journal replay.
