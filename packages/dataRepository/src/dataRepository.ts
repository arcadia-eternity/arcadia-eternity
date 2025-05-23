import { type Prototype, type Species, Effect, BaseMark, BaseSkill } from '@arcadia-eternity/battle'
import {
  EffectTrigger,
  type baseMarkId,
  type baseSkillId,
  type effectId,
  type speciesId,
} from '@arcadia-eternity/const'

// 脚本声明类型
export interface ScriptDeclaration {
  id: string
  type: 'effect' | 'species' | 'skill' | 'mark'
  instance: Prototype
}

export class DataRepository {
  private static instance: DataRepository
  public species = new Map<string, Species>()
  public skills = new Map<string, BaseSkill>()
  public marks = new Map<string, BaseMark>()
  public effects = new Map<string, Effect<EffectTrigger>>()
  private scriptDeclarations = new Map<string, ScriptDeclaration>()

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

  getAllMarks(): BaseMark[] {
    return [...this.marks.values()]
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

  // 脚本声明管理方法
  registerScriptDeclaration(declaration: ScriptDeclaration) {
    if (this.scriptDeclarations.has(declaration.id)) {
      throw new Error(`Script declaration with id "${declaration.id}" already exists`)
    }
    this.scriptDeclarations.set(declaration.id, declaration)

    // 根据类型注册到对应的Map
    switch (declaration.type) {
      case 'effect':
        this.registerEffect(declaration.id, declaration.instance as Effect<EffectTrigger>)
        break
      case 'species':
        this.registerSpecies(declaration.id, declaration.instance as Species)
        break
      case 'skill':
        this.registerSkill(declaration.id, declaration.instance as BaseSkill)
        break
      case 'mark':
        this.registerMark(declaration.id, declaration.instance as BaseMark)
        break
    }
  }

  getScriptDeclarations(): ScriptDeclaration[] {
    return Array.from(this.scriptDeclarations.values())
  }

  clearScriptDeclarations() {
    this.scriptDeclarations.clear()
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

// 函数式API - 作为装饰器的替代方案
export function declareEffect(effect: Effect<EffectTrigger>) {
  DataRepository.getInstance().registerScriptDeclaration({
    id: effect.id,
    type: 'effect',
    instance: effect,
  })
}

export function declareSpecies(species: Species) {
  DataRepository.getInstance().registerScriptDeclaration({
    id: species.id,
    type: 'species',
    instance: species,
  })
}

export function declareSkill(skill: BaseSkill) {
  DataRepository.getInstance().registerScriptDeclaration({
    id: skill.id,
    type: 'skill',
    instance: skill,
  })
}

export function declareMark(mark: BaseMark) {
  DataRepository.getInstance().registerScriptDeclaration({
    id: mark.id,
    type: 'mark',
    instance: mark,
  })
}
