import { markParameterContract, normalizeMarkInstanceParams, sameMarkInstanceParams } from './content/mark-parameters'
import mitt from 'mitt'
import { BattleStatus, BattlePhase, type EffectTrigger, type Events } from '@arcadia-eternity/const'
import { Battle } from './battle'
import { Player, AIPlayer } from './player'
import { Pet } from './pet'
import { BaseSkill, SkillInstance } from './skill'
import { type MarkInstance, BaseMark, BaseStatLevelMark, MarkInstanceImpl, StatLevelMarkInstanceImpl } from './mark'
import { Effect } from './effect'
import {
  ComposableAttributeSystem,
  type StatLevelMarkAttributeSet,
  type SkillAttributeSet,
  type RageAttributeSet,
  AttributeSystem,
  PetAttributeSystem,
  PlayerAttributeSystem,
  MarkAttributeSystem,
  SkillAttributeSystem,
  createStatLevelMarkAttributeSystem,
  Modifier,
  type AttributeData,
} from './attributeSystem'
import { ConfigSystem, ConfigModifier } from './config'
import { PhaseManager, PhaseState } from './phase'
import { TimerManager } from './timer'
import { TransformationSystem } from './transformation'
import { createChildLogger } from './logger'
import { ExecutionBudget } from './execution/budget'
import { GameRng } from './rng'
import {
  Signal,
  ReactiveValue,
  derived,
  describeValue,
  getValueRecipe,
  projectValue,
  combineValues,
  type ValueRecipe,
  type ValueProjection,
} from './reactiveValue'
import { getCleanupBinding, getModifierCleanup, describeCleanup } from './snapshotBindings'
import { bindValue, RestoredBoundValue, validateBindingState, type BoundValue } from './values/binding'
import { bindingEntity, bindingOwner, type BindingTarget } from './values/dependencies'
import type { ValueDefinition, BindingState } from './values/plan'
import { initializeOwnerRelations, initializePetRelations, initializePlayerRelations } from './values/relations'

type Atom = null | boolean | string | number
type Encoded = Atom | { ref: number } | { atom: 'undefined' | 'Infinity' | '-Infinity' | 'NaN' | '-0' }
interface Node {
  kind: string
  fields: Record<string, Encoded>
}
export interface BattleSnapshot {
  format: 'arcadia.v1.battle-snapshot'
  version: 1
  boundary?: 'initial' | 'switch' | 'team-selection'
  catalog: string
  root: Encoded
  nodes: Node[]
}

/** Effects are executable content, resolved from trusted, revisioned content after loading JSON. */
export class SnapshotCatalog {
  private sealed = false
  /** Prevent registration changes after publishing a content environment. */
  seal(): this {
    this.sealed = true
    Object.freeze(this)
    return this
  }
  private assertWritable(): void {
    if (this.sealed) throw new Error('Snapshot catalog is sealed')
  }
  private effects = new Map<string, Effect<EffectTrigger>>()
  private effectKeys = new WeakMap<Effect<EffectTrigger>, string>()
  private content = new Map<string, object>()
  private contentKeys = new WeakMap<object, string>()
  /** Registered prototypes are immutable content supplied by the same revision on each host. */
  registerContent(key: string, value: object): this {
    this.assertWritable()
    if (
      !(value instanceof BaseMark) &&
      !(value instanceof BaseSkill) &&
      !(Object.getPrototypeOf(value) === Object.prototype && 'baseStats' in value && 'id' in value)
    )
      throw new Error('Snapshot content must be a V1 species/skill/mark prototype')
    if (this.content.has(key) && this.content.get(key) !== value) throw new Error(`Duplicate snapshot content: ${key}`)
    this.content.set(key, value)
    this.contentKeys.set(value, key)
    return this
  }
  contentKey(value: object): string | undefined {
    return this.contentKeys.get(value)
  }
  resolveContent(key: string): object {
    const value = this.content.get(key)
    if (!value) throw new Error(`Missing snapshot content: ${key}`)
    return value
  }
  assertValue(key: string): void {
    if (!this.values.has(key)) throw new Error(`Missing snapshot value factory: ${key}`)
  }
  private values = new Map<string, (args: unknown) => ReactiveValue<unknown>>()
  private bindings = new Map<string, (args: unknown, state: BindingState, target: BindingTarget) => BoundValue>()
  private bindingDefinitions = new Map<string, object>()
  private bindingSources = new Map<string, (args: unknown) => MarkInstance>()
  registerValueBinding<A>(definition: ValueDefinition<A>): this {
    this.assertWritable()
    if (this.bindings.has(definition.id)) throw new Error(`Duplicate value binding definition: ${definition.id}`)
    this.bindings.set(definition.id, (args, state, target) => bindValue(definition, args as A, target, state, true))
    this.bindingDefinitions.set(definition.id, definition)
    const source = definition.source
    if (source) this.bindingSources.set(definition.id, args => source(args as A))
    return this
  }
  /** Preflight a trusted effect and all its factories before mutating this catalog. */
  registerEffectWithBindings<A>(
    key: string,
    effect: Effect<EffectTrigger>,
    definitions: readonly ValueDefinition<A>[],
  ): this {
    this.assertWritable()
    if (this.effects.has(key) && this.effects.get(key) !== effect) throw new Error(`Duplicate snapshot effect: ${key}`)
    const unique = new Map<string, ValueDefinition<A>>()
    for (const definition of definitions) {
      const previous = unique.get(definition.id) ?? this.bindingDefinitions.get(definition.id)
      if (previous && previous !== definition) throw new Error(`Duplicate value binding definition: ${definition.id}`)
      unique.set(definition.id, definition)
    }
    this.registerEffect(key, effect)
    for (const definition of unique.values()) {
      if (!this.bindingDefinitions.has(definition.id)) this.registerValueBinding(definition)
    }
    return this
  }
  assertValueBindingSource(key: string, args: unknown, source: unknown): void {
    this.assertValueBinding(key)
    const expected = this.bindingSources.get(key)
    if (expected && expected(args) !== source) throw new Error('Invalid bound contribution source')
  }
  assertValueBinding(key: string): void {
    if (!this.bindings.has(key)) throw new Error(`Missing value binding definition: ${key}`)
  }
  restoreValueBinding(key: string, args: unknown, state: unknown, target: BindingTarget): BoundValue {
    this.assertValueBinding(key)
    validateBindingState(state)
    return this.bindings.get(key)!(args, state, target)
  }
  constructor(public readonly revision: string) {
    if (!revision) throw new Error('Snapshot catalog revision is required')
  }
  registerEffect(key: string, effect: Effect<EffectTrigger>): this {
    this.assertWritable()
    if (this.effects.has(key) && this.effects.get(key) !== effect) throw new Error(`Duplicate snapshot effect: ${key}`)
    this.effects.set(key, effect)
    this.effectKeys.set(effect, key)
    return this
  }
  registerValue(key: string, restore: (args: unknown) => ReactiveValue<unknown>): this {
    this.assertWritable()
    if (this.values.has(key)) throw new Error(`Duplicate snapshot value: ${key}`)
    this.values.set(key, restore)
    return this
  }
  describeValue<T>(value: ReactiveValue<T>, key: string, args: unknown): ReactiveValue<T> {
    if (!this.values.has(key)) throw new Error(`Missing snapshot value factory: ${key}`)
    return describeValue(value, { type: 'custom', key, args })
  }
  effectKey(effect: Effect<EffectTrigger>): string {
    const key = this.effectKeys.get(effect)
    if (!key) throw new Error(`Unregistered snapshot effect: ${effect.id}`)
    return key
  }
  resolveEffect(key: string): Effect<EffectTrigger> {
    const effect = this.effects.get(key)
    if (!effect) throw new Error(`Missing snapshot effect: ${key}`)
    return effect
  }
  restoreValue(key: string, args: unknown): ReactiveValue<unknown> {
    const restore = this.values.get(key)
    if (!restore) throw new Error(`Missing snapshot value factory: ${key}`)
    return restore(args)
  }
}

