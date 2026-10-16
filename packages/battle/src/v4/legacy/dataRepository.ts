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

// 对象更新监听器
type UpdateListener<T> = (newValue: T, oldValue: T) => void

// 代理对象管理器
class ObjectProxyManager<T extends object> {
  private target: T
  private listeners = new Set<UpdateListener<T>>()
  private proxy: T

  constructor(initialTarget: T) {
    this.target = initialTarget
    this.proxy = this.createProxy()
  }

  private createProxy(): T {
    return new Proxy(this.target as object, {
      get: (_, prop) => {
        const value = (this.target as any)[prop]
        // 如果是函数，绑定正确的 this
        if (typeof value === 'function') {
          return value.bind(this.target)
        }
        return value
      },
      set: (_, prop, value) => {
        ;(this.target as any)[prop] = value
        return true
      },
      has: (_, prop) => {
        return prop in (this.target as object)
      },
      ownKeys: _ => {
        return Reflect.ownKeys(this.target as object)
      },
      getOwnPropertyDescriptor: (_, prop) => {
        return Reflect.getOwnPropertyDescriptor(this.target as object, prop)
      },
    }) as T
  }

  getProxy(): T {
    return this.proxy
  }

  updateTarget(newTarget: T): void {
    const oldTarget = this.target
    this.target = newTarget

    // 通知所有监听器
    this.listeners.forEach(listener => {
      try {
        listener(newTarget, oldTarget)
      } catch (error) {
        console.error('代理更新监听器执行失败:', error)
      }
    })
  }

  addListener(listener: UpdateListener<T>): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  cleanup(): void {
    this.listeners.clear()
  }
}

export class DataRepository {
  private static instance: DataRepository
  public species = new Map<string, Species>()
  public skills = new Map<string, BaseSkill>()
  public marks = new Map<string, BaseMark>()
  public effects = new Map<string, Effect<EffectTrigger>>()
  private scriptDeclarations = new Map<string, ScriptDeclaration>()

  // 代理管理器
  private speciesProxies = new Map<string, ObjectProxyManager<Species>>()
  private skillProxies = new Map<string, ObjectProxyManager<BaseSkill>>()
  private markProxies = new Map<string, ObjectProxyManager<BaseMark>>()
  private effectProxies = new Map<string, ObjectProxyManager<Effect<EffectTrigger>>>()

  static getInstance() {
    if (!DataRepository.instance) {
      DataRepository.instance = new DataRepository()
    }
    return DataRepository.instance
  }

  getSpecies(id: speciesId): Species {
    // 优先返回代理对象
    const proxyManager = this.speciesProxies.get(id)
    if (proxyManager) {
      return proxyManager.getProxy()
    }

    const species = this.species.get(id)
    if (!species) {
      throw new Error(`Species with id ${id} not found`)
    }
    return species
  }

  getSkill(id: baseSkillId): BaseSkill {
    // 优先返回代理对象
    const proxyManager = this.skillProxies.get(id)
    if (proxyManager) {
      return proxyManager.getProxy()
    }

    const skill = this.skills.get(id)
    if (!skill) {
      throw new Error(`Skill with id ${id} not found`)
    }
    return skill
  }

  getMark(id: baseMarkId): BaseMark {
    // 优先返回代理对象
    const proxyManager = this.markProxies.get(id)
    if (proxyManager) {
      return proxyManager.getProxy()
    }

    const mark = this.marks.get(id)
    if (!mark) {
      throw new Error(`Mark with id ${id} not found`)
    }
    return mark
  }

  getEffect(id: effectId): Effect<EffectTrigger> {
    // 优先返回代理对象
    const proxyManager = this.effectProxies.get(id)
    if (proxyManager) {
      return proxyManager.getProxy()
    }

    const effect = this.effects.get(id)
    if (!effect) {
      throw new Error(`Effect with id ${id} not found`)
    }
    return effect
  }

  getAllMarks(): BaseMark[] {
    return [...this.marks.values()]
  }

