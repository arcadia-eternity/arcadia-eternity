import { Prototype } from '@/core/const'
import { EffectContext } from '@/core/context'
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

  registerSpecies(id: string, species: Species) {
    this.species.set(id, species)
  }

  registerSkill(id: string, skill: Skill) {
    this.skills.set(id, skill)
  }

  registerMark(id: string, mark: Mark) {
    this.marks.set(id, mark)
  }

  registerEffect(id: string, effect: Effect<EffectTrigger>) {
    this.effects.set(id, effect)
  }
}

// 通用装饰器工厂函数
function createRegisterDecorator<T extends Prototype>(registerFn: (instance: T) => void) {
  return () => {
    return (constructor: new () => T) => {
      const instance = new constructor()
      registerFn(instance)
    }
  }
}

// 具体装饰器
export const RegisterEffect = createRegisterDecorator<Effect<EffectTrigger>>(effect =>
  DataRepository.getInstance().registerEffect(effect.id, effect),
)

export const RegisterSpecies = createRegisterDecorator<Species>(species =>
  DataRepository.getInstance().registerSpecies(species.id, species),
)

export const RegisterSkill = createRegisterDecorator<Skill>(skill =>
  DataRepository.getInstance().registerSkill(skill.id, skill),
)

export const RegisterMark = createRegisterDecorator<Mark>(mark =>
  DataRepository.getInstance().registerMark(mark.id, mark),
)
