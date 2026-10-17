import { getValueRecipe, withValueReadGuard, type ReactiveValue } from '../reactiveValue'
import type { AttributeSystem, AttributeData } from '../attributeSystem'
import type { Pet } from '../pet'

export interface BindingTarget {
  pet: Pet
  attribute: string
}
let capturing = 0

/** A frozen value does not introduce a live edge, even when reading the written attribute. */
export function captureReads<T>(read: () => T): T {
  capturing++
  try {
    return read()
  } finally {
    capturing--
  }
}

export function traceReads<T>(target: BindingTarget, dependencies: Set<ReactiveValue<unknown>>, read: () => T): T {
  return withValueReadGuard(value => {
    const recipe = getValueRecipe(value)
    if (recipe?.type !== 'attribute') return
    if ((recipe.target as AttributeSystem<AttributeData>).getBattleId() !== target.pet.owner?.battle?.id)
      throw new Error('Cross-battle attribute read')
    if (capturing) return
    if (recipe.target === target.pet.attributeSystem && recipe.key === target.attribute)
      throw new Error(`Circular value binding: ${target.attribute}`)
    dependencies.add(value)
  }, read)
}
