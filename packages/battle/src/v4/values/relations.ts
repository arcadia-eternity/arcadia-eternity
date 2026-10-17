import type { Player } from '../player'
import type { Pet } from '../pet'
import { Signal } from '../reactiveValue'

const activePets = new WeakMap<Player, Signal<Pet>>()

/** Keep the existing own, enumerable snapshot field and synchronous assignment semantics. */
export function initializePlayerRelations(player: Player): void {
  if (activePets.has(player)) return
  const signal = new Signal(player.activePet)
  activePets.set(player, signal)
  Object.defineProperty(player, 'activePet', {
    enumerable: true,
    configurable: true,
    get: () => signal.value,
    set: (pet: Pet) => signal.next(pet),
  })
}
