import type { Battle } from './battle.js'
import { Pet } from './pet.js'
import { Player } from './player.js'
import { Skill } from './skill.js'
import { Mark } from './mark.js'
import { BattlePhaseBase } from './phase/base.js'
import type { ContextNode } from './context.js'
import { copyData, type JsonObject } from './data.js'

export type ConfigValue = string | number | boolean | null
export type AttributeValue = Exclude<ConfigValue, null>
export enum PhaseType {
  Turn = 'turn',
  Skill = 'skill',
  Damage = 'damage',
  Heal = 'heal',
  Effect = 'effect',
  Switch = 'switch',
  Mark = 'mark',
  Rage = 'rage',
  Battle = 'battle',
}
export enum PhaseScope {
  Current = 'current',
  Any = 'any',
  Next = 'next',
}
export interface PhaseTypeSpec {
  phaseType: PhaseType
  phaseId?: string
  scope: PhaseScope
}
export type ScopeObject = Battle | Player | Pet | Skill | Mark | BattlePhaseBase<ContextNode, unknown>
export interface ScopeReference {
  type: 'battle' | 'player' | 'pet' | 'skill' | 'mark' | 'phase'
  id: string
}
export interface AttributeReference<T extends ConfigValue = ConfigValue> {
  kind: 'attribute'
  owner: ScopeReference
  key: string
  readonly resultType?: T
}
export interface ConfigReference<T extends ConfigValue = ConfigValue> {
  kind: 'config'
  key: string
  scope: ScopeReference | null
  readonly resultType?: T
}
export interface ComputedReference<T extends ConfigValue = ConfigValue> {
  kind: 'computed'
  id: string
  version: string
  params: JsonObject
  readonly resultType?: T
}
export type ValueInput<T extends ConfigValue> = T | AttributeReference<T> | ConfigReference<T> | ComputedReference<T>
export interface TrustedValue<T extends ConfigValue = ConfigValue> {
  id: string
  version: string
  evaluate(battle: Battle, params: JsonObject): T
}
/** Runtime TS calculations are supplied by stable code identity, never serialized as closures. */
export function computed<T extends ConfigValue>(
  id: string,
  version: string,
  params: JsonObject = {},
): ComputedReference<T> {
  return copyData({ kind: 'computed', id, version, params })
}
export class ValueCell<T> {
  constructor(private current: T) {}
  get value(): T {
    return this.current
  }
  next(value: T) {
    this.current = value
  }
}
export function scopeReference(battle: Battle, scope: ScopeObject): ScopeReference {
  if (scope.battle !== battle) throw new Error('Value scope belongs to another battle')
  const type =
    scope instanceof Pet
      ? 'pet'
      : scope instanceof Skill
        ? 'skill'
        : scope instanceof Mark
          ? 'mark'
          : scope instanceof Player
            ? 'player'
            : scope instanceof BattlePhaseBase
              ? 'phase'
              : 'battle'
  if (!scope.id) throw new Error('Scope requires a deterministic ID')
  const ref: ScopeReference = { type, id: scope.id }
  if (resolveScope(battle, ref) !== scope) throw new Error('Value scope is no longer live')
  return ref
}
export function resolveScope(battle: Battle, ref: ScopeReference): ScopeObject {
  if (ref.type === 'battle' && ref.id === battle.id) return battle
  if (ref.type === 'player') return battle.getPlayerByID(ref.id)
  if (ref.type === 'pet') return battle.getPetByID(ref.id)
  if (ref.type === 'skill') return battle.getSkillByID(ref.id)
  if (ref.type === 'mark') {
    const mark = [battle, ...battle.players.flatMap(player => player.team)]
      .flatMap(owner => owner.marks)
      .find(mark => mark.id === ref.id)
    if (mark) return mark
  }
  if (ref.type === 'phase') {
    const phase = battle.phaseManager.getActivePhases().find(phase => phase.id === ref.id)
    if (phase) return phase
  }
  throw new Error('Invalid or expired value scope reference')
}
export function scopeHierarchy(battle: Battle, scope?: ScopeObject): ScopeReference[] {
  const result: ScopeReference[] = []
  let node = scope
  while (node) {
    result.push(scopeReference(battle, node))
    if (node === battle) break
    node = parentScope(battle, node)
  }
  return result
}
export function parentScope(battle: Battle, scope: ScopeObject): ScopeObject | undefined {
  if (scope === battle) return undefined
  if (scope instanceof Mark) {
    if (scope.owner === battle) return battle
    if (scope.owner instanceof Pet) return scope.owner
    throw new Error('Invalid mark owner scope')
  }
  if (scope instanceof Skill || scope instanceof Pet || scope instanceof Player) return scope.owner
  return battle
}
export function sameScope(a: ScopeReference | null, b: ScopeReference | null) {
  return a === null || b === null ? a === b : a.type === b.type && a.id === b.id
}
export interface ModifierLifetime {
  durationType: 'instant' | 'binding' | 'phase' | 'phaseType'
  source: ScopeReference | null
  phaseTypeSpec: PhaseTypeSpec | null
  boundPhaseId: string | null
  excludedPhaseId: string | null
}
export interface ModifierRow extends ModifierLifetime {
  key: string
  id: string
  value: ValueInput<ConfigValue>
  type: string
  priority: number
  minValue: number | null
  maxValue: number | null
  scope: ScopeReference | null
  tags: string[]
}
export interface LiveModifier {
  durationType: ModifierLifetime['durationType']
  id: string
  value: ValueCell<ValueInput<ConfigValue>>
  type: string
  priority: number
  source?: Skill | Mark | BattlePhaseBase<ContextNode, unknown>
  minValue?: number
  maxValue?: number
  phaseTypeSpec?: PhaseTypeSpec
  tags?: string[]
}
export function phaseType(kind: string): PhaseType | null {
  if (['skill', 'damage', 'heal', 'rage', 'effect'].includes(kind)) return kind as PhaseType
  if (kind === 'switch-pet') return PhaseType.Switch
  if (kind.includes('mark') || kind === 'consume-stack') return PhaseType.Mark
  return null
}
/** Per-Battle lifecycle and guarded evaluation. There is no singleton or global battle registry. */
export class ValueSystem {
  private evaluating = new Set<string>()
  constructor(readonly battle: Battle) {}
  guard<T>(key: string, read: () => T): T {
    if (this.evaluating.has(key)) throw new Error(`Cyclic value dependency: ${key}`)
    this.evaluating.add(key)
    try {
      return read()
    } finally {
      this.evaluating.delete(key)
    }
  }
  currentId(type: PhaseType): string | null {
    if (type === PhaseType.Turn) return this.battle.activeTurn ? `@turn/${this.battle.activeTurn.data.number}` : null
    if (type === PhaseType.Battle) return this.battle.status === 'active' ? this.battle.id : null
    return (
      this.battle.phaseManager
        .getActivePhases()
        .slice()
        .reverse()
        .find(phase => phaseType(phase.kind) === type)?.id ?? null
    )
  }
  lifetime(modifier: LiveModifier): ModifierLifetime {
    const source = modifier.source ? scopeReference(this.battle, modifier.source) : null
    const spec = modifier.phaseTypeSpec ? copyData(modifier.phaseTypeSpec) : null
    if (!['instant', 'binding', 'phase', 'phaseType'].includes(modifier.durationType))
      throw new Error('Invalid modifier duration')
    if (modifier.durationType === 'binding' && !source) throw new Error('Binding modifier requires a source')
    let boundPhaseId: string | null = null,
      excludedPhaseId: string | null = null
    if (modifier.durationType === 'phase') {
      boundPhaseId =
        source?.type === 'phase' ? source.id : (this.battle.phaseManager.getActivePhases().at(-1)?.id ?? null)
      if (!boundPhaseId) throw new Error('Phase modifier requires an active phase')
    }
    if (modifier.durationType === 'phaseType') {
      if (
        !spec ||
        !Object.values(PhaseType).includes(spec.phaseType) ||
        !Object.values(PhaseScope).includes(spec.scope)
      )
        throw new Error('Invalid phase type binding')
      const current = this.currentId(spec.phaseType)
      if (spec.scope === PhaseScope.Current) {
        if (!current || (spec.phaseId && spec.phaseId !== current))
          throw new Error('Current binding requires its active phase')
        boundPhaseId = current
      } else if (spec.scope === PhaseScope.Next) excludedPhaseId = current
      else boundPhaseId = current && (!spec.phaseId || spec.phaseId === current) ? current : null
    }
    return { durationType: modifier.durationType, source, phaseTypeSpec: spec, boundPhaseId, excludedPhaseId }
  }
  sourceActive(ref: ScopeReference | null) {
    if (!ref) return true
    try {
      const source = resolveScope(this.battle, ref)
      return !(source instanceof Mark) || (source.isActive && !source.effectsSuppressed)
    } catch {
      return false
    }
  }
  applicable(row: ModifierRow): boolean {
    if (!this.sourceActive(row.source)) return false
    if (row.durationType === 'phaseType')
      return !!row.boundPhaseId && this.currentId(row.phaseTypeSpec!.phaseType) === row.boundPhaseId
    if (row.durationType === 'phase')
      return this.battle.phaseManager.getActivePhases().some(phase => phase.id === row.boundPhaseId)
    return true
  }
  enter() {
    for (const store of this.battle.getValueStores()) store.bindPending()
  }
  complete(type: PhaseType | null, id: string) {
    for (const store of this.battle.getValueStores()) store.complete(type, id)
  }
  removeSource(sourceId: string) {
    for (const store of this.battle.getValueStores()) store.removeModifiersFromSource(sourceId)
  }
  read<T extends ConfigValue>(input: ValueInput<T>): T {
    if (input === null || typeof input !== 'object') {
      validatePrimitive(input)
      return input
    }
    let result: ConfigValue
    if (input.kind === 'computed') {
      result = this.guard(`computed:${input.id}:${JSON.stringify(input.params)}`, () =>
        this.battle.registry.resolveValue(input).evaluate(this.battle, copyData(input.params)),
      )
    } else if (input.kind === 'config') {
      result =
        this.battle.configSystem.get(input.key, input.scope ? resolveScope(this.battle, input.scope) : undefined) ??
        null
    } else if (input.kind === 'attribute') {
      const owner = resolveScope(this.battle, input.owner)
      if (!('attributeSystem' in owner)) throw new Error('Value owner has no attributes')
      result = owner.attributeSystem.readKey(input.key)
    } else throw new Error('Invalid value reference')
    validatePrimitive(result)
    // Reference constructors bind T to their typed owner/key, or a trusted evaluator contract.
    return result as T
  }
  validateInput(input: ValueInput<ConfigValue>) {
    copyData(input)
    if (input === null || typeof input !== 'object') return validatePrimitive(input)
    if (input.kind === 'computed') this.battle.registry.resolveValue(input)
    else if (input.kind === 'attribute') {
      const owner = resolveScope(this.battle, input.owner)
      if (!('attributeSystem' in owner) || !owner.attributeSystem.hasKey(input.key))
        throw new Error('Invalid attribute value reference')
    } else if (input.kind === 'config') {
      if (!this.battle.configSystem.isRegistered(input.key)) throw new Error('Invalid config value reference')
      if (input.scope) resolveScope(this.battle, input.scope)
    } else throw new Error('Invalid modifier value')
  }
}
export function validatePrimitive(value: unknown): asserts value is ConfigValue {
  if (value !== null && !['string', 'boolean', 'number'].includes(typeof value))
    throw new Error('Expected a primitive config value')
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Expected finite modifier value')
}
export class ModifierStore {
  private rows: { row: ModifierRow; live: LiveModifier | null }[] = []
  constructor(readonly battle: Battle) {}
  snapshot(): ModifierRow[] {
    return copyData(this.rows.map(({ row, live }) => ({ ...row, value: live ? live.value.value : row.value })))
  }
  restore(rows: ModifierRow[]) {
    this.rows = copyData(rows).map(row => ({ row, live: null }))
  }
  add(key: string, modifier: LiveModifier, scope: ScopeReference | null = null): () => void {
    this.battle.assertInOperation()
    if (!modifier.id || !Number.isSafeInteger(modifier.priority)) throw new Error('Invalid modifier identity/priority')
    this.battle.valueSystem.validateInput(modifier.value.value)
    const row: ModifierRow = {
      key,
      id: modifier.id,
      value: copyData(modifier.value.value),
      type: modifier.type,
      priority: modifier.priority,
      minValue: modifier.minValue ?? null,
      maxValue: modifier.maxValue ?? null,
      scope,
      tags: modifier.tags ? [...modifier.tags] : [],
      ...this.battle.valueSystem.lifetime(modifier),
    }
    const entry = { row, live: modifier }
    const existing = this.rows.findIndex(
      item =>
        item.row.key === key &&
        item.row.id === row.id &&
        sameScope(item.row.source, row.source) &&
        sameScope(item.row.scope, row.scope),
    )
    if (existing < 0) this.rows.push(entry)
    else this.rows[existing] = entry
    return () => {
      this.battle.assertInOperation()
      this.rows = this.rows.filter(item => item !== entry)
    }
  }
  read(key: string, accept: (row: ModifierRow) => boolean = () => true): ModifierRow[] {
    return this.rows
      .filter(({ row }) => row.key === key && accept(row) && this.battle.valueSystem.applicable(row))
      .map(({ row, live }) => ({ ...row, value: live ? live.value.value : row.value }))
      .sort((a, b) => b.priority - a.priority)
  }
  bindPending() {
    for (const { row } of this.rows)
      if (row.durationType === 'phaseType' && !row.boundPhaseId) {
        const spec = row.phaseTypeSpec!,
          id = this.battle.valueSystem.currentId(spec.phaseType)
        if (id && id !== row.excludedPhaseId && (!spec.phaseId || id === spec.phaseId)) row.boundPhaseId = id
      }
  }
  complete(type: PhaseType | null, id: string) {
    this.rows = this.rows.filter(
      ({ row }) =>
        !(row.source?.type === 'phase' && row.source.id === id) &&
        !(row.scope?.type === 'phase' && row.scope.id === id) &&
        !(
          (row.durationType === 'phase' && row.boundPhaseId === id) ||
          (row.durationType === 'phaseType' && row.phaseTypeSpec?.phaseType === type && row.boundPhaseId === id)
        ),
    )
  }
  removeModifiersFromSource(id: string) {
    this.rows = this.rows.filter(({ row }) => row.source?.id !== id)
  }
  validate(allowedTypes: readonly string[]) {
    const seen = new Set<string>()
    for (const row of this.snapshot()) {
      const identity = JSON.stringify([row.key, row.id, row.scope, row.source])
      if (
        !row.id ||
        seen.has(identity) ||
        !allowedTypes.includes(row.type) ||
        !Number.isSafeInteger(row.priority) ||
        !['instant', 'binding', 'phase', 'phaseType'].includes(row.durationType)
      )
        throw new Error('Invalid saved modifier')
      seen.add(identity)
      this.battle.valueSystem.validateInput(row.value)
      if (row.source) resolveScope(this.battle, row.source)
      if (row.scope) resolveScope(this.battle, row.scope)
      if (row.minValue !== null) {
        if (typeof row.minValue !== 'number') throw new Error('Invalid modifier bound')
        validatePrimitive(row.minValue)
      }
      if (row.maxValue !== null) {
        if (typeof row.maxValue !== 'number') throw new Error('Invalid modifier bound')
        validatePrimitive(row.maxValue)
      }
      if (row.durationType === 'phase' || row.source?.type === 'phase' || row.scope?.type === 'phase')
        throw new Error('Expired phase in snapshot')
      if (row.durationType === 'binding' && !row.source) throw new Error('Missing modifier source')
      if (row.durationType === 'phaseType') {
        const spec = row.phaseTypeSpec
        if (
          !spec ||
          !Object.values(PhaseType).includes(spec.phaseType) ||
          !Object.values(PhaseScope).includes(spec.scope)
        )
          throw new Error('Invalid saved phase binding')
        if (row.boundPhaseId && row.boundPhaseId !== this.battle.valueSystem.currentId(spec.phaseType))
          throw new Error('Expired phase type binding')
      }
    }
  }
}
