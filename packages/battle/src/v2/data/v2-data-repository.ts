// battle/src/v2/data/v2-data-repository.ts
// Simple Map-based storage for parsed game data. Not a singleton — pass explicitly.

import type { EffectDef } from '@arcadia-eternity/engine'
import type { BaseMarkData } from '../schemas/mark.schema.js'
import type { BaseSkillData } from '../schemas/skill.schema.js'
import type { SpeciesData } from '../schemas/species.schema.js'

export class V2DataRepository {
  private effects = new Map<string, EffectDef>()
  private marks = new Map<string, BaseMarkData>()
  private skills = new Map<string, BaseSkillData>()
  private species = new Map<string, SpeciesData>()

  // ---------------------------------------------------------------------------
  // Register
  // ---------------------------------------------------------------------------

  registerEffect(id: string, effect: EffectDef): void {
    this.effects.set(id, effect)
  }

  registerMark(id: string, mark: BaseMarkData): void {
    this.marks.set(id, mark)
  }

  registerSkill(id: string, skill: BaseSkillData): void {
    this.skills.set(id, skill)
  }

  registerSpecies(id: string, species: SpeciesData): void {
    this.species.set(id, species)
  }

  // ---------------------------------------------------------------------------
  // Lookup (get throws, find returns undefined)
  // ---------------------------------------------------------------------------

  getEffect(id: string): EffectDef {
    const e = this.effects.get(id)
    if (!e) throw new Error(`Effect '${id}' not found in repository`)
    return e
  }

  findEffect(id: string): EffectDef | undefined {
    return this.effects.get(id)
  }

  getMark(id: string): BaseMarkData {
    const m = this.marks.get(id)
    if (!m) throw new Error(`Mark '${id}' not found in repository`)
    return m
  }

  findMark(id: string): BaseMarkData | undefined {
    return this.marks.get(id)
  }

  getSkill(id: string): BaseSkillData {
    const s = this.skills.get(id)
    if (!s) throw new Error(`Skill '${id}' not found in repository`)
    return s
  }

  findSkill(id: string): BaseSkillData | undefined {
    return this.skills.get(id)
  }

  getSpecies(id: string): SpeciesData {
    const s = this.species.get(id)
    if (!s) throw new Error(`Species '${id}' not found in repository`)
    return s
  }

  findSpecies(id: string): SpeciesData | undefined {
    return this.species.get(id)
  }

  // ---------------------------------------------------------------------------
  // Iteration
  // ---------------------------------------------------------------------------

  allEffects(): IterableIterator<EffectDef> {
    return this.effects.values()
  }

  allMarks(): IterableIterator<BaseMarkData> {
    return this.marks.values()
  }

  allSkills(): IterableIterator<BaseSkillData> {
    return this.skills.values()
  }

  allSpecies(): IterableIterator<SpeciesData> {
    return this.species.values()
  }

  // ---------------------------------------------------------------------------
  // Stats & clear
  // ---------------------------------------------------------------------------

  stats(): { effects: number; marks: number; skills: number; species: number } {
    return {
      effects: this.effects.size,
      marks: this.marks.size,
      skills: this.skills.size,
      species: this.species.size,
    }
  }

  clear(): void {
    this.effects.clear()
    this.marks.clear()
    this.skills.clear()
    this.species.clear()
  }
}
