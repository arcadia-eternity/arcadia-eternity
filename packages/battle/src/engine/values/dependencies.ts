import { getValueRecipe, withValueReadGuard, type ReactiveValue } from '../reactiveValue'
import type { AttributeSystem, AttributeData } from '../attributeSystem'
import { Pet } from '../pet'
import { Player } from '../player'
import { withConfigReadGuard, configReadDependency, type ConfigReadDependency } from '../config'
import type { SkillInstance } from '../skill'

/** Preserve pet recipes while allowing skill-owned attribute contributions. */
export type AttributeBindingTarget = ({ pet: Pet } | { skill: SkillInstance }) & { attribute: string }
export type BindingTarget = AttributeBindingTarget | { scope: Pet | Player; parameter: string }
export function bindingBattle(target: BindingTarget) {
  if ('scope' in target) return target.scope instanceof Player ? target.scope.battle : target.scope.owner?.battle
  return bindingOwner(target)?.owner?.battle
}
export function bindingEntity(target: AttributeBindingTarget): Pet | SkillInstance {
  return 'pet' in target ? target.pet : target.skill
}
export function bindingOwner(target: AttributeBindingTarget): Pet | null {
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

export function traceReads<T>(
  target: BindingTarget,
  dependencies: Set<ReactiveValue<unknown>>,
  read: () => T,
  configDependencies?: Set<ConfigReadDependency>,
): T {
  return withConfigReadGuard(
    (config, key) => {
      if (config !== bindingBattle(target)?.configSystem) throw new Error('Cross-battle parameter read')
      if (!capturing) configDependencies?.add(configReadDependency(config, key))
      if (!capturing && 'parameter' in target && target.parameter === key)
        throw new Error(`Circular parameter binding: ${key}`)
    },
    () =>
      withValueReadGuard(value => {
        const recipe = getValueRecipe(value)
        if (recipe?.type !== 'attribute') return
        if ((recipe.target as AttributeSystem<AttributeData>).getBattleId() !== bindingBattle(target)?.id)
          throw new Error('Cross-battle attribute read')
        if (capturing) return
        if (
          'attribute' in target &&
          recipe.target === bindingEntity(target).attributeSystem &&
          recipe.key === target.attribute
        )
          throw new Error(`Circular value binding: ${target.attribute}`)
        dependencies.add(value)
      }, read),
  )
}
