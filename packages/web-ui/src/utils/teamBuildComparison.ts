import { Value } from '@sinclair/typebox/value'
import { trainingStatSteps } from '@arcadia-eternity/const'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { useGameDataStore } from '@/stores/gameData'

export const statNames = { hp: '体力', atk: '攻击', def: '防御', spa: '特攻', spd: '特防', spe: '速度' } as const
export type StatKey = keyof typeof statNames
export const statList = Object.keys(statNames) as StatKey[]

export function buildStatSteps(
  pet: PetSchemaType | null,
  game: ReturnType<typeof useGameDataStore>,
  keys: readonly StatKey[] = statList,
) {
  const stats: Partial<Record<StatKey, ReturnType<typeof trainingStatSteps>>> = {}
  if (!pet) return stats
  const species = game.getSpecies(pet.species)
  const nature = game.getNature(pet.nature)
  const stage = pet.enhancement ? game.getEnhancement(pet.enhancement) : undefined
  if (!species || !nature || (pet.enhancement && !stage)) return stats
  const policy = game.rules?.mechanics?.enhancement
  const active =
    stage &&
    policy?.mode === 'active' &&
    (!policy.species || policy.species.includes(pet.species)) &&
    (!policy.stages || policy.stages.includes(stage.id))
  for (const stat of keys) {
    stats[stat] = trainingStatSteps(
      stat,
      species.baseStats[stat],
      pet.level,
      pet.ivs[stat],
      pet.evs[stat],
      nature.multipliers[stat],
      active ? stage.bonus[stat] : 0,
    )
  }
  return stats
}

const labels = {
  species: '种族',
  name: '名称',
  gender: '性别',
  height: '身高',
  weight: '体重',
  nature: '性格',
  skills: '技能',
  ivs: '个体值',
  evs: '学习力',
  ability: '特性',
  emblem: '纹章',
  enhancement: '强化阶段',
  inheritedSkill: '遗传技能',
}
type BuildField = keyof typeof labels
type FormatField = (field: BuildField, value: string) => string

export function buildDifferences(before: PetSchemaType, after: PetSchemaType, format: FormatField) {
  const changes: { label: string; before: string; after: string }[] = []
  for (const key of Object.keys(labels) as BuildField[]) {
    if (key === 'ivs' || key === 'evs') {
      for (const stat of statList) {
        if (before[key][stat] !== after[key][stat])
          changes.push({
            label: statNames[stat] + labels[key],
            before: String(before[key][stat]),
            after: String(after[key][stat]),
          })
      }
    } else if (!Value.Equal(before[key], after[key])) {
      const display = (value: unknown) =>
        Array.isArray(value) ? value.map(id => format(key, id)).join('、') || '无' : format(key, String(value ?? '无'))
      changes.push({ label: labels[key], before: display(before[key]), after: display(after[key]) })
    }
  }
  return changes
}