  registerSpecies(id: string, species: Species, allowUpdate = false) {
    if (this.species.has(id) && !allowUpdate) {
      throw new Error(`Species with id "${id}" already exists`)
    }

    this.species.set(id, species)

    // 如果存在代理，更新代理目标
    const proxyManager = this.speciesProxies.get(id)
    if (proxyManager) {
      proxyManager.updateTarget(species)
    } else if (allowUpdate) {
      // 热重载时创建新的代理
      this.speciesProxies.set(id, new ObjectProxyManager(species))
    }
  }

  registerSkill(id: string, skill: BaseSkill, allowUpdate = false) {
    if (this.skills.has(id) && !allowUpdate) {
      throw new Error(`Skill with id "${id}" already exists`)
    }

    this.skills.set(id, skill)

    // 如果存在代理，更新代理目标
    const proxyManager = this.skillProxies.get(id)
    if (proxyManager) {
      proxyManager.updateTarget(skill)
    } else if (allowUpdate) {
      // 热重载时创建新的代理
      this.skillProxies.set(id, new ObjectProxyManager(skill))
    }
  }

  registerMark(id: string, mark: BaseMark, allowUpdate = false) {
    if (this.marks.has(id) && !allowUpdate) {
      throw new Error(`Mark with id "${id}" already exists`)
    }

    this.marks.set(id, mark)

    // 如果存在代理，更新代理目标
    const proxyManager = this.markProxies.get(id)
    if (proxyManager) {
      proxyManager.updateTarget(mark)
    } else if (allowUpdate) {
      // 热重载时创建新的代理
      this.markProxies.set(id, new ObjectProxyManager(mark))
    }
  }

  registerEffect(id: string, effect: Effect<EffectTrigger>, allowUpdate = false) {
    if (this.effects.has(id) && !allowUpdate) {
      throw new Error(`Effect with id "${id}" already exists`)
    }

    this.effects.set(id, effect)

    // 如果存在代理，更新代理目标
    const proxyManager = this.effectProxies.get(id)
    if (proxyManager) {
      proxyManager.updateTarget(effect)
    } else if (allowUpdate) {
      // 热重载时创建新的代理
      this.effectProxies.set(id, new ObjectProxyManager(effect))
    }
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

  // 热重载相关方法
  enableHotReloadForExistingObjects() {
    // 为现有对象创建代理
    for (const [id, species] of this.species) {
      if (!this.speciesProxies.has(id)) {
        this.speciesProxies.set(id, new ObjectProxyManager(species))
      }
    }

    for (const [id, skill] of this.skills) {
      if (!this.skillProxies.has(id)) {
        this.skillProxies.set(id, new ObjectProxyManager(skill))
      }
    }

    for (const [id, mark] of this.marks) {
      if (!this.markProxies.has(id)) {
        this.markProxies.set(id, new ObjectProxyManager(mark))
      }
    }

    for (const [id, effect] of this.effects) {
      if (!this.effectProxies.has(id)) {
        this.effectProxies.set(id, new ObjectProxyManager(effect))
      }
    }
  }

  // 清理指定类别的数据（用于热重载）
  clearCategory(category: 'species' | 'skills' | 'marks' | 'effects', itemIds?: string[]) {
    switch (category) {
      case 'species':
        if (itemIds) {
          itemIds.forEach(id => {
            this.species.delete(id)
            // 保留代理，但会在重新注册时更新
          })
        } else {
          this.species.clear()
        }
        break
      case 'skills':
        if (itemIds) {
          itemIds.forEach(id => {
            this.skills.delete(id)
          })
        } else {
          this.skills.clear()
        }
        break
      case 'marks':
        if (itemIds) {
          itemIds.forEach(id => {
            this.marks.delete(id)
          })
        } else {
          this.marks.clear()
        }
        break
      case 'effects':
        if (itemIds) {
          itemIds.forEach(id => {
            this.effects.delete(id)
          })
        } else {
          this.effects.clear()
        }
        break
    }
  }

  // 获取代理统计信息
  getProxyStats() {
    return {
      species: this.speciesProxies.size,
      skills: this.skillProxies.size,
      marks: this.markProxies.size,
      effects: this.effectProxies.size,
    }
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

// 导出数据仓库实例
export const dataRepo = DataRepository.getInstance()

// 导出代理相关类型
export type { UpdateListener }
export { ObjectProxyManager }
