import type { Battle } from './battle.js'
import { copyData } from './data.js'
import {
  ModifierStore,
  ValueCell,
  scopeReference,
  scopeHierarchy,
  parentScope,
  sameScope,
  resolveScope,
  validatePrimitive,
  type ConfigValue,
  type ScopeObject,
  type ScopeReference,
  type PhaseTypeSpec,
  type ValueInput,
  type LiveModifier,
  type ModifierRow,
  type ConfigReference,
} from './values.js'
export type { ConfigValue, ScopeObject, PhaseTypeSpec } from './values.js'
export { PhaseType, PhaseScope } from './values.js'
export enum ConfigModifierType {
  override = 'override',
  delta = 'delta',
  append = 'append',
  prepend = 'prepend',
}
export enum ConfigDurationType {
  instant = 'instant',
  binding = 'binding',
  phase = 'phase',
  phaseType = 'phaseType',
}
type ConfigOperation<T> = T extends number
  ? ConfigModifierType.override | ConfigModifierType.delta
  : T extends string
    ? ConfigModifierType.override | ConfigModifierType.append | ConfigModifierType.prepend
    : ConfigModifierType.override
export class ConfigModifier<T extends ConfigValue = ConfigValue> {
  readonly value: ValueCell<ValueInput<T>>
  constructor(
    public durationType: ConfigDurationType,
    public id: string,
    initialValue: ValueInput<T>,
    public type: ConfigOperation<T>,
    public priority = 0,
    public source?: LiveModifier['source'],
    public phaseTypeSpec?: PhaseTypeSpec,
  ) {
    this.value = new ValueCell(initialValue)
  }
}
export interface ConfigSystemState {
  configs: { key: string; value: ConfigValue; tags: string[] }[]
  scoped: { scope: ScopeReference; key: string; value: ConfigValue }[]
  modifiers: ModifierRow[]
}
/** Per-battle config values with Battle > Player > Pet > Skill/Mark scope inheritance. */
export class ConfigSystem<T extends { [K in keyof T]: ConfigValue } = Record<string, ConfigValue>> {
  readonly store: ModifierStore
  private configs = new Map<string, { value: ConfigValue; tags: string[] }>()
  private scoped: ConfigSystemState['scoped'] = []
  constructor(readonly battle: Battle) {
    this.store = new ModifierStore(battle)
  }
  registerConfig<K extends keyof T & string>(key: K, value: T[K]) {
    this.battle.assertInOperation()
    if (!key || this.configs.has(key)) throw new Error('Duplicate or empty config key')
    validatePrimitive(value)
    this.configs.set(key, { value, tags: [] })
  }
  registerTaggedConfig<K extends keyof T & string>(key: K, value: T[K], tags: string[]) {
    this.registerConfig(key, value)
    this.addConfigTags(key, tags)
  }
  isRegistered(key: string) {
    return this.configs.has(key)
  }
  getRegisteredKeys() {
    return [...this.configs.keys()]
  }
  addConfigTags(key: keyof T & string, tags: string[]) {
    this.battle.assertInOperation()
    const entry = this.required(key)
    entry.tags = [...new Set([...entry.tags, ...tags])]
  }
  removeConfigTags(key: keyof T & string, tags: string[]) {
    this.battle.assertInOperation()
    this.required(key).tags = this.required(key).tags.filter(tag => !tags.includes(tag))
  }
  getConfigTags(key: keyof T & string) {
    return [...this.required(key).tags]
  }
  hasConfigTag(key: keyof T & string, tag: string) {
    return this.required(key).tags.includes(tag)
  }
  getConfigKeysByTag(tag: string) {
    return [...this.configs].filter(([, item]) => item.tags.includes(tag)).map(([key]) => key)
  }
  private required(key: string) {
    const value = this.configs.get(key)
    if (!value) throw new Error('Unknown config key')
    return value
  }
  get<K extends keyof T & string>(key: K, scope?: ScopeObject): T[K] | undefined {
    if (!this.configs.has(key)) return undefined
    const hierarchy = scopeHierarchy(this.battle, scope)
    return this.battle.valueSystem.guard(`config:${key}:${JSON.stringify(hierarchy[0] ?? null)}`, () => {
      let value = this.required(key).value
      for (const owner of hierarchy) {
        const item = this.scoped.find(row => row.key === key && sameScope(row.scope, owner))
        if (item) {
          value = item.value
          break
        }
      }
      for (const row of this.store.read(key, row => {
        if (row.scope && !hierarchy.some(owner => sameScope(owner, row.scope))) return false
        if (!row.source) return true
        const source = resolveScope(this.battle, row.source)
        const owner = parentScope(this.battle, source) ?? this.battle
        return hierarchy.some(ref => sameScope(ref, scopeReference(this.battle, owner)))
      }))
        value = this.apply(value, this.battle.valueSystem.read(row.value), row.type)
      return value as T[K]
    })
  }
  set<K extends keyof T & string>(key: K, value: T[K], scope?: ScopeObject) {
    this.battle.assertInOperation()
    const original = this.required(key).value
    validatePrimitive(value)
    if (typeof value !== typeof original || (value === null) !== (original === null))
      throw new Error('Config value type mismatch')
    if (!scope) this.required(key).value = value
    else {
      const ref = scopeReference(this.battle, scope),
        existing = this.scoped.find(row => row.key === key && sameScope(row.scope, ref))
      if (existing) existing.value = value
      else this.scoped.push({ key, value, scope: ref })
    }
  }
  reference<K extends keyof T & string>(key: K, scope?: ScopeObject): ConfigReference<T[K]> {
    this.required(key)
    return { kind: 'config', key, scope: scope ? scopeReference(this.battle, scope) : null }
  }
  numberReference(key: keyof T & string, scope?: ScopeObject): ConfigReference<number> {
    if (typeof this.required(key).value !== 'number') throw new Error('Config is not numeric')
    return { kind: 'config', key, scope: scope ? scopeReference(this.battle, scope) : null }
  }
  private apply(base: ConfigValue, value: ConfigValue, type: string): ConfigValue {
    if (typeof base !== typeof value || (base === null) !== (value === null))
      throw new Error('Config modifier type mismatch')
    if (type === ConfigModifierType.override) return value
    if (type === ConfigModifierType.delta && typeof base === 'number' && typeof value === 'number') {
      const result = base + value
      validatePrimitive(result)
      return result
    }
    if (type === ConfigModifierType.append && typeof base === 'string' && typeof value === 'string') return base + value
    if (type === ConfigModifierType.prepend && typeof base === 'string' && typeof value === 'string')
      return value + base
    throw new Error('Invalid config modifier operation')
  }
  addConfigModifier<K extends keyof T & string>(key: K, modifier: ConfigModifier<NoInfer<T[K]>>) {
    return this.addScopedConfigModifier(key, modifier)
  }
  addScopedConfigModifier<K extends keyof T & string>(
    key: K,
    modifier: ConfigModifier<NoInfer<T[K]>>,
    scope?: ScopeObject,
  ): () => void {
    const base = this.required(key).value
    this.apply(base, this.battle.valueSystem.read(modifier.value.value), modifier.type)
    return this.store.add(key, modifier, scope ? scopeReference(this.battle, scope) : null)
  }
  addTaggedConfigModifier(tag: string, modifier: ConfigModifier): () => void {
    const cleanup = this.getConfigKeysByTag(tag).map(key =>
      this.addConfigModifier(key as keyof T & string, modifier as ConfigModifier<T[keyof T & string]>),
    )
    return () => cleanup.forEach(remove => remove())
  }
  addPhaseTypeConfigModifier<K extends keyof T & string>(
    key: K,
    modifier: ConfigModifier<NoInfer<T[K]>>,
    spec: PhaseTypeSpec,
  ) {
    if (modifier.durationType !== ConfigDurationType.phaseType) throw new Error('Expected phaseType config modifier')
    modifier.phaseTypeSpec = spec
    return this.addConfigModifier(key, modifier)
  }
  addScopedPhaseTypeConfigModifier<K extends keyof T & string>(
    key: K,
    modifier: ConfigModifier<NoInfer<T[K]>>,
    spec: PhaseTypeSpec,
    scope?: ScopeObject,
  ) {
    if (modifier.durationType !== ConfigDurationType.phaseType) throw new Error('Expected phaseType config modifier')
    modifier.phaseTypeSpec = spec
    return this.addScopedConfigModifier(key, modifier, scope)
  }
  removeModifiersFromSource(id: string) {
    this.store.removeModifiersFromSource(id)
  }
  cleanupPhase(id: string) {
    this.scoped = this.scoped.filter(row => row.scope.type !== 'phase' || row.scope.id !== id)
  }
  snapshot(): ConfigSystemState | undefined {
    if (!this.configs.size) return undefined
    return copyData({
      configs: [...this.configs].map(([key, value]) => ({ key, ...value })),
      scoped: this.scoped,
      modifiers: this.store.snapshot(),
    })
  }
  restore(state?: ConfigSystemState) {
    this.configs = new Map((state?.configs ?? []).map(row => [row.key, { value: row.value, tags: [...row.tags] }]))
    this.scoped = copyData(state?.scoped ?? [])
    this.store.restore(state?.modifiers ?? [])
  }
  validate(state?: ConfigSystemState) {
    if (state && this.configs.size !== state.configs.length) throw new Error('Duplicate saved config')
    for (const [key, item] of this.configs) {
      if (!key) throw new Error('Empty config key')
      validatePrimitive(item.value)
    }
    for (const row of this.scoped) {
      resolveScope(this.battle, row.scope)
      if (row.scope.type === 'phase') throw new Error('Expired scoped config')
      if (typeof row.value !== typeof this.required(row.key).value) throw new Error('Saved scoped config type mismatch')
    }
    this.store.validate(Object.values(ConfigModifierType))
    for (const row of this.store.snapshot())
      this.apply(this.required(row.key).value, this.battle.valueSystem.read(row.value), row.type)
  }
}