// Wire tags are stable protocol identifiers, independent of bundler class renaming.
const attributeTypes = {
  AttributeSystem,
  PetAttributeSystem,
  PlayerAttributeSystem,
  MarkAttributeSystem,
  SkillAttributeSystem,
  ComposableAttributeSystem,
}
function attributeTag(value: object): string {
  const entry = Object.entries(attributeTypes).find(([, ctor]) => Object.getPrototypeOf(value) === ctor.prototype)
  if (!entry) throw new Error('Custom attribute class requires a snapshot adapter')
  return entry[0]
}
function validateRecipe(recipe: ValueRecipe, catalog: SnapshotCatalog): void {
  if (!recipe || typeof recipe !== 'object') throw new Error('Invalid snapshot value binding')
  switch (recipe.type) {
    case 'bound':
      if (
        typeof recipe.key !== 'string' ||
        !recipe.target ||
        typeof recipe.target !== 'object' ||
        !(
          ('attribute' in recipe.target &&
            typeof recipe.target.attribute === 'string' &&
            !('scope' in recipe.target) &&
            (('pet' in recipe.target && !('skill' in recipe.target) && recipe.target.pet instanceof Pet) ||
              ('skill' in recipe.target &&
                !('pet' in recipe.target) &&
                recipe.target.skill instanceof SkillInstance))) ||
          ('scope' in recipe.target &&
            !('pet' in recipe.target) &&
            !('skill' in recipe.target) &&
            !('attribute' in recipe.target) &&
            (recipe.target.scope instanceof Pet || recipe.target.scope instanceof Player) &&
            'parameter' in recipe.target &&
            typeof recipe.target.parameter === 'string')
        )
      )
        break
      catalog.assertValueBinding(recipe.key)
      validateBindingState(recipe.state)
      return
    case 'attribute':
      if (recipe.target instanceof AttributeSystem && typeof recipe.key === 'string') return
      break
    case 'project':
      if (
        recipe.input instanceof ReactiveValue &&
        ['add', 'multiply', 'divide', 'min', 'max', 'sum', 'average', 'stage'].includes(recipe.operation as string) &&
        typeof recipe.operand === 'number' &&
        Number.isFinite(recipe.operand) &&
        !(recipe.operation === 'divide' && recipe.operand === 0)
      )
        return
      break
    case 'combine':
      if (Array.isArray(recipe.inputs) && recipe.inputs.every(value => value instanceof ReactiveValue)) return
      break
    case 'property':
      if (recipe.target && typeof recipe.target === 'object' && typeof recipe.key === 'string') return
      break
    case 'custom':
      if (typeof recipe.key !== 'string') break
      catalog.assertValue(recipe.key)
      return
  }
  throw new Error('Invalid snapshot value binding')
}
function validateCleanup(binding: Record<string, unknown>): void {
  if (binding?.type === 'bound-value' && binding.modifier instanceof Modifier) return
  if (binding?.type === 'noop') return
  if (
    binding?.type === 'group' &&
    Array.isArray(binding.cleanups) &&
    binding.cleanups.every(value => typeof value === 'function')
  )
    return
  if (typeof binding?.active === 'boolean') {
    if (
      binding.type === 'modifier' &&
      ((binding.target instanceof AttributeSystem && binding.modifier instanceof Modifier) ||
        (binding.target instanceof ConfigSystem && binding.modifier instanceof ConfigModifier))
    )
      return
    if (
      binding.type === 'clamp' &&
      binding.modifier instanceof Modifier &&
      binding.min instanceof ReactiveValue &&
      binding.max instanceof ReactiveValue
    )
      return
  }
  throw new Error('Invalid snapshot cleanup binding')
}

