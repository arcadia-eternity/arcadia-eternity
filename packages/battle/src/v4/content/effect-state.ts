import { EffectTrigger } from '@arcadia-eternity/const'
import { Battle } from '../battle'
import { EffectContext } from '../context'
import { MarkInstanceImpl, type MarkInstance } from '../mark'
import { Pet } from '../pet'
import { Player } from '../player'
import { SkillInstance } from '../skill'
import type { ConfigSystem, ConfigValue } from '../config'

interface StateTypes {
  number: number
  boolean: boolean
  string: string
}
export type EffectStateEntity = Battle | Player | Pet | SkillInstance | MarkInstance
export interface EffectStateDefinition<K extends keyof StateTypes = keyof StateTypes> {
  /** Package-qualified identity, normally supplied by the module factory's id(). */
  readonly id: string
  readonly type: K
  readonly default: StateTypes[K]
}
const definitions = new WeakSet<object>()
const valuePrefix = 'ae:state:'
const definitionPrefix = 'ae:state-definition:'
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length <= 200 && /^[A-Za-z0-9@_./-]+:[A-Za-z0-9_./-]+$/.test(id)
function validValue(type: keyof StateTypes, value: unknown): value is StateTypes[keyof StateTypes] {
  return (
    typeof value === type &&
    (type !== 'number' || Number.isFinite(value)) &&
    (type !== 'string' || (value as string).length <= 16_384)
  )
}
function assertDefinition(value: EffectStateDefinition): void {
  if (
    !value ||
    !validId(value.id) ||
    !['number', 'boolean', 'string'].includes(value.type) ||
    !validValue(value.type, value.default)
  )
    throw new Error('Invalid effect state definition or ID')
}
/** Immutable field metadata; its values belong to an entity in a particular battle. */
export function defineEffectState<K extends keyof StateTypes>(
  input: EffectStateDefinition<K>,
): EffectStateDefinition<K> {
  assertDefinition(input)
  const definition = Object.freeze({ id: input.id, type: input.type, default: input.default })
  definitions.add(definition)
  return definition
}
function belongs(battle: Battle, entity: unknown, creating?: MarkInstanceImpl): entity is EffectStateEntity {
  if (entity === battle) return true
  if (entity instanceof Player) return entity === battle.playerA || entity === battle.playerB
  if (entity instanceof Pet)
    return !!entity.owner && belongs(battle, entity.owner) && entity.owner.team.includes(entity)
  if (entity instanceof SkillInstance)
    return !!entity.owner && belongs(battle, entity.owner) && entity.owner.skills.includes(entity)
  if (entity instanceof MarkInstanceImpl)
    return (
      !!entity.owner && belongs(battle, entity.owner) && (entity.owner.marks.includes(entity) || entity === creating)
    )
  return false
}
function stateConfig(
  context: EffectContext<EffectTrigger>,
  entity: EffectStateEntity,
  definition: EffectStateDefinition,
) {
  if (!(context instanceof EffectContext) || !definitions.has(definition))
    throw new Error('Expected effect context and SDK state definition')
  const battle = context.battle
  // Mark creation effects run after owner assignment, before insertion in the owner's marks.
  const creating =
    context.trigger === EffectTrigger.OnMarkCreated && context.source instanceof MarkInstanceImpl
      ? context.source
      : undefined
  if (!(battle instanceof Battle) || battle.configSystem.isDisposed || !belongs(battle, entity, creating))
    throw new Error('Effect state entity must belong to the current active battle')
  const config = battle.configSystem
  const key = valuePrefix + definition.id
  const metadataKey = definitionPrefix + definition.id
  const metadata = JSON.stringify([definition.type, definition.default])
  if (config.hasRegisteredConfig(metadataKey)) {
    if (config.getOwnConfig(metadataKey) !== metadata || config.getOwnConfig(key) !== definition.default)
      throw new Error(`Conflicting effect state definition: ${definition.id}`)
  } else {
    if (config.hasRegisteredConfig(key)) throw new Error(`Conflicting effect state definition: ${definition.id}`)
    config.registerConfig(metadataKey, metadata)
    config.registerConfig(key, definition.default)
  }
  return { config, key }
}
/** Reads only this entity's value, never a parent's value or a parameter modifier. */
export function getEffectState<K extends keyof StateTypes>(
  context: EffectContext<EffectTrigger>,
  entity: EffectStateEntity,
  definition: EffectStateDefinition<K>,
): StateTypes[K] {
  const { config, key } = stateConfig(context, entity, definition)
  const value = config.hasScopedConfig(key, entity) ? config.getOwnConfig(key, entity) : definition.default
  if (!validValue(definition.type, value)) throw new Error(`Invalid effect state value: ${definition.id}`)
  return value as StateTypes[K]
}
export function setEffectState<K extends keyof StateTypes>(
  context: EffectContext<EffectTrigger>,
  entity: EffectStateEntity,
  definition: EffectStateDefinition<K>,
  value: StateTypes[K],
): void {
  if (!validValue(definition.type, value)) throw new Error(`Invalid effect state value: ${definition.id}`)
  const { config, key } = stateConfig(context, entity, definition)
  config.set(key, value, entity)
}

/** Validate reserved state entries before writing or restoring the existing config snapshot. */
export function validateEffectStateSnapshot(
  battle: Battle,
  state: ReturnType<ConfigSystem['exportSnapshotState']>,
): void {
  const declared = new Map<string, EffectStateDefinition>()
  for (const [key, metadata] of state.base) {
    if (!key.startsWith(definitionPrefix)) continue
    const id = key.slice(definitionPrefix.length)
    if (typeof metadata !== 'string') throw new Error('Invalid effect state metadata')
    let data: unknown
    try {
      data = JSON.parse(metadata)
    } catch {
      throw new Error('Invalid effect state metadata')
    }
    if (!Array.isArray(data) || data.length !== 2) throw new Error('Invalid effect state metadata')
    const definition: EffectStateDefinition = { id, type: data[0], default: data[1] }
    assertDefinition(definition)
    const address = valuePrefix + id
    if (state.base.get(address) !== definition.default) throw new Error('Invalid effect state default')
    declared.set(address, definition)
  }
  const validateValue = (key: string, value: ConfigValue) => {
    const definition = declared.get(key)
    if (!definition || !validValue(definition.type, value)) throw new Error('Invalid effect state value')
  }
  for (const [key, value] of state.base) if (key.startsWith(valuePrefix)) validateValue(key, value)
  for (const [entity, entries] of state.scopedBase) {
    for (const [key, value] of entries) {
      if (key.startsWith(definitionPrefix)) throw new Error('Effect state definitions cannot be entity-scoped')
      if (!key.startsWith(valuePrefix)) continue
      if (!belongs(battle, entity)) throw new Error('Effect state entity must belong to the snapshotted battle')
      validateValue(key, value)
    }
  }
  const reserved = (key: string) => key.startsWith(valuePrefix) || key.startsWith(definitionPrefix)
  for (const [key, modifiers] of state.global)
    if (reserved(key) && modifiers.length) throw new Error('Effect state does not support parameter modifiers')
  for (const entries of state.scopedModifiers.values())
    for (const [key, modifiers] of entries)
      if (reserved(key) && modifiers.length) throw new Error('Effect state does not support parameter modifiers')
}
