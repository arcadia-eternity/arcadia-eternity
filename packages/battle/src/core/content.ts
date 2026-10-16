import type { Prototype } from './entity.js'
import {
  AttackTargetOpinion,
  Category,
  Element,
  Gender,
  IgnoreStageStrategy,
  Nature,
  StackStrategy,
  type StatOutBattle,
  type speciesId,
  type baseSkillId,
  type baseMarkId,
} from '@arcadia-eternity/const'
import { stageMark } from './stat-stage.js'
import type { JsonObject } from './data.js'
import { canonicalData, copyData, freezeData, requireNumber } from './data.js'

/** Stable reference to trusted code supplied by the application, never imported from a save. */
export interface EffectReference {
  id: string
  version: string
  params: JsonObject
}
export interface Species extends Prototype<speciesId> {
  id: speciesId
  num: number
  assetRef?: string
  element: Element
  baseStats: StatOutBattle
  genderRatio: [number, number] | null
  heightRange: [number, number]
  weightRange: [number, number]
  abilityIds: string[]
  emblemIds: string[]
  learnableSkills: { skill_id: string; level: number; hidden: boolean }[]
}
export interface BaseSkill extends Prototype<baseSkillId> {
  id: baseSkillId
  sfxRef?: string
  category: Category
  element: Element
  power: number
  accuracy: number
  rage: number
  priority: number
  target: AttackTargetOpinion
  multihit: number | [number, number]
  sureHit: boolean
  sureCrit: boolean
  ignoreShield: boolean
  ignoreOpponentStageStrategy: IgnoreStageStrategy
  tags: string[]
  effects: EffectReference[]
}
export interface MarkConfig {
  duration: number
  persistent: boolean
  maxStacks: number
  stackable: boolean
  stackStrategy: StackStrategy
  destroyable: boolean
  isShield: boolean
  keepOnSwitchOut: boolean
  transferOnSwitch: boolean
  inheritOnFaint: boolean
  mutexGroup?: string
}
export interface BaseMark extends Prototype<baseMarkId> {
  id: baseMarkId
  iconRef?: string
  config: MarkConfig
  tags: string[]
  effects: EffectReference[]
}
export type SpeciesDefinition = Omit<Species, 'id'> & { id: string }
export type SkillDefinition = Omit<BaseSkill, 'id'> & { id: string }
export type MarkDefinition = Omit<BaseMark, 'id'> & { id: string }
export interface BattleContent {
  species: SpeciesDefinition[]
  skills: SkillDefinition[]
  marks: MarkDefinition[]
}
/** A team build is data; a battle Pet is its temporary runtime instance. */
export interface PetBuild {
  id: string
  name: string
  species: string
  level: number
  evs: StatOutBattle
  ivs: StatOutBattle
  nature: Nature
  skills: string[]
  ability?: string
  emblem?: string
  gender?: Gender
  weight?: number
  height?: number
  maxHp?: number
}
export interface PlayerBuild {
  id: string
  name: string
  team: PetBuild[]
}

export class ContentCatalog {
  readonly data: BattleContent
  readonly identity: string
  private readonly speciesById = new Map<string, Species>()
  private readonly skillsById = new Map<string, BaseSkill>()
  private readonly marksById = new Map<string, BaseMark>()
  constructor(content: BattleContent) {
    this.data = freezeData(copyData(content))
    this.identity = canonicalData(this.data)
    for (const species of this.data.species) {
      this.insert(this.speciesById, species as Species)
      if (!Object.values(Element).includes(species.element)) throw new Error('Invalid species element')
      for (const stat of Object.values(species.baseStats)) requireNumber(stat, 'base stat', 1)
    }
    for (const skill of this.data.skills) {
      this.insert(this.skillsById, skill as BaseSkill)
      if (
        !Object.values(Category).includes(skill.category) ||
        !Object.values(Element).includes(skill.element) ||
        !Object.values(AttackTargetOpinion).includes(skill.target) ||
        !Object.values(IgnoreStageStrategy).includes(skill.ignoreOpponentStageStrategy)
      )
        throw new Error('Invalid skill enum')
      for (const [key, value] of Object.entries({ power: skill.power, accuracy: skill.accuracy, rage: skill.rage }))
        requireNumber(value, key)
      requireNumber(skill.priority, 'priority', -Number.MAX_SAFE_INTEGER)
      const hits = typeof skill.multihit === 'number' ? [skill.multihit, skill.multihit] : skill.multihit
      if (hits.length !== 2 || hits.some(x => !Number.isSafeInteger(x) || x < 1 || x > 100) || hits[0] > hits[1])
        throw new Error('Invalid multihit')
    }
    for (const mark of this.data.marks) {
      if (stageMark(mark.id)) throw new Error('Reserved stat stage mark ID')
      this.insert(this.marksById, mark as BaseMark)
      if (!Object.values(StackStrategy).includes(mark.config.stackStrategy)) throw new Error('Invalid stack strategy')
      if (!Number.isSafeInteger(mark.config.duration) || mark.config.duration < -1)
        throw new Error('Invalid mark duration')
      requireNumber(mark.config.maxStacks, 'maxStacks', 1)
    }
  }
  private insert<T extends { id: string }>(map: Map<string, T>, item: T) {
    if (typeof item.id !== 'string' || !item.id || map.has(item.id))
      throw new Error(`Duplicate or empty content ID: ${item.id}`)
    map.set(item.id, item)
  }
  species(id: string): Species {
    const item = this.speciesById.get(id)
    if (!item) throw new Error(`Unknown species: ${id}`)
    return item
  }
  skill(id: string): BaseSkill {
    const item = this.skillsById.get(id)
    if (!item) throw new Error(`Unknown skill: ${id}`)
    return item
  }
  mark(id: string): BaseMark {
    const item = this.marksById.get(id) ?? stageMark(id)
    if (!item) throw new Error(`Unknown mark: ${id}`)
    return item
  }
}
