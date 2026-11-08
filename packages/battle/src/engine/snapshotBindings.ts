/** Runtime-only descriptions for reconstructing known bindings. Functions never enter JSON. */
const cleanupBindings = new WeakMap<() => void, object>()
const modifierCleanups = new WeakMap<object, WeakMap<object, () => void>>()
export function describeCleanup(cleanup: () => void, binding: object): void {
  cleanupBindings.set(cleanup, binding)
}
export function getCleanupBinding(cleanup: () => void): object | undefined {
  return cleanupBindings.get(cleanup)
}
export function rememberModifierCleanup(target: object, modifier: object, cleanup: () => void): void {
  describeCleanup(cleanup, { type: 'modifier', target, modifier, active: true })
  if (!modifierCleanups.has(target)) modifierCleanups.set(target, new WeakMap())
  modifierCleanups.get(target)!.set(modifier, cleanup)
}
export function getModifierCleanup(target: object, modifier: object): () => void {
  const cleanup = modifierCleanups.get(target)?.get(modifier)
  if (!cleanup) throw new Error('Snapshot modifier cleanup has no restored registration')
  return cleanup
}

export function deactivateCleanup(cleanup: () => void): void {
  const binding = cleanupBindings.get(cleanup)
  if (binding) Reflect.set(binding, 'active', false)
}

export function noopCleanup(): void {}
describeCleanup(noopCleanup, { type: 'noop' })
