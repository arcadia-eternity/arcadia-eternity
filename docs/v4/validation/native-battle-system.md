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

The content authority only needs `snapshot(Battle)` and `restore(data)`, so the adapter is independent of official metadata construction. Its runtime envelope is `arcadia.battle.native.v4`, version 1, containing the existing catalog-validated Battle snapshot as JSON. Malformed input is validated before replacing the current instance. Recovery retains partially submitted selections and resumes without replaying start/turn effects. It preserves the core's active-identity guard: dispose the source before restoring that identity into a fresh system. This entry does not implement an in-place rewind of an active identity.

Validation on October 23:

- Nine adapter cases cover startup, view state, invalid actions, independent message/timer subscriptions, invalid restore atomicity, a partial-selection recovery through a fresh catalog, active-identity rejection, concurrent restore/cleanup, idempotent cleanup and asynchronous runtime failure. Every case checks attribute-system cleanup. The final related run passed 28 tests across adapter, real-battle port, RNG and official-content suites.
- V4 types, host/package declarations, source lint and the pack-host fixture's types pass. The adapter is included in the V4 type/lint gates.
- The real Node/Chrome native-package probe now uses `LocalBattleSystemV4` for readiness, action submission, subscriptions, runtime snapshot/restore and cleanup. Both runtimes complete the seven-turn game and fresh-directory continuation with identical event/HP/rage traces and zero effect-DSL requests.

Default server/client controllers have not switched yet. Enabled timer recovery at settled selection checkpoints now passes its [separate timer validation](native-timer-recovery.md), including the timed Node/Chrome host probe. Active-animation checkpoints, phase lifecycle/reconnection and host-option compatibility remain integration work before that cutover.
