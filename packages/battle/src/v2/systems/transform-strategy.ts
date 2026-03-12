import type { World } from '@arcadia-eternity/engine'
import type { TransformRecord, TransformStrategy } from '@arcadia-eternity/plugin-transformation'
import type { BattleSystems } from '../types/battle-systems.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'

function getSystems(world: World): BattleSystems {
  return world.systems as unknown as BattleSystems
}

function getRepository(world: World): V2DataRepository | undefined {
  const repo = world.meta.dataRepository
  return repo as V2DataRepository | undefined
}

function getEffectHandlingStrategy(record: TransformRecord): 'override' | 'preserve' {
  const strategy = record.extra.effectHandlingStrategy
  return strategy === 'override' ? 'override' : 'preserve'
}

function mergeEffectIds(
  previous: string[],
  incoming: string[],
  strategy: 'override' | 'preserve',
): string[] {
  if (strategy === 'override') return [...incoming]
  const merged = new Map<string, true>()
  for (const id of previous) merged.set(id, true)
  for (const id of incoming) merged.set(id, true)
  return [...merged.keys()]
}

function applySkillTransform(world: World, targetId: string, newBaseId: string, record: TransformRecord): void {
  const systems = getSystems(world)
  const repo = getRepository(world)
  if (!repo) return

  const skill = systems.skillSystem.get(world, targetId)
  const baseSkill = repo.findSkill(newBaseId)
  if (!skill || !baseSkill) return

  const effectHandling = getEffectHandlingStrategy(record)
  const nextEffectIds = mergeEffectIds(skill.effectIds ?? [], baseSkill.effectIds ?? [], effectHandling)

  skill.baseSkillId = baseSkill.id
  skill.category = baseSkill.category
  skill.element = baseSkill.element
  skill.target = baseSkill.target
  skill.multihit = baseSkill.multihit
  skill.sureHit = baseSkill.sureHit
  skill.sureCrit = baseSkill.sureCrit
  skill.ignoreShield = baseSkill.ignoreShield
  skill.tags = [...baseSkill.tags]
  skill.effectIds = nextEffectIds

  systems.attrSystem.setBaseValue(world, targetId, 'power', baseSkill.power)
  systems.attrSystem.setBaseValue(world, targetId, 'accuracy', baseSkill.accuracy)
  systems.attrSystem.setBaseValue(world, targetId, 'rage', baseSkill.rage)
  systems.attrSystem.setBaseValue(world, targetId, 'priority', baseSkill.priority)
  systems.attrSystem.setBaseValue(world, targetId, 'category', baseSkill.category)
  systems.attrSystem.setBaseValue(world, targetId, 'element', baseSkill.element)
  systems.attrSystem.setBaseValue(world, targetId, 'target', baseSkill.target)
  systems.attrSystem.setBaseValue(world, targetId, 'multihit', baseSkill.multihit)
  systems.attrSystem.setBaseValue(world, targetId, 'sureHit', baseSkill.sureHit)
  systems.attrSystem.setBaseValue(world, targetId, 'sureCrit', baseSkill.sureCrit)
  systems.attrSystem.setBaseValue(world, targetId, 'ignoreShield', baseSkill.ignoreShield)
  systems.attrSystem.setBaseValue(world, targetId, 'tags', [...baseSkill.tags])

  systems.effectPipeline.detachAllEffects(world, targetId)
  for (const effectId of nextEffectIds) {
    const effect = repo.findEffect(effectId)
    if (effect) systems.effectPipeline.attachEffect(world, targetId, effect)
  }
}

function applyMarkTransform(world: World, targetId: string, newBaseId: string, record: TransformRecord): void {
  const systems = getSystems(world)
  const repo = getRepository(world)
  if (!repo) return

  const mark = systems.markSystem.get(world, targetId)
  const baseMark = repo.findMark(newBaseId)
  if (!mark || !baseMark) return

  const effectHandling = getEffectHandlingStrategy(record)
  const nextEffectIds = mergeEffectIds(mark.effectIds ?? [], baseMark.effectIds ?? [], effectHandling)

  mark.baseMarkId = baseMark.id
  mark.tags = [...baseMark.tags]
  mark.effectIds = nextEffectIds
  mark.config = {
    ...baseMark.config,
    ...mark.config,
  }
  if (mark.stack > mark.config.maxStacks) {
    mark.stack = mark.config.maxStacks
  }
  if (mark.config.persistent) {
    mark.duration = -1
  }

  systems.attrSystem.setBaseValue(world, targetId, 'tags', [...mark.tags])
  systems.attrSystem.setBaseValue(world, targetId, 'config', { ...mark.config })
  systems.attrSystem.setBaseValue(world, targetId, 'stack', mark.stack)
  systems.attrSystem.setBaseValue(world, targetId, 'duration', mark.duration)

  systems.effectPipeline.detachAllEffects(world, targetId)
  for (const effectId of nextEffectIds) {
    const effect = repo.findEffect(effectId)
    if (effect) systems.effectPipeline.attachEffect(world, targetId, effect)
  }
}

function applyPetTransform(world: World, targetId: string, newBaseId: string): void {
  const systems = getSystems(world)
  const repo = getRepository(world)
  if (!repo) return

  const pet = systems.petSystem.get(world, targetId)
  const species = repo.findSpecies(newBaseId)
  if (!pet || !species) return

  const currentMaxHp = systems.petSystem.getStatValue(world, targetId, 'maxHp')
  const currentHp = systems.petSystem.getCurrentHp(world, targetId)
  const hpRatio = currentMaxHp > 0 ? currentHp / currentMaxHp : 1

  pet.speciesId = species.id
  pet.element = species.element
  systems.attrSystem.setBaseValue(world, targetId, 'speciesId', species.id)
  systems.attrSystem.setBaseValue(world, targetId, 'element', species.element)
  systems.petSystem.recalculateStats(world, targetId, species)

  const newMaxHp = systems.petSystem.getStatValue(world, targetId, 'maxHp')
  const nextHp = Math.max(1, Math.min(newMaxHp, Math.floor(newMaxHp * hpRatio)))
  systems.petSystem.setCurrentHp(world, targetId, nextHp)
}

export class V2TransformStrategy implements TransformStrategy {
  canHandle(entityType: string): boolean {
    return entityType === 'pet' || entityType === 'skill' || entityType === 'mark'
  }

  performTransform(world: World, targetId: string, newBaseId: string, record: TransformRecord): void {
    if (record.targetType === 'skill') {
      applySkillTransform(world, targetId, newBaseId, record)
      return
    }
    if (record.targetType === 'mark') {
      applyMarkTransform(world, targetId, newBaseId, record)
      return
    }
    if (record.targetType === 'pet') {
      applyPetTransform(world, targetId, newBaseId)
    }
  }

  restoreOriginal(world: World, targetId: string, originalBaseId: string, record: TransformRecord): void {
    this.performTransform(world, targetId, originalBaseId, record)
  }
}
