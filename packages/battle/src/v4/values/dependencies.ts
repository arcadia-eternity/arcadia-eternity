import { getValueRecipe, withValueReadGuard, type ReactiveValue } from '../reactiveValue'
import type { AttributeSystem, AttributeData } from '../attributeSystem'
import { Pet } from '../pet'
import type { SkillInstance } from '../skill'

/** Preserve pet recipes while allowing skill-owned attribute contributions. */
export type BindingTarget = ({ pet: Pet } | { skill: SkillInstance }) & { attribute: string }
export function bindingEntity(target: BindingTarget): Pet | SkillInstance {
  return 'pet' in target ? target.pet : target.skill
}
export function bindingOwner(target: BindingTarget): Pet | null {
  const entity = bindingEntity(target)
  return entity instanceof Pet ? entity : entity.owner
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
    if ((recipe.target as AttributeSystem<AttributeData>).getBattleId() !== bindingOwner(target)?.owner?.battle?.id)
      throw new Error('Cross-battle attribute read')
    if (capturing) return
    if (recipe.target === bindingEntity(target).attributeSystem && recipe.key === target.attribute)
      throw new Error(`Circular value binding: ${target.attribute}`)
    dependencies.add(value)
  }, read)
}
