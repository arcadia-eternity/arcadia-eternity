import type {
  baseMarkId,
  baseSkillId,
  effectId,
  EffectTrigger,
  markId,
  petId,
  playerId,
  skillId,
  speciesId,
} from '@arcadia-eternity/const'
import { Battle } from './battle'
import type { MarkInstance } from './mark'
import type { Pet } from './pet'
import type { Player } from './player'
import type { SkillInstance } from './skill'

export type ScopeObject = MarkInstance | SkillInstance | Pet | Player | Battle
export type ConfigValue =
  | string
  | number
  | boolean
  | markId
  | skillId
  | petId
  | playerId
  | baseMarkId
  | baseSkillId
  | speciesId
  | null

//TODO: 与对象生命周期绑定的setConfig
export class ConfigSystem {
  private static instance: ConfigSystem
  public configMap: Map<string, ConfigValue> = new Map()
  public instanceMap: WeakMap<ScopeObject, Map<string, ConfigValue>> = new WeakMap()

  constructor() {}

  static getInstance() {
    if (!ConfigSystem.instance) ConfigSystem.instance = new ConfigSystem()
    return ConfigSystem.instance
  }

  get(key: string, scope?: ScopeObject) {
    if (!scope) return this.configMap.get(key)
    let _scope: ScopeObject = scope
    while (true) {
      if (this.instanceMap.has(_scope) && this.instanceMap.get(_scope)!.has(key)) {
        return this.instanceMap.get(_scope)!.get(key)
      }
      if (_scope instanceof Battle || !_scope.owner) break
      _scope = _scope.owner
    }
    return this.configMap.get(key)
  }

  set(key: string, value: ConfigValue, scope?: ScopeObject) {
    if (!scope) {
      // Set the value globally in the configMap
      this.configMap.set(key, value)
    } else {
      // Set the value scoped to the specific ScopeObject
      if (!this.instanceMap.has(scope)) {
        this.instanceMap.set(scope, new Map())
      }
      this.instanceMap.get(scope)!.set(key, value)
    }
  }
}