// The ledger is deliberately explicit: a new own field requires a serialization decision.
const ledger = {
  Battle: {
    ctor: Battle,
    fields:
      'type lastStateMessage id allowFaintSwitch showHidden configSystem actionLog status currentPhase currentTurn lastKiller marks victor pendingForcedSwitches pendingFaintSwitch isInitialSwitchPhase petMap skillMap sequenceId playerA playerB',
    runtime:
      'executionBudget battle parent logger phaseManager timerManager transformationSystem emitter rng cancelled _isStarting messageCallbacks waitingResolvers restoredSelection cleanupPromise',
  },
  Player: {
    ctor: Player,
    fields: 'lastStateMessage selection activePet attributeSystem name id team',
    runtime: 'emitter battle owner messageCallbacks',
  },
  AIPlayer: {
    ctor: AIPlayer,
    fields: 'lastStateMessage selection activePet attributeSystem name id team decisionPending phaseChangeRegistered',
    runtime: 'emitter battle owner messageCallbacks',
  },
  Pet: {
    ctor: Pet,
    fields:
      'gender baseCritRate baseAccuracy baseRageObtainEfficiency element isAlive owner marks skills _base appeared lastSkill lastSkillUsedTimes lastUsedSkillElement attributeSystem name id originalSpecies level evs ivs nature baseSkills ability emblem weight height maxHp currentAbility currentEmblem',
    runtime: 'emitter',
  },
  SkillInstance: {
    ctor: SkillInstance,
    fields:
      'owner id category element target multihit sureHit sureCrit ignoreShield tags effects temporaryEffects attributeSystem base',
    runtime: '',
  },
  MarkInstanceImpl: {
    ctor: MarkInstanceImpl,
    fields:
      'base instanceParams suppression owner id effects temporaryEffects config tags attributeSystem attributeModifierCleanups',
    runtime: 'emitter',
  },
  StatLevelMarkInstanceImpl: {
    ctor: StatLevelMarkInstanceImpl,
    fields:
      'base instanceParams suppression owner id effects temporaryEffects config tags attributeSystem attributeModifierCleanups modifierCleanupFn statLevelAttributeSystem stageMultiplier$',
    runtime: 'emitter levelAccessors',
  },
  BaseSkill: {
    ctor: BaseSkill,
    fields:
      'effects id category element power accuracy rage priority target multihit sureHit sureCrit ignoreShield ignoreOpponentStageStrategy tags',
    runtime: '',
  },
  BaseMark: { ctor: BaseMark, fields: 'id effects config tags', runtime: '' },
  BaseStatLevelMark: { ctor: BaseStatLevelMark, fields: 'id effects config tags statType initialLevel', runtime: '' },
  Modifier: {
    ctor: Modifier,
    fields: 'durationType id type priority source phaseTypeSpec value minBound maxBound extraCleanups',
    runtime: '',
  },
  ConfigModifier: {
    ctor: ConfigModifier,
    fields: 'durationType id type priority source phaseTypeSpec value',
    runtime: '',
  },
} satisfies Record<string, { ctor: { prototype: object }; fields: string; runtime: string }>
type LedgerKind = keyof typeof ledger
const restoredClamps = new WeakMap<object, () => void>()
const kinds = Object.keys(ledger) as LedgerKind[]
function specFor(object: object): LedgerKind | undefined {
  return kinds.find(kind => Object.getPrototypeOf(object) === ledger[kind].ctor.prototype)
}
function readFields(object: object, kind: LedgerKind): Record<string, unknown> {
  const spec = ledger[kind],
    allowed = new Set(`${spec.fields} ${spec.runtime}`.split(' '))
  for (const key of Object.keys(object))
    if (!allowed.has(key)) throw new Error(`Unsupported snapshot field ${kind}.${key}`)
  return Object.fromEntries(
    spec.fields
      .split(' ')
      .filter(key => Object.hasOwn(object, key))
      .map(key => [key, Reflect.get(object, key)]),
  )
}
function set(object: object, fields: Record<string, unknown>) {
  for (const [key, value] of Object.entries(fields))
    Object.defineProperty(object, key, { value, writable: true, enumerable: true, configurable: true })
}
function assertBoundary(battle: Battle, boundary: BattleSnapshot['boundary']) {
  const initial = boundary === 'initial',
    team = boundary === 'team-selection'
  if (
    initial
      ? !battle.isInitialSnapshotBoundary()
      : team
        ? !battle.isTeamSelectionSnapshotBoundary()
        : !battle.isSnapshotBoundary()
  )
    throw new Error(
      initial
        ? 'Snapshot requires an initial input boundary'
        : 'Snapshot requires a settled selection/switch/team input boundary',
    )
  if (initial) battle.timerManager.assertInitialSnapshotSafe()
  if (team) battle.timerManager.assertTeamSelectionSnapshotSafe()
  else battle.timerManager.assertSnapshotSafe()
  if (boundary === 'switch') {
    battle.assertSwitchSnapshotState()
    battle.timerManager.assertSwitchSnapshotSafe()
  }
  if (
    battle.phaseManager.getPhasesByState(PhaseState.Pending).length ||
    battle.phaseManager.getPhasesByState(PhaseState.Failed).length
  )
    throw new Error('Snapshot cannot discard pending or failed phases')
  battle.phaseManager.assertSnapshotSafe()
  for (const container of [
    ...battle.marks,
    ...[...battle.petMap.values()].flatMap(pet => [...pet.skills, ...pet.marks]),
  ]) {
    const temporaryEffects = Reflect.get(container, 'temporaryEffects')
    if (!Array.isArray(temporaryEffects) || temporaryEffects.length)
      throw new Error('Snapshot does not support active temporary effects')
  }
}

