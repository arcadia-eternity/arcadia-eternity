import { Effect, EffectTrigger } from '@/core/effect'
import { Mark } from '@/core/mark'
import { Species } from '@/core/pet'
import { Skill } from '@/core/skill'

export class DataRepository {
  private static instance: DataRepository
  private species = new Map<string, Species>()
  private skills = new Map<string, Skill>()
  private marks = new Map<string, Mark>()
  private effects = new Map<string, Effect<EffectTrigger>>()

  static getInstance() {
    if (!DataRepository.instance) {
      DataRepository.instance = new DataRepository()
    }
    return DataRepository.instance
  }

  getSpecies(id: string): Species {
    const species = this.species.get(id)
    if (!species) {
      throw new Error(`Species with id ${id} not found`)
    }
    return species
  }

  getSkill(id: string): Skill {
    const skill = this.skills.get(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return skill
  }

  getMark(id: string): Mark {
    const mark = this.marks.get(id)
    if (!mark) {
      throw new Error(`Mark with id ${id} not found`)
    }
    return mark
  }

  getEffect(id: string): Effect<EffectTrigger> {
    const effect = this.effects.get(id)
    if (!effect) {
      throw new Error(`Effect with id ${id} not found`)
    }
    return effect
  }
}
