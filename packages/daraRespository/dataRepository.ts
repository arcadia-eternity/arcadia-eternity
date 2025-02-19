import { Prototype } from 'packages/core/const'
import { Effect, EffectTrigger } from 'packages/core/effect'
import { Mark } from 'packages/core/mark'
import { Species } from 'packages/core/pet'
import { Skill } from 'packages/core/skill'

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
    if (this.species.has(id)) {
      throw new Error(`Species with id "${id}" already exists`)
    }
    this.species.set(id, species)
  }

  registerSkill(id: string, skill: Skill) {
    if (this.skills.has(id)) {
      throw new Error(`Skill with id "${id}" already exists`)
    }
    this.skills.set(id, skill)
  }

  registerMark(id: string, mark: Mark) {
    if (this.marks.has(id)) {
      throw new Error(`Mark with id "${id}" already exists`)
    }
    this.marks.set(id, mark)
  }

  registerEffect(id: string, effect: Effect<EffectTrigger>) {
    if (this.effects.has(id)) {
      throw new Error(`Effect with id "${id}" already exists`)
    }
    this.effects.set(id, effect)
  }
}

function createRegisterDecorator<T extends Prototype>(registerFn: (instance: T) => void) {
  return () => {
    return (constructor: new () => T) => {
      try {
        const instance = new constructor()
        registerFn(instance)
      } catch (error) {
        // 包装错误信息，增加类名信息
        const className = constructor.name
        throw new Error(`Failed to register ${className}: ${(error as Error).message}`)
      }
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
