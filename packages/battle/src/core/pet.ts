import {
  AttributeSystem,
  type AttributeSystemState,
  type PetAttributeSet,
  type AttributeAdjustment,
} from './attributeSystem.js'
import type { petId } from '@arcadia-eternity/const'
import type { Instance, OwnedEntity, MarkOwner } from './entity.js'
import type { AddMarkContext, RemoveMarkContext } from './context.js'
import {
  Gender,
  NatureMap,
  IgnoreStageStrategy,
  RAGE_PER_TURN,
  type StatOnBattle,
  type StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import type { ContentCatalog, PetBuild, Species } from './content.js'
import { parseStageMark } from './stat-stage.js'
import { copyData, freezeData, requireNumber } from './data.js'
import type { Player } from './player.js'
import { Skill, type SkillState } from './skill.js'
import type { Mark, MarkState } from './mark.js'

export type StageStat = 'atk' | 'def' | 'spa' | 'spd' | 'spe'
export interface PetState {
  attributes?: AttributeSystemState
  build: PetBuild
  speciesId: string
  abilityId?: string | null
  emblemId?: string | null
  currentHp: number
  appeared: boolean
  gender: Gender
  skills: SkillState[]
  marks: MarkState[]
  stages: Record<StageStat, number>
  lastSkillId: string | null
  lastSkillUsedTimes: number
  skillHistory: string[]
}
export class Pet implements Instance<Species, petId>, OwnedEntity<Player>, MarkOwner {
  readonly id: petId
  readonly build: PetBuild
  readonly originalSpecies: Species
  species: Species
  readonly owner: Player
  readonly skills: readonly Skill[]
  marks: Mark[] = []
  currentAbility: string | null
  currentEmblem: string | null
  gender: Gender
  appeared = false
  private rawCurrentHp: number
  readonly attributeSystem: AttributeSystem<PetAttributeSet>
  get currentHp(): number {
    return this.attributeSystem.getCurrentValue('currentHp')
  }
  set currentHp(value: number) {
    this.rawCurrentHp = value
  }
  get stages(): Record<StageStat, number> {
    const result = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
    for (const mark of this.marks) {
      const stage = parseStageMark(mark.base.id)
      if (stage && mark.isActive) result[stage.stat] += stage.sign * mark.stack
    }
    return result
  }
  lastSkill: Skill | null = null
  lastSkillUsedTimes = 0
  skillHistory: string[] = []
  constructor(build: PetBuild, owner: Player, content: ContentCatalog) {
    this.build = freezeData(copyData(build))
    this.id = build.id as petId
    this.owner = owner
    this.originalSpecies = content.species(build.species)
    this.species = this.originalSpecies
    this.currentAbility = build.ability ?? null
    this.currentEmblem = build.emblem ?? null
    if (!build.id || !build.name || !Number.isSafeInteger(build.level) || build.level < 1 || build.level > 100)
      throw new Error('Invalid pet build')
    if (!NatureMap[build.nature]) throw new Error('Invalid nature')
    for (const stat of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
      requireNumber(build.ivs[stat], 'IV')
      requireNumber(build.evs[stat], 'EV')
    }
    if (build.maxHp !== undefined) requireNumber(build.maxHp, 'maxHp', 1)
    if (build.height !== undefined) requireNumber(build.height, 'height')
    if (build.weight !== undefined) requireNumber(build.weight, 'weight')
    if (build.gender !== undefined && !Object.values(Gender).includes(build.gender)) throw new Error('Invalid gender')
    this.gender =
      build.gender ??
      (!this.species.genderRatio ? Gender.NoGender : this.species.genderRatio[0] !== 0 ? Gender.Female : Gender.Male)
    if (build.skills.length < 1 || build.skills.length > 5 || new Set(build.skills).size !== build.skills.length)
      throw new Error('Invalid skills')
    this.skills = Object.freeze(
      build.skills.map((id, index) => new Skill(`${this.id}/skill/${index}`, content.skill(id), this)),
    )
    this.rawCurrentHp = this.calculateStats().maxHp
    this.attributeSystem = new AttributeSystem<PetAttributeSet>(
      this,
      () => ({ ...this.calculateStats(), currentHp: this.rawCurrentHp }),
      (key, value) => {
        if (key === 'currentHp') {
          this.rawCurrentHp = value
          return true
        }
        return false
      },
      key => this.stageAdjustments(key),
    )
  }
  get base() {
    return this.species
  }
  get battle() {
    return this.owner.battle
  }
  setOwner(owner: Player) {
    if (owner !== this.owner) throw new Error('Pet team ownership is fixed')
  }
  addMark(context: AddMarkContext) {
    if (context.target !== this) throw new Error('Wrong mark target')
    return this.battle.addMark(context)
  }
  removeMark(context: RemoveMarkContext) {
    if (context.mark.owner !== this) throw new Error('Wrong mark owner')
    this.battle.removeMark(context)
  }
  get name() {
    return this.build.name
  }
  get level() {
    return this.build.level
  }
  get evs() {
    return this.build.evs
  }
  get ivs() {
    return this.build.ivs
  }
  get nature() {
    return this.build.nature
  }
  get element() {
    return this.species.element
  }
  get ability() {
    return this.currentAbility ?? undefined
  }
  get emblem() {
    return this.currentEmblem ?? undefined
  }
  get isAlive() {
    return this.currentHp > 0
  }
  get currentRage() {
    return this.owner.currentRage
  }
  isActive() {
    return this.owner.activePet === this
  }
  calculateStats(): StatOnBattle {
    const { level, ivs, evs, nature } = this.build
    const stats = this.species.baseStats
    const value = (key: StatTypeWithoutHp) =>
      Math.floor(((2 * stats[key] + ivs[key] + Math.floor(evs[key] / 4)) * level) / 100 + 5) * NatureMap[nature][key]
    return {
      maxHp:
        this.build.maxHp ?? Math.floor(((2 * stats.hp + ivs.hp + Math.floor(evs.hp / 4)) * level) / 100) + level + 10,
      atk: value('atk' as StatTypeWithoutHp),
      def: value('def' as StatTypeWithoutHp),
      spa: value('spa' as StatTypeWithoutHp),
      spd: value('spd' as StatTypeWithoutHp),
      spe: value('spe' as StatTypeWithoutHp),
      accuracy: 100,
      evasion: 0,
      critRate: 7,
      ragePerTurn: RAGE_PER_TURN,
      height: this.build.height ?? this.species.heightRange[1],
      weight: this.build.weight ?? this.species.weightRange[1],
    }
  }
  get stat() {
    return this.getEffectiveStat()
  }
  get actualStat() {
    return this.stat
  }
  private stageAdjustments(key: keyof PetAttributeSet): AttributeAdjustment[] {
    if (!['atk', 'def', 'spa', 'spd', 'spe'].includes(key)) return []
    const stage = this.stages[key as StageStat]
    if (!stage) return []
    return [
      {
        id: `@stage/${key}`,
        type: 'percent',
        priority: 0,
        value: [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4][stage + 6] * 100 - 100,
        tags: ['statStage', stage > 0 ? 'positive' : 'negative'],
      },
    ]
  }
  getEffectiveStat(ignoreStage = IgnoreStageStrategy.none): StatOnBattle {
    const result = this.calculateStats()
    for (const key of Object.keys(result) as (keyof StatOnBattle)[])
      result[key] = this.attributeSystem.getCurrentValue(
        key,
        modifier =>
          !modifier.tags.includes('statStage') ||
          !(
            ignoreStage === IgnoreStageStrategy.all ||
            (ignoreStage === IgnoreStageStrategy.positive && modifier.tags.includes('positive')) ||
            (ignoreStage === IgnoreStageStrategy.negative && modifier.tags.includes('negative'))
          ),
      )
    return result
  }
  rememberSkill(skill: Skill) {
    this.lastSkillUsedTimes = this.lastSkill?.base.id === skill.base.id ? this.lastSkillUsedTimes + 1 : 1
    this.lastSkill = skill
    this.skillHistory.push(skill.base.id)
    if (this.skillHistory.length > 10) this.skillHistory.shift()
    skill.appeared = true
  }
  getState(): PetState {
    return copyData({
      build: this.build,
      attributes: this.attributeSystem.snapshot(),
      speciesId: this.species.id,
      abilityId: this.currentAbility !== (this.build.ability ?? null) ? this.currentAbility : undefined,
      emblemId: this.currentEmblem !== (this.build.emblem ?? null) ? this.currentEmblem : undefined,
      currentHp: this.currentHp,
      gender: this.gender,
      appeared: this.appeared,
      stages: this.stages,
      skills: this.skills.map(s => s.getState()),
      marks: this.marks.map(m => m.getState()),
      lastSkillId: this.lastSkill?.id ?? null,
      lastSkillUsedTimes: this.lastSkillUsedTimes,
      skillHistory: this.skillHistory,
    })
  }
}
