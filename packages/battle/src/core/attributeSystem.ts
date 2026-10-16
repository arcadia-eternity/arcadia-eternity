import type { StatOnBattle } from '@arcadia-eternity/const'
import type { Pet } from './pet.js'
import type { Player } from './player.js'
import type { Skill } from './skill.js'
import type { Mark } from './mark.js'
import { copyData } from './data.js'
import {
  ModifierStore,
  ValueCell,
  scopeReference,
  validatePrimitive,
  type AttributeValue,
  type ConfigValue,
  type ValueInput,
  type PhaseTypeSpec,
  type LiveModifier,
  type ModifierRow,
  type AttributeReference,
} from './values.js'
export enum DurationType {
  instant = 'instant',
  binding = 'binding',
  phase = 'phase',
  phaseType = 'phaseType',
}
export type ModifierType<T> = T extends number
  ? 'percent' | 'delta' | 'override' | 'clampMax' | 'clampMin' | 'clamp'
  : 'override'
export class Modifier<T extends AttributeValue = AttributeValue> {
  readonly value: ValueCell<ValueInput<T>>
  tags: string[] = []
  constructor(
    public durationType: DurationType,
    public id: string,
    initialValue: ValueInput<T>,
    public type: ModifierType<T>,
    public priority = 0,
    public source?: LiveModifier['source'],
    public minValue?: number,
    public maxValue?: number,
    public phaseTypeSpec?: PhaseTypeSpec,
  ) {
    this.value = new ValueCell(initialValue)
  }
  getCurrentValue() {
    return this.value.value
  }
}
export interface AttributeSystemState {
  base: Record<string, AttributeValue>
  modifiers: ModifierRow[]
}
export interface AttributeAdjustment {
  id: string
  type: string
  priority: number
  value: ValueInput<ConfigValue>
  tags: string[]
  minValue?: number | null
  maxValue?: number | null
}
export interface SkillAttributeSet {
  power: number
  accuracy: number
  rage: number
  priority: number
  appeared: boolean
}
export interface MarkAttributeSet {
  stack: number
  duration: number
  isActive: boolean
}
export interface PlayerAttributeSet {
  currentRage: number
  maxRage: number
}
export type PetAttributeSet = { [K in keyof StatOnBattle as `${K}`]: StatOnBattle[K] } & { currentHp: number }
export type AttributeOwner = Pet | Player | Skill | Mark
const types = ['percent', 'delta', 'override', 'clampMax', 'clampMin', 'clamp'] as const
function apply(current: AttributeValue, value: AttributeValue, modifier: AttributeAdjustment): AttributeValue {
  if (typeof current !== typeof value) throw new Error('Attribute modifier value type mismatch')
  if (modifier.type === 'override') return value
  if (typeof current !== 'number' || typeof value !== 'number') throw new Error('Numeric modifier requires numbers')
  switch (modifier.type) {
    case 'percent':
      return current * (1 + value / 100)
    case 'delta':
      return current + value
    case 'clampMax':
      return Math.min(current, value)
    case 'clampMin':
      return Math.max(current, value)
    case 'clamp':
      return Math.max(modifier.minValue ?? -Number.MAX_VALUE, Math.min(modifier.maxValue ?? Number.MAX_VALUE, current))
    default:
      throw new Error('Invalid attribute modifier operation')
  }
}
/** Typed attributes evaluate on read, including live references; no Observer/host object enters a save. */
export class AttributeSystem<T extends { [K in keyof T]: AttributeValue }> {
  readonly store: ModifierStore
  private overrides: Partial<T> = {}
  constructor(
    readonly owner: AttributeOwner,
    private readonly base: () => T,
    private readonly writeBase?: <K extends keyof T>(key: K, value: T[K]) => boolean,
    private readonly native: (key: keyof T) => AttributeAdjustment[] = () => [],
  ) {
    this.store = new ModifierStore(owner.battle)
  }
  hasKey(key: string): boolean {
    return Object.hasOwn(this.base(), key)
  }
  getBaseValue<K extends keyof T>(key: K): T[K] {
    if (!Object.hasOwn(this.base(), key)) throw new Error('Unknown attribute key')
    return this.overrides[key] ?? this.base()[key]
  }
  updateBaseValue<K extends keyof T>(key: K, value: T[K]) {
    validatePrimitive(value)
    const original = this.getBaseValue(key)
    if (typeof original !== typeof value) throw new Error('Attribute base type mismatch')
    if (!this.writeBase?.(key, value)) this.overrides[key] = value
  }
  refreshBase() {
    this.overrides = {}
  }
  getCurrentValue<K extends keyof T>(key: K, accept: (modifier: AttributeAdjustment) => boolean = () => true): T[K] {
    return this.owner.battle.valueSystem.guard(`attribute:${this.owner.id}:${String(key)}`, () => {
      let result: AttributeValue = this.getBaseValue(key)
      const adjustments: AttributeAdjustment[] = [...this.native(key), ...this.store.read(String(key))]
      for (const modifier of adjustments.filter(accept).sort((a, b) => b.priority - a.priority)) {
        const value = this.owner.battle.valueSystem.read(modifier.value)
        if (value === null) throw new Error('Attribute modifier cannot yield null')
        result = apply(result, value, modifier)
        validatePrimitive(result)
      }
      return result as T[K]
    })
  }
  readKey(key: string): AttributeValue {
    if (!this.hasKey(key)) throw new Error('Unknown referenced attribute')
    return this.getCurrentValue(key as keyof T)
  }
  reference<K extends keyof T & string>(key: K): AttributeReference<T[K]> {
    if (!this.hasKey(key)) throw new Error('Unknown referenced attribute')
    return { kind: 'attribute', owner: scopeReference(this.owner.battle, this.owner), key }
  }
  addModifier<K extends keyof T & string>(key: K, modifier: Modifier<NoInfer<T[K]>>): () => void {
    if (!this.hasKey(key) || !types.includes(modifier.type)) throw new Error('Invalid attribute modifier key/type')
    const base = this.getBaseValue(key)
    const value = this.owner.battle.valueSystem.read(modifier.value.value)
    apply(base, value as AttributeValue, { ...modifier, value: modifier.value.value })
    const cleanup = this.store.add(key, modifier)
    try {
      this.getCurrentValue(key)
    } catch (error) {
      cleanup()
      throw error
    }
    return cleanup
  }
  addPhaseTypeModifier<K extends keyof T & string>(key: K, modifier: Modifier<NoInfer<T[K]>>, spec: PhaseTypeSpec) {
    if (modifier.durationType !== DurationType.phaseType) throw new Error('Expected phaseType modifier')
    modifier.phaseTypeSpec = spec
    return this.addModifier(key, modifier)
  }
  removeModifiersFromSource(id: string) {
    this.store.removeModifiersFromSource(id)
  }
  getAllCurrentValues(): T {
    const result = { ...this.base() }
    for (const key of Object.keys(result) as (keyof T)[]) result[key] = this.getCurrentValue(key)
    return result
  }
  snapshot(): AttributeSystemState | undefined {
    const modifiers = this.store.snapshot()
    if (!modifiers.length && !Object.keys(this.overrides).length) return undefined
    return copyData({ base: { ...this.base(), ...this.overrides }, modifiers })
  }
  restore(state?: AttributeSystemState) {
    this.overrides = {}
    if (state)
      for (const [key, value] of Object.entries(state.base)) this.updateBaseValue(key as keyof T, value as T[keyof T])
    this.store.restore(state?.modifiers ?? [])
  }
  validate() {
    this.store.validate(types)
    for (const modifier of this.store.snapshot()) {
      if (!this.hasKey(modifier.key)) throw new Error('Invalid saved attribute key')
      const value = this.owner.battle.valueSystem.read(modifier.value)
      if (value === null) throw new Error('Invalid saved attribute value')
      apply(this.getBaseValue(modifier.key as keyof T), value, modifier)
    }
  }
}