export function snapshotBattle(
  battle: Battle,
  catalog: SnapshotCatalog,
  options?: { boundary: 'initial' | 'team-selection' },
): BattleSnapshot {
  const boundary = options?.boundary ?? (battle.currentPhase === BattlePhase.SwitchPhase ? 'switch' : undefined)
  assertBoundary(battle, boundary)
  const ids = new Map<object, number>(),
    nodes: Node[] = []
  const encode = (value: unknown): Encoded => {
    if (value === undefined) return { atom: 'undefined' }
    if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
    if (Object.is(value, -0)) return { atom: '-0' }
    if (typeof value === 'number')
      return Number.isFinite(value) ? value : { atom: String(value) as 'Infinity' | '-Infinity' | 'NaN' | '-0' }
    if (typeof value !== 'object' && typeof value !== 'function') throw new Error('Unsupported snapshot value')
    const known = ids.get(value)
    if (known !== undefined) return { ref: known }
    const id = nodes.length
    ids.set(value, id)
    const node: Node = { kind: '', fields: {} }
    nodes.push(node)
    const write = (kind: string, fields: Record<string, unknown>) => {
      node.kind = kind
      node.fields = Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, encode(item)]))
    }
    if (typeof value === 'function') {
      const binding = getCleanupBinding(value as () => void)
      if (!binding) throw new Error('Unregistered snapshot function/cleanup')
      validateCleanup(binding as Record<string, unknown>)
      write('cleanup', { binding })
    } else if (catalog.contentKey(value)) write('content', { key: catalog.contentKey(value) })
    else if (value instanceof Effect) write('effect', { key: catalog.effectKey(value) })
    else if (value instanceof Signal && Object.getPrototypeOf(value) === Signal.prototype)
      write('signal', { value: value.value, complete: value.isComplete })
    else if (value instanceof ReactiveValue) {
      const recipe = getValueRecipe(value)
      if (!recipe) throw new Error('Dynamic value requires a snapshot binding; its current value is insufficient')
      validateRecipe(recipe, catalog)
      write('value', { recipe, complete: value.isComplete })
    } else if (value instanceof AttributeSystem) {
      if (value.getBattleId() && value.getBattleId() !== battle.id)
        throw new Error('Cross-Battle attribute reference cannot be snapshotted')
      write('attribute', {
        type: attributeTag(value),
        accessors: value instanceof ComposableAttributeSystem ? Object.keys(value.getAccessors()).join('|') : '',
        state: value.exportSnapshotState(),
      })
    } else if (value instanceof ConfigSystem) write('config', { state: value.exportSnapshotState() })
    else if (value instanceof AIPlayer && Reflect.get(value, 'decisionPending'))
      throw new Error('AI decision is not at a snapshot boundary')
    else {
      const kind = specFor(value)
      if (kind) {
        if (value instanceof Modifier) {
          const recipe = getValueRecipe(value.value)
          if (recipe?.type === 'bound')
            catalog.assertValueBindingSource(recipe.key as string, recipe.args, value.source)
        }
        if (value instanceof BaseMark && markParameterContract(value))
          throw new Error('Parameterized mark requires registered snapshot content')
        if (value instanceof MarkInstanceImpl) {
          const params = normalizeMarkInstanceParams(value.base, value.instanceParams)
          if (!sameMarkInstanceParams(params, value.instanceParams)) throw new Error('Invalid mark instance parameters')
          markParameterContract(value.base)?.validateScope(battle.configSystem.exportSnapshotState(), value)
        }
        const fields = readFields(value, kind)
        if (value instanceof Battle) {
          const rng: unknown = Reflect.get(value, 'rng')
          if (!(rng instanceof GameRng)) throw new Error('Injected RNG requires a snapshot adapter')
          fields.executionBudgetState = value.executionBudget.exportState()
          fields.rngState = rng.getState()
          fields.timerConfig = value.getTimerConfig()
          if (value.timerManager.isEnabled()) fields.timerRuntime = value.timerManager.exportRuntimeState()
          fields.transformations = value.transformationSystem.exportSnapshotState()
        }
        write(kind, fields)
      } else if (Array.isArray(value)) write('array', Object.fromEntries(value.map((item, i) => [String(i), item])))
      else if (value instanceof Map) write('map', { entries: [...value.entries()] })
      else if (value instanceof Set) write('set', { values: [...value] })
      else if (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
        write(Object.getPrototypeOf(value) === null ? 'dictionary' : 'object', value as Record<string, unknown>)
      else throw new Error(`Unsupported snapshot object: ${value.constructor.name}`)
    }
    return { ref: id }
  }
  const result: BattleSnapshot = {
    format: 'arcadia.v1.battle-snapshot',
    version: 1,
    ...(boundary ? { boundary } : {}),
    catalog: catalog.revision,
    root: encode(battle),
    nodes,
  }
  validateSnapshot(result, catalog)
  return result
}

