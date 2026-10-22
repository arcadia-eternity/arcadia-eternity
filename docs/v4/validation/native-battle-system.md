# Native battle-system adapter

`LocalBattleSystemV4` is exported from `@arcadia-eternity/battle/v4/host` and implements the existing `IBattleSystem`. It delegates rules, selection validation, state/view serialization, timers and animations to the native Battle. The host module has no runtime dependency on the interface package, V2 or the old effect DSL.

```ts
const system = new LocalBattleSystemV4(battle, loaded.content)
const unsubscribe = system.BattleEvent(onMessage, { viewerId: playerId })
await system.ready()
await system.submitAction(selection)
```

`ready` starts execution without waiting for the action loop to end; repeated calls do not restart the game. The native-specific `waitForCompletion` observes that execution and reports asynchronous failure. Cleanup is idempotent, cancels an in-flight selection wait and drains the running task. Later active operations reject a disposed/failed system.

Each message registration has its own identity, including repeated callbacks registered for different views. Message and timer subscriptions follow a restored Battle and remain individually removable. View behavior, including the global debug visibility option, belongs to the existing core serializer.

The content authority only needs `snapshot(Battle)` and `restore(data)`, so the adapter is independent of official metadata construction. Its runtime envelope is `arcadia.battle.native.v4`. Version 2 contains the catalog-validated Battle snapshot and independent reconnect windows as JSON; the original version 1 envelope remains readable. Malformed input is validated before replacing the current instance. Recovery retains partially submitted selections and resumes without replaying start/turn effects. It preserves the core's active-identity guard: dispose the source before restoring that identity into a fresh system. This entry does not implement an in-place rewind of an active identity.

Validation on October 23:

- Nine adapter cases cover startup, view state, invalid actions, independent message/timer subscriptions, invalid restore atomicity, a partial-selection recovery through a fresh catalog, active-identity rejection, concurrent restore/cleanup, idempotent cleanup and asynchronous runtime failure. Every case checks attribute-system cleanup. The final related run passed 28 tests across adapter, real-battle port, RNG and official-content suites.
- V4 types, host/package declarations, source lint and the pack-host fixture's types pass. The adapter is included in the V4 type/lint gates.
- The real Node/Chrome native-package probe now uses `LocalBattleSystemV4` for readiness, action submission, subscriptions, runtime snapshot/restore and cleanup. Both runtimes complete the seven-turn game and fresh-directory continuation with identical event/HP/rage traces and zero effect-DSL requests.

Reconnect grace now implements the existing host start/cancel methods independently of decision timers, including when decision timers are disabled. It uses absolute deadlines, supports replacement/cancellation and clears all windows on battle end, cleanup or execution failure. Expiry delegates to the native abandonment path, producing the existing surrender result. It does not wait for a peer action or restart decision time. Restored windows stay quiet until `ready`; downtime does not extend the grace period.

Thirteen additional host cases bring this suite to **22 tests** and the related run to **71 passing tests**. They cover disabled/enabled decision timers, cancellation, replacement, immediate/nonfinite duration normalization, unknown players, invalid replacement atomicity, future/expired restored deadlines, cleanup/failure, malformed-window recovery preserving the original live battle/window and the earlier version-one envelope. Every case checks attribute cleanup; fake-timer cases also check all scheduled resources are released.

The real Node/Chrome probe now starts, saves, restores and cancels the same reconnect deadline in both the timed/animated and untimed complete games. Both continue through fresh content directories with identical game traces; the bundle contains 515 modules and makes zero effect-DSL requests. Source/test types, package declarations, pack fixture types and lint pass. Temporary evidence is under `/tmp/effect-native-oct23/`: `reconnect-final.log`, `reconnect-types.log`, `reconnect-lint.log`, `reconnect-declarations.log`, `reconnect-pack-types.log` and `reconnect-browser.log`.

Default server/client controllers have not switched yet. Enabled timers, active animations and deferred timer resets now recover at settled selection checkpoints, with [separate timer validation](native-timer-recovery.md) and a timed Node/Chrome host probe. Forced-switch/in-flight checkpoints, phase lifecycle and host-option compatibility remain integration work before that cutover.
