import type { Arena } from 'quickjs-emscripten-sync'

/** Version adapter for quickjs-emscripten-sync 1.11.0 (pinned in package.json).
 * Arena.unregister only releases explicit identity registrations: its automatic
 * marshalling map also owns views, accessors and callback handles. Keep this
 * integration here until Arena exposes a public scoped-lifetime API.
 */
/** Marshal the projection exactly as expose() does, without a temporary global.
 * The identity table owns a separate handle from the automatic marshalling map,
 * just as register(original, code) owns the handle returned by evalCode(code).
 */
export function registerArenaProjection(arena: Arena, original: object, view: object): void {
  if (arena._registeredMap.has(original)) return
  const [handle, disposable] = arena._marshal(view)
  const identity = disposable ? handle : handle.dup()
  try {
    arena.register(original, identity)
    // Handle registrations normally borrow ownership. Match the string overload
    // so unregister(original) releases this copy even at a callback boundary.
    if (arena._registeredMap.get(original) !== identity) throw new Error('Effect projection could not be registered')
    arena._registeredMapDispose.add(original)
  } catch (error) {
    if (identity.alive) identity.dispose()
    throw error
  }
}

export function checkpointArena(arena: Arena) {
  return {
    marshalled: new Set(arena._map.keys()),
    registered: new Set(arena._registeredMap.keys()),
    synchronized: new Set(arena._sync),
    transient: new Set(arena._transientHandles),
  }
}
export type ArenaCheckpoint = ReturnType<typeof checkpointArena>

/** Called only after the native battle and its subscriptions have cleaned up. */
export function releaseArenaSession(arena: Arena, checkpoint: ArenaCheckpoint): void {
  for (const key of [...arena._registeredMap.keys()]) if (!checkpoint.registered.has(key)) arena.unregister(key, true)
  for (const key of [...arena._map.keys()]) if (!checkpoint.marshalled.has(key)) arena._map.delete(key, true)
  for (const value of arena._sync) if (!checkpoint.synchronized.has(value)) arena._sync.delete(value)
  arena._temporalSync.clear()
  for (const handle of arena._transientHandles)
    if (!checkpoint.transient.has(handle)) {
      arena._transientHandles.delete(handle)
      if (handle.alive) handle.dispose()
    }
  if (
    arena._map.size !== checkpoint.marshalled.size ||
    arena._registeredMap.size !== checkpoint.registered.size ||
    arena._sync.size !== checkpoint.synchronized.size ||
    arena._transientHandles.size !== checkpoint.transient.size
  )
    throw new Error('Effect session did not release its Arena references')
}