export function restoreBattle(input: unknown, catalog: SnapshotCatalog): Battle {
  const snapshot = validateSnapshot(input, catalog)
  const objects: unknown[] = [],
    deferred: (() => void)[] = []
  const attributes: {
    object: AttributeSystem<AttributeData>
    state: ReturnType<AttributeSystem<AttributeData>['exportSnapshotState']>
  }[] = []
  const configs: { object: ConfigSystem; state: ReturnType<ConfigSystem['exportSnapshotState']> }[] = []
  const decode = (value: Encoded): unknown => {
    if (value === null || typeof value !== 'object') return value
    if ('atom' in value) return value.atom === 'undefined' ? undefined : Number(value.atom)
    return objects[value.ref]
  }
  let battle: Battle | undefined
  let bound = false
  try {
    // Allocate identities before wiring any references. Domain shells use the actual V1 prototypes.
    for (const node of snapshot.nodes) {
      let object: unknown
      if (node.kind in ledger) object = Object.create(ledger[node.kind as LedgerKind].ctor.prototype)
      else
        switch (node.kind) {
          case 'object':
            object = {}
            break
          case 'dictionary':
            object = Object.create(null)
            break
          case 'array':
            object = []
            break
          case 'map':
            object = new Map()
            break
          case 'set':
            object = new Set()
            break
          case 'signal':
            object = new Signal<unknown>(undefined)
            break
          case 'value': {
            const recipeRef = node.fields.recipe
            const owned =
              recipeRef &&
              typeof recipeRef === 'object' &&
              'ref' in recipeRef &&
              snapshot.nodes[recipeRef.ref]?.fields.type === 'bound'
            if (owned) {
              object = new RestoredBoundValue(() => {
                const recipe = decode(node.fields.recipe) as ValueRecipe
                return catalog.restoreValueBinding(
                  recipe.key as string,
                  recipe.args,
                  recipe.state,
                  recipe.target as BindingTarget,
                )
              })
              deferred.push(() => {
                describeValue(object as ReactiveValue<unknown>, decode(node.fields.recipe) as ValueRecipe)
                if (node.fields.complete) (object as ReactiveValue<unknown>).complete()
              })
              break
            }
            let restored: ReactiveValue<unknown> | undefined
            object = derived(() => {
              restored ??= restoreRecipe(decode(node.fields.recipe) as ValueRecipe, catalog)
              return restored.value
            })
            deferred.push(() => {
              describeValue(object as ReactiveValue<unknown>, decode(node.fields.recipe) as ValueRecipe)
              if (node.fields.complete) (object as ReactiveValue<unknown>).complete()
            })
            break
          }
          case 'cleanup': {
            const cleanup = () =>
              runCleanup((getCleanupBinding(cleanup) ?? decode(node.fields.binding)) as Record<string, unknown>)
            object = cleanup
            break
          }
          case 'effect':
            object = catalog.resolveEffect(node.fields.key as string)
            break
          case 'content':
            object = catalog.resolveContent(node.fields.key as string)
            break
          case 'config':
            object = new ConfigSystem()
            break
          case 'attribute': {
            const type = node.fields.type as string
            if (type === 'PetAttributeSystem') object = new PetAttributeSystem()
            else if (type === 'PlayerAttributeSystem') object = new PlayerAttributeSystem()
            else if (type === 'MarkAttributeSystem') {
              const mark = new MarkAttributeSystem()
              mark.initializeMarkAttributes(0, 0)
              object = mark
            } else if (type === 'SkillAttributeSystem') {
              const skill = new SkillAttributeSystem()
              skill.initializeSkillAttributes(0, 0, 0, 0)
              object = skill
            } else if (type === 'ComposableAttributeSystem') {
              const system = new ComposableAttributeSystem<
                StatLevelMarkAttributeSet & SkillAttributeSet & RageAttributeSet
              >()
              if (typeof node.fields.accessors !== 'string') throw new Error('Invalid snapshot accessors')
              const accessors = node.fields.accessors.split('|')
              if (accessors.includes('getDuration')) system.withBaseMarkAttributes(0, 0)
              if (accessors.includes('getLevel')) system.withLevelAttributes(0)
              if (accessors.includes('getPower')) system.withSkillAttributes(0, 0, 0, 0)
              if (accessors.includes('getCurrentRage')) system.withRageAttributes(0, 0)
              object = system
            } else if (type === 'AttributeSystem') object = new AttributeSystem()
            else throw new Error(`Unsupported snapshot attribute system: ${type}`)
            break
          }
          default:
            throw new Error(`Unknown snapshot node: ${node.kind}`)
        }
      objects.push(object)
    }
    snapshot.nodes.forEach((node, index) => {
      const object = objects[index] as object
      const fields = Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, decode(value)]))
      if (node.kind in ledger || node.kind === 'object' || node.kind === 'dictionary' || node.kind === 'array')
        set(object, fields)
      if (node.kind === 'signal') {
        ;(object as Signal<unknown>).next(fields.value)
        if (fields.complete) (object as Signal<unknown>).complete()
      }
      if (node.kind === 'attribute')
        attributes.push({
          object: object as AttributeSystem<AttributeData>,
          state: fields.state as (typeof attributes)[number]['state'],
        })
      if (node.kind === 'config')
        configs.push({ object: object as ConfigSystem, state: fields.state as (typeof configs)[number]['state'] })
    })
    // Containers must be filled only after their entry arrays/objects have been populated.
    snapshot.nodes.forEach((node, index) => {
      if (node.kind === 'map')
        for (const [key, value] of decode(node.fields.entries) as [unknown, unknown][])
          (objects[index] as Map<unknown, unknown>).set(key, value)
      if (node.kind === 'set')
        for (const value of decode(node.fields.values) as unknown[]) (objects[index] as Set<unknown>).add(value)
    })
    // Validate descriptions on the hydrated graph before any runtime registration.
    for (const node of snapshot.nodes) {
      if (node.kind === 'value') validateRecipe(decode(node.fields.recipe) as ValueRecipe, catalog)
      if (node.kind === 'cleanup') validateCleanup(decode(node.fields.binding) as Record<string, unknown>)
    }
    battle = decode(snapshot.root) as Battle
    const initial = snapshot.boundary === 'initial',
      team = snapshot.boundary === 'team-selection',
      switching = snapshot.boundary === 'switch'
    const prestart = initial || team
    if (
      !(battle instanceof Battle) ||
      battle.status !== (prestart ? BattleStatus.Unstarted : BattleStatus.OnBattle) ||
      battle.currentPhase !==
        (team ? BattlePhase.TeamSelectionPhase : switching ? BattlePhase.SwitchPhase : BattlePhase.SelectionPhase)
    )
      throw new Error('Invalid snapshot Battle root/boundary')
    if (ConfigSystem.getBattleConfig(battle.id))
      throw new Error('Snapshot Battle is already active; dispose the source before restoring its identity')
    const data = battle as Battle & {
      executionBudgetState: ReturnType<ExecutionBudget['exportState']>
      rngState: ReturnType<GameRng['getState']>
      timerConfig: ReturnType<Battle['getTimerConfig']>
      timerRuntime?: unknown
      transformations: ReturnType<TransformationSystem['exportSnapshotState']>
    }
    if (!data.timerConfig) throw new Error('Snapshot is missing timer configuration')
    if (data.timerConfig.enabled && !data.timerRuntime)
      throw new Error('Snapshot enabled timers require saved timer state')
    if (!data.timerConfig.enabled && data.timerRuntime !== undefined)
      throw new Error('Disabled timers cannot carry saved timer state')
    const savedBudget = new ExecutionBudget(() => battle!.stopForExecutionFault())
    savedBudget.restoreState(data.executionBudgetState)
    if (data.executionBudgetState.turn !== battle.currentTurn && !(prestart && data.executionBudgetState.turn === -1))
      throw new Error('Execution budget turn mismatch')
    const emitter = mitt<Events>()
    set(battle, {
      // Rebuilding subscriptions has its own finite allowance; never spend saved gameplay credit.
      executionBudget: new ExecutionBudget(() => {}),
      parent: null,
      battle,
      emitter,
      logger: createChildLogger('Battle'),
      rng: GameRng.fromState(data.rngState),
      phaseManager: new PhaseManager(battle),
      timerManager: new TimerManager(battle, data.timerConfig),
      transformationSystem: new TransformationSystem(battle),
      cancelled: false,
      _isStarting: false,
      restoredSelection: !prestart,
      cleanupPromise: undefined,
      waitingResolvers: {},
      messageCallbacks: [],
    })
    if (data.timerConfig.enabled) battle.timerManager.restoreRuntimeState(data.timerRuntime)
    if (initial) {
      if (!battle.isInitialSnapshotBoundary()) throw new Error('Invalid initial snapshot boundary')
      battle.timerManager.assertInitialSnapshotSafe()
    }
    if (team) {
      if (!battle.isTeamSelectionSnapshotBoundary()) throw new Error('Invalid team selection snapshot boundary')
      battle.timerManager.assertTeamSelectionSnapshotSafe()
    }
    if (switching) {
      battle.assertSwitchSnapshotState()
      battle.timerManager.assertSwitchSnapshotSafe()
    }
    for (const { object, state } of attributes) object.restoreSnapshotBase(state, battle.id)
    for (const restore of deferred) restore()
    const ownedValues = new Set<ReactiveValue<unknown>>()
    for (const { object, state } of attributes) {
      for (const [key, modifiers] of state.modifiers) {
        for (const modifier of modifiers) {
          const recipe = getValueRecipe(modifier.value)
          if (recipe?.type !== 'bound') continue
          const target = recipe.target as BindingTarget
          if (!('attribute' in target)) throw new Error('Invalid attribute binding target')
          const entity = bindingEntity(target)
          const targetOwner = bindingOwner(target)
          const source = modifier.source
          const owner = source?.owner
          const players = [battle.playerA, battle.playerB]
          if (
            ownedValues.has(modifier.value) ||
            entity.attributeSystem !== object ||
            target.attribute !== key ||
            !targetOwner?.owner ||
            !players.includes(targetOwner.owner) ||
            !targetOwner.owner.team.includes(targetOwner) ||
            (entity instanceof SkillInstance && !targetOwner.skills.includes(entity)) ||
            !(source instanceof MarkInstanceImpl) ||
            !owner ||
            !owner.marks.includes(source) ||
            (owner !== battle && (!(owner instanceof Pet) || !owner.owner || !players.includes(owner.owner)))
          )
            throw new Error('Invalid bound contribution ownership')
          catalog.assertValueBindingSource(recipe.key as string, recipe.args, source)
          ownedValues.add(modifier.value)
        }
      }
    }
    const bindingBattle = battle
    for (const { object, state } of configs) {
      const validate = (key: string, modifier: ConfigModifier, scope?: object) => {
        const recipe = getValueRecipe(modifier.value)
        if (recipe?.type !== 'bound') return
        const target = recipe.target as BindingTarget
        const source = modifier.source
        const players = [bindingBattle.playerA, bindingBattle.playerB]
        if (
          ownedValues.has(modifier.value) ||
          object !== bindingBattle.configSystem ||
          !('scope' in target) ||
          target.scope !== scope ||
          target.parameter !== key ||
          !(target.scope instanceof Player
            ? players.includes(target.scope)
            : target.scope.owner &&
              players.includes(target.scope.owner) &&
              target.scope.owner.team.includes(target.scope)) ||
          !(source instanceof MarkInstanceImpl) ||
          !source.owner ||
          !source.owner.marks.includes(source) ||
          (source.owner !== battle &&
            (!(source.owner instanceof Pet) || !source.owner.owner || !players.includes(source.owner.owner)))
        )
          throw new Error('Invalid bound parameter ownership')
        catalog.assertValueBindingSource(recipe.key as string, recipe.args, source)
        ownedValues.add(modifier.value)
      }
      for (const [key, modifiers] of state.global) for (const modifier of modifiers) validate(key, modifier)
      for (const [scope, entries] of state.scopedModifiers)
        for (const [key, modifiers] of entries) for (const modifier of modifiers) validate(key, modifier, scope)
    }
    for (const object of objects) {
      if (object instanceof SkillInstance || object instanceof MarkInstanceImpl) {
        const temporaryEffects = Reflect.get(object, 'temporaryEffects')
        if (temporaryEffects === undefined) set(object, { temporaryEffects: [] })
        else if (!Array.isArray(temporaryEffects) || temporaryEffects.length)
          throw new Error('Snapshot does not support active temporary effects')
      }
    }
    for (const { object, state } of attributes) object.restoreSnapshotModifiers(state)
    for (const object of objects)
      if (object instanceof MarkInstanceImpl) {
        const params = normalizeMarkInstanceParams(object.base, object.instanceParams)
        if (!sameMarkInstanceParams(params, object.instanceParams)) throw new Error('Invalid mark instance parameters')
        const contract = markParameterContract(object.base)
        if (contract) {
          const config = configs.find(entry => entry.object === data.configSystem)
          if (!config) throw new Error('Missing mark parameter config')
          contract.validateScope(config.state, object)
        }
        set(object, { instanceParams: params })
      }
    for (const { object, state } of configs) object.restoreSnapshotState(state)
    for (const { object } of configs) object.registerRestoredBattle(battle.id)
    ConfigSystem.bindBattle(battle)
    bound = true
    for (const object of objects) {
      if (object instanceof Player) {
        set(object, { battle, owner: battle, emitter, messageCallbacks: [] })
        initializePlayerRelations(object)
        battle.registerListener(object.handleMessage.bind(object))
        if (object instanceof AIPlayer) object.restoreSnapshotRuntime()
      } else if (object instanceof Pet || object instanceof MarkInstanceImpl) set(object, { emitter })
      if (object instanceof Pet) initializePetRelations(object)
      else if (object instanceof MarkInstanceImpl || object instanceof SkillInstance) initializeOwnerRelations(object)
      if (object instanceof StatLevelMarkInstanceImpl)
        set(object, {
          levelAccessors: (
            Reflect.get(object, 'statLevelAttributeSystem') as ReturnType<typeof createStatLevelMarkAttributeSystem>
          ).getAccessors(),
        })
    }
    battle.transformationSystem.restoreSnapshotState(data.transformations)
    for (const object of objects) if (object instanceof RestoredBoundValue) object.initialize()
    for (const object of objects)
      if (typeof object === 'function') {
        // Retain cleanup descriptions so a restored Battle can be saved again.
        const index = objects.indexOf(object),
          node = snapshot.nodes[index]
        const binding = decode(node.fields.binding) as Record<string, unknown>
        if (binding.type === 'modifier' && binding.active) {
          const actual = getModifierCleanup(binding.target as object, binding.modifier as object)
          describeCleanup(object as () => void, getCleanupBinding(actual)!)
        } else describeCleanup(object as () => void, binding)
        if (binding.type === 'clamp' && binding.active) {
          const modifier = binding.modifier as Modifier
          const min = (binding.min as ReactiveValue<number>).subscribe(value => {
            modifier.minValue = value
          })
          const max = (binding.max as ReactiveValue<number>).subscribe(value => {
            modifier.maxValue = value
          })
          restoredClamps.set(binding, () => {
            binding.active = false
            min.unsubscribe()
            max.unsubscribe()
          })
        }
      }
    battle.executionBudget.assertActive()
    set(battle, { executionBudget: savedBudget })
    Reflect.deleteProperty(battle, 'executionBudgetState')
    Reflect.deleteProperty(battle, 'rngState')
    Reflect.deleteProperty(battle, 'timerConfig')
    Reflect.deleteProperty(battle, 'timerRuntime')
    Reflect.deleteProperty(battle, 'transformations')
    return battle
  } catch (error) {
    // Do not clean by battle ID: malformed/duplicate saves must not destroy a live source Battle.
    if (bound && battle) ConfigSystem.unbindRestoredBattle(battle)
    for (const object of objects) {
      try {
        if (object instanceof AttributeSystem || object instanceof ConfigSystem) object.destroy()
        if (object instanceof RestoredBoundValue) object.complete()
      } catch {
        /* Retain the original validation error; no host callbacks survive hydration. */
      }
    }
    throw error
  }
}

