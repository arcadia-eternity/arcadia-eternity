import { Signal } from '../../reactiveValue'
import type { Pet } from '../../pet'
import type { MarkInstance } from '../../mark'

const initialized = new WeakSet<object>()
/** Prototype adapter: observe existing domain fields without changing production constructors. */
export function observeOwner(source: { owner: unknown }): void {
  if (initialized.has(source)) return
  initialized.add(source)
  const signal = new Signal(source.owner)
  Object.defineProperty(source, 'owner', {
    enumerable: true,
    configurable: true,
    get: () => signal.value,
    set: (owner: unknown) => signal.next(owner),
  })
}

export function observeMarks(pet: Pet): void {
  if (initialized.has(pet)) return
  initialized.add(pet)
  const revision = new Signal(0)
  const changed = () => revision.next(revision.value + 1)
  const wrap = (input: MarkInstance[]) => {
    // Mutating array methods publish once, after the whole membership transition.
    const mutators = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])
    return new Proxy(input, {
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
  }
  let marks = wrap(pet.marks)
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
        changed()
      }
    },
  })
}
