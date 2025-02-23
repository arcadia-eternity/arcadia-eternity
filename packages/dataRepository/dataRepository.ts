import { type Prototype, type Species, Effect, BaseMark, BaseSkill } from '@test-battle/battle'
import { EffectTrigger, type baseMarkId, type baseSkillId, type effectId, type speciesId } from '@test-battle/const'

export class DataRepository {
  private static instance: DataRepository
  private species = new Map<string, Species>()
  private skills = new Map<string, BaseSkill>()
  private marks = new Map<string, BaseMark>()
  private effects = new Map<string, Effect<EffectTrigger>>()

  static getInstance() {
    if (!DataRepository.instance) {
      DataRepository.instance = new DataRepository()
    }
    return DataRepository.instance
  }

  getSpecies(id: speciesId): Species {
    const species = this.species.get(id)
    if (!species) {
      throw new Error(`Species with id ${id} not found`)
    }
    return species
  }

  getSkill(id: baseSkillId): BaseSkill {
    const skill = this.skills.get(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return skill
  }

  getMark(id: baseMarkId): BaseMark {
    const mark = this.marks.get(id)
    if (!mark) {
      throw new Error(`Mark with id ${id} not found`)
    }
    return mark
  }

  getEffect(id: effectId): Effect<EffectTrigger> {
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

  registerSkill(id: string, skill: BaseSkill) {
    if (this.skills.has(id)) {
      throw new Error(`Skill with id "${id}" already exists`)
    }
    this.skills.set(id, skill)
  }

  registerMark(id: string, mark: BaseMark) {
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

export const RegisterSkill = createRegisterDecorator<BaseSkill>(skill =>
  DataRepository.getInstance().registerSkill(skill.id, skill),
)

export const RegisterMark = createRegisterDecorator<BaseMark>(mark =>
  DataRepository.getInstance().registerMark(mark.id, mark),
)