function restoreRecipe(recipe: ValueRecipe, catalog: SnapshotCatalog): ReactiveValue<unknown> {
  switch (recipe.type) {
    case 'attribute':
      return (recipe.target as AttributeSystem<AttributeData>).getAttribute$(recipe.key as string)
    case 'project':
      return projectValue(
        recipe.input as ReactiveValue<unknown>,
        recipe.operation as ValueProjection,
        recipe.operand as number,
      )
    case 'combine':
      return combineValues(recipe.inputs as ReactiveValue<unknown>[])
    case 'property':
      return derived(() => Reflect.get(recipe.target as object, recipe.key as string))
    case 'custom':
      return catalog.restoreValue(recipe.key as string, recipe.args)
    default:
      throw new Error(`Unknown snapshot value binding: ${recipe.type}`)
  }
}
function runCleanup(binding: Record<string, unknown>): void {
  if (binding.type === 'bound-value') {
    ;(binding.modifier as Modifier).value.complete()
    return
  }
  if (binding.type === 'noop') return
  if (binding.type === 'group') {
    for (const cleanup of binding.cleanups as (() => void)[]) cleanup()
    return
  }
  if (binding.type === 'modifier') {
    if (!binding.active) return
    binding.active = false
    getModifierCleanup(binding.target as object, binding.modifier as object)()
    return
  }
  if (binding.type === 'clamp') {
    restoredClamps.get(binding)?.()
    return
  }
  throw new Error('Unknown snapshot cleanup binding')
}
function validateSnapshot(input: unknown, catalog: SnapshotCatalog): BattleSnapshot {
  if (!input || typeof input !== 'object') throw new Error('Invalid Battle snapshot')
  const s = input as BattleSnapshot
  if (
    s.format !== 'arcadia.v1.battle-snapshot' ||
    s.version !== 1 ||
    (s.boundary !== undefined && !['initial', 'switch', 'team-selection'].includes(s.boundary)) ||
    s.catalog !== catalog.revision ||
    !Array.isArray(s.nodes) ||
    s.nodes.length > 100000
  )
    throw new Error('Unsupported snapshot format/version/catalog')
  const valid = new Set([
    ...kinds,
    'effect',
    'content',
    'signal',
    'value',
    'cleanup',
    'attribute',
    'config',
    'object',
    'dictionary',
    'array',
    'map',
    'set',
  ])
  const check = (value: Encoded) => {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    )
      return
    if (
      value &&
      typeof value === 'object' &&
      'ref' in value &&
      Number.isInteger(value.ref) &&
      value.ref >= 0 &&
      value.ref < s.nodes.length
    )
      return
    if (
      value &&
      typeof value === 'object' &&
      'atom' in value &&
      ['undefined', 'Infinity', '-Infinity', 'NaN', '-0'].includes(value.atom)
    )
      return
    throw new Error('Invalid snapshot reference/value')
  }
  check(s.root)
  for (const node of s.nodes) {
    if (!node || !valid.has(node.kind) || !node.fields || typeof node.fields !== 'object' || Array.isArray(node.fields))
      throw new Error('Invalid snapshot node')
    for (const [key, value] of Object.entries(node.fields)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid snapshot field')
      check(value)
    }
    if (node.kind in ledger) {
      const spec = ledger[node.kind as LedgerKind]
      const allowed = new Set([
        ...spec.fields.split(' '),
        ...(node.kind === 'Battle'
          ? ['rngState', 'timerConfig', 'timerRuntime', 'transformations', 'executionBudgetState']
          : []),
      ])
      if (Object.keys(node.fields).some(key => !allowed.has(key))) throw new Error('Unknown snapshot domain field')
      const optional = new Set(node.kind === 'Pet' ? ['currentAbility', 'currentEmblem', 'lastUsedSkillElement'] : [])
      if (['SkillInstance', 'MarkInstanceImpl', 'StatLevelMarkInstanceImpl'].includes(node.kind))
        optional.add('temporaryEffects')
      if (spec.fields.split(' ').some(key => !optional.has(key) && !Object.hasOwn(node.fields, key)))
        throw new Error('Missing snapshot domain field')
    }
    if ((node.kind === 'signal' || node.kind === 'value') && typeof node.fields.complete !== 'boolean')
      throw new Error('Invalid snapshot completion flag')
    if (node.kind === 'effect') catalog.resolveEffect(node.fields.key as string)
    if (node.kind === 'content') catalog.resolveContent(node.fields.key as string)
  }
  return s
}
