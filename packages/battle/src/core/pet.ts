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
  build: PetBuild
  speciesId: string
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
export class Pet {
  readonly id: string
  readonly build: PetBuild
  readonly originalSpecies: Species
  species: Species
  readonly owner: Player
  readonly skills: readonly Skill[]
  marks: Mark[] = []
  gender: Gender
  appeared = false
  currentHp: number
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
    this.id = build.id
    this.owner = owner
    this.originalSpecies = content.species(build.species)
    this.species = this.originalSpecies
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
    this.currentHp = this.stat.maxHp
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
    return this.build.ability
  }
  get emblem() {
    return this.build.emblem
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
  getEffectiveStat(ignoreStage = IgnoreStageStrategy.none): StatOnBattle {
    const result = this.calculateStats()
    for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
      const stage = this.stages[stat]
      if (
        ignoreStage === IgnoreStageStrategy.all ||
        (ignoreStage === IgnoreStageStrategy.positive && stage > 0) ||
        (ignoreStage === IgnoreStageStrategy.negative && stage < 0)
      )
        continue
      result[stat] *= [0.25, 0.28, 0.33, 0.4, 0.5, 0.66, 1, 1.5, 2, 2.5, 3, 3.5, 4][stage + 6]
    }
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
      speciesId: this.species.id,
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
