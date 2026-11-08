import type { Player } from '../player'
import type { Pet } from '../pet'
import type { MarkInstance } from '../mark'
import { Signal, untracked } from '../reactiveValue'

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

const owners = new WeakSet<object>()
const collections = new WeakSet<Pet>()
/** Domain relation fields stay enumerable for the explicit snapshot ledger. */
export function initializeOwnerRelations(source: { owner: unknown }): void {
  if (owners.has(source)) return
  owners.add(source)
  const signal = new Signal(source.owner)
  Object.defineProperty(source, 'owner', {
    enumerable: true,
    configurable: true,
    get: () => signal.value,
    set: (owner: unknown) => signal.next(owner),
  })
}

export function initializePetRelations(pet: Pet): void {
  initializeOwnerRelations(pet)
  if (collections.has(pet)) return
  collections.add(pet)
  const revision = new Signal(0)
  const publish = () => revision.next(untracked(() => revision.value) + 1)
  let marks: MarkInstance[]
  const wrap = (input: MarkInstance[]) => {
    const changed = () => {
      if (marks === proxy) publish()
    }
    // Mutating array methods publish once, after the whole membership transition.
    const mutators = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])
    // Membership belongs to the Pet; callers mutate the returned handle, not an assigned raw array.
    const proxy: MarkInstance[] = new Proxy(input.slice(), {
      get(array, key, receiver) {
        if (typeof key === 'string' && mutators.has(key)) {
          return (...args: unknown[]) => {
            const method = Reflect.get(array, key) as (...args: unknown[]) => unknown
            const result = method.apply(array, args)
            changed()
            return result === array ? receiver : result
          }
        }
        return Reflect.get(array, key, receiver)
      },
      set(array, key, value) {
        const result = Reflect.set(array, key, value)
        changed()
        return result
      },
      deleteProperty(array, key) {
        const result = Reflect.deleteProperty(array, key)
        changed()
        return result
      },
    })
    return proxy
  }
  marks = wrap(pet.marks)
  Object.defineProperty(pet, 'marks', {
    enumerable: true,
    configurable: true,
    get() {
      void revision.value
      return marks
    },
    set(input: MarkInstance[]) {
      if (input !== marks) {
        marks = wrap(input)
        publish()
      }
    },
  })
}
