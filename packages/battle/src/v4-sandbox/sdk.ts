import { Arena } from 'quickjs-emscripten-sync'
import { registerArenaProjection } from './arena-session'
import * as sdk from '../../v4-authoring'
import { Battle } from '../v4/battle'
import { Context } from '../v4/context'
import { Pet } from '../v4/pet'
import { Player } from '../v4/player'
import { BaseMark, MarkInstanceImpl } from '../v4/mark'
import { BaseSkill, SkillInstance } from '../v4/skill'
import { Effect } from '../v4/effect'
import { ConfigSystem } from '../v4/config'
import { ParameterCatalog } from '../v4/content/parameters'
import { defineNativeBehavior, normalizeBehaviorDefinitions, BehaviorCompilationError } from '../v4/content/behaviors'
import { SandboxFault, type SandboxPolicy } from './contracts'

type Fn = (...args: unknown[]) => unknown
type Scope = { active: boolean; readonly values: object[] }
const isClassConstructor = (value: Fn) => /^class(?:\s|\{)/.test(Function.prototype.toString.call(value))
const fields = [
  'battle',
  'configSystem',
  'id',
  'baseId',
  'tags',
  'owner',
  'currentHp',
  'stat',
  'lastSkillUsedTimes',
  'isAlive',
  'stack',
  'isActive',
  'isSuppressed',
  'base',
  'config',
  'name',
  'element',
  'category',
  'power',
  'rage',
  'priority',
  'skills',
  'marks',
  'team',
  'activePet',
  'currentRage',
  'trigger',
  'parent',
  'source',
  'pet',
  'skill',
  'actualTarget',
  'origin',
  'baseDamage',
  'modified',
  'baseHeal',
  'healResult',
  'target',
  'available',
  'type',
  'weight',
  'height',
  'previousSkillElement',
  'level',
  'gender',
  'maxRage',
  'damageResult',
  'multihitResult',
  'currentTurn',
  'stacksAfter',
  'stacksBefore',
  'statType',
  'initialLevel',
  'baseMark',
  'mark',
  'amount',
  'requestedAmount',
  'actualAmount',
  'reason',
  'modifiedType',
  'value',
  'crit',
  'duration',
  'durationAfter',
  'durationBefore',
  'switchOutPet',
  'switchInPet',
  'effect',
  'effects',
  'damageType',
  'currentHitCount',
  'hitResult',
  'multihit',
  'accuracy',
  'evasion',
  'critRate',
  'minThreshold',
  'maxThreshold',
  'effectiveness',
  'ignoreShield',
  'rageChangeResult',
  'stackChange',
  'durationChange',
  'selectTarget',
  'defeated',
] as const
function domainMethods(value: object): readonly string[] {
  if (value instanceof Pet) return ['addMark', 'removeMark', 'damage', 'heal', 'addRage', 'transferMarks']
  if (value instanceof Player) return ['addRage']
  if (value instanceof Battle) return ['random', 'randomInt', 'shuffle', 'removeMark']
  if (value instanceof MarkInstanceImpl) return ['consumeStack']
  if (value instanceof ConfigSystem) return ['get']
  if (value instanceof Context) return ['addModified']
  return []
}
const parameterMethods = ['read', 'get', 'install', 'register', 'snapshot', 'restore', 'addressOf'] as const
const denied = new Set(['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments'])
const coreSdk = { ...sdk, defineNativeBehavior, normalizeBehaviorDefinitions, BehaviorCompilationError }
const authorFunctions = new Set<string>([
  'compileEffect',
  'defineEffect',
  'numberParam',
  'booleanParam',
  'stringParam',
  'selectFrom',
  'effectParameters',
  'hasAuthoredParameters',
  'defineCodeEffect',
  'codeEffectDefinition',
  'defineNativeEffect',
  'defineParameter',
  'parameterAddress',
  'defineNativeBehavior',
  'normalizeBehaviorDefinitions',
  'CreateStatStageMark',
  'defineEffectState',
  'getEffectState',
  'setEffectState',
])
function domain(value: object): boolean {
  return (
    value instanceof Pet ||
    value instanceof Player ||
    value instanceof BaseMark ||
    value instanceof BaseSkill ||
    value instanceof SkillInstance ||
    value instanceof MarkInstanceImpl ||
    value instanceof Context ||
    value instanceof Effect ||
    value instanceof Battle ||
    value instanceof ConfigSystem
  )
}
function frame(value: object): boolean {
  return typeof Reflect.get(value, 'read') === 'function' && !!Reflect.get(value, 'ops')
}
/** SDK-specific projections and canonical registrations. Arena owns marshalling, proxies and handles. */
export class ArenaEffectSdk {
  private readonly canonical = new WeakSet<object>()
  private readonly callbacks = new WeakMap<Fn, Fn>()
  private count = 0
  private activeScope?: Scope
  private session?: Scope & { callbacks: Fn[] }
  constructor(
    private readonly arena: Arena,
    private readonly policy: SandboxPolicy,
    private readonly run: <T>(operation: () => T) => T,
    private readonly reject: (error: unknown) => never,
  ) {}
  beginSession(): void {
    if (this.session || this.activeScope) throw new Error('Effect session already active')
    this.session = { active: true, values: [], callbacks: [] }
  }
  endSession(): void {
    if (!this.session || this.activeScope) throw new Error('Effect session is not idle')
    this.session.active = false
    for (const value of this.session.values) {
      if (this.canonical.delete(value)) this.count--
    }
    for (const callback of this.session.callbacks) this.callbacks.delete(callback)
    this.session.values.length = 0
    this.session.callbacks.length = 0
    this.session = undefined
  }
  isCanonical(value: unknown): value is object {
    return !!value && (typeof value === 'object' || typeof value === 'function') && this.canonical.has(value)
  }
  private register(original: object, view: object): void {
    if (++this.count > this.policy.retainedObjects) this.reject(new SandboxFault('budget', 'sdk', 'SDK object limit'))
    registerArenaProjection(this.arena, original, view)
    this.canonical.add(original)
    this.session?.values.push(original)
  }
  /** Guest records may contain canonical parameters/selectors. Preserve those identities when reading records. */
  private input(value: unknown, depth = 0): unknown {
    if (depth > 24) return this.reject(new SandboxFault('budget', 'sdk', 'SDK argument nesting limit'))
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value
    if (this.canonical.has(value)) return value
    if (typeof value === 'function') {
      const fn = value as Fn
      let callback = this.callbacks.get(fn)
      if (!callback) {
        const session = this.session
        callback = (...args) =>
          this.run(() => {
            if (session && !session.active)
              return this.reject(new SandboxFault('permission', 'sdk', 'Expired effect session'))
            const scope: Scope = { active: true, values: [] }
            const previous = this.activeScope
            this.activeScope = scope
            try {
              for (const arg of args) this.output(arg, scope)
              const result: unknown = fn(...args)
              if (result && typeof Reflect.get(Object(result), 'then') === 'function')
                this.reject(new SandboxFault('execution', 'sdk', 'Effect callbacks must be synchronous'))
              return this.input(result)
            } finally {
              scope.active = false
              this.activeScope = previous
              for (const item of scope.values) {
                this.arena.unregister(item)
                this.canonical.delete(item)
                this.count--
              }
            }
          })
        this.callbacks.set(fn, callback)
        this.session?.callbacks.push(fn)
      }
      return callback
    }
    if (value instanceof Map || value instanceof Set) return value
    if (Array.isArray(value)) {
      if (value.length > 5000) return this.reject(new SandboxFault('budget', 'sdk', 'SDK collection limit'))
      return value.map(item => this.input(item, depth + 1))
    }
    if (Reflect.ownKeys(value).length > 5000) return this.reject(new SandboxFault('budget', 'sdk', 'SDK record limit'))
    return Object.fromEntries(
      Reflect.ownKeys(value).map(key => {
        if (typeof key === 'string' && denied.has(key))
          return this.reject(new SandboxFault('permission', 'sdk', 'SDK argument key denied'))
        return [key, this.input(Reflect.get(value, key), depth + 1)]
      }),
    )
  }
  output<T>(value: T, scope: Scope | undefined = this.activeScope, ephemeral = false): T {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || this.canonical.has(value as object))
      return value
    if (Array.isArray(value)) {
      for (const item of value) this.output(item, scope)
      return value
    }
    if (value instanceof Map || value instanceof Set) {
      for (const item of value.values()) this.output(item, scope)
      return value
    }
    if (typeof value === 'function') {
      const session = this.session
      const fn = value as Fn
      const isClass = isClassConstructor(fn)
      const allowedConstructor =
        isClass &&
        (value === ParameterCatalog ||
          Reflect.get(fn, 'prototype') instanceof Context ||
          value === BehaviorCompilationError)
      const callable = (...args: unknown[]) =>
        this.run(() => {
          if (session && !session.active)
            return this.reject(new SandboxFault('permission', 'sdk', 'Expired effect session'))
          if (ephemeral && scope && !scope.active)
            return this.reject(new SandboxFault('permission', 'sdk', 'Expired effect frame'))
          const input = args.map(arg => this.input(arg))
          if (isClass && !allowedConstructor)
            return this.reject(new SandboxFault('permission', 'sdk', 'Domain construction denied'))
          const result = isClass ? Reflect.construct(fn, input) : fn(...input)
          return ephemeral ? this.output(result, scope, true) : this.output(result)
        })
      if (isClass) Object.defineProperty(callable, Symbol.hasInstance, { value: (item: unknown) => item instanceof fn })
      this.register(fn, callable)
      if (ephemeral) scope?.values.push(fn)
      return value
    }
    const original = value as object
    const session = this.session
    const isDomain = domain(original),
      isFrame = frame(original)
    const temporary = isFrame || original instanceof Context || (ephemeral && !isDomain)
    const keys: readonly PropertyKey[] = isFrame
      ? ['trigger', 'parent', 'read', 'ops']
      : isDomain
        ? [...fields, ...domainMethods(original)]
        : [...Reflect.ownKeys(original), ...(original instanceof ParameterCatalog ? parameterMethods : [])]
    const view: Record<PropertyKey, unknown> = Object.create(null) as Record<PropertyKey, unknown>
    const members = new Map<PropertyKey, Fn>()
    // Register before visiting children: owner/source graphs may be cyclic.
    for (const key of new Set(keys)) {
      if (typeof key === 'string' && (key.startsWith('_') || denied.has(key))) continue
      if (!(key in original)) continue
      Object.defineProperty(view, key, {
        enumerable: true,
        configurable: false,
        get: () =>
          this.run(() => {
            if (session && !session.active)
              return this.reject(new SandboxFault('permission', 'sdk', 'Expired effect session'))
            if (temporary && !scope?.active)
              return this.reject(new SandboxFault('permission', 'sdk', 'Expired effect frame'))
            const member: unknown = Reflect.get(original, key, original)
            if (
              (original === sdk || original === coreSdk) &&
              typeof member === 'function' &&
              !isClassConstructor(member as Fn) &&
              !authorFunctions.has(String(key))
            )
              return this.reject(new SandboxFault('permission', 'sdk', `Not an effect capability: ${String(key)}`))
            if (typeof member === 'function') {
              if (isDomain && !domainMethods(original).includes(String(key)))
                return this.reject(new SandboxFault('permission', 'sdk', 'Direct domain methods denied'))
              if (isClassConstructor(member as Fn)) return this.output(member)
              if (!members.has(key)) members.set(key, (...args) => Reflect.apply(member, original, args))
              return this.output(members.get(key)!, temporary ? scope : undefined, temporary)
            }
            return this.output(member, temporary ? scope : undefined, temporary)
          }),
        set: () => this.reject(new SandboxFault('permission', 'sdk', 'Use SDK operations to modify battle state')),
      })
    }
    this.register(original, view)
    if (temporary) scope?.values.push(original)
    return value
  }
  expose(): void {
    this.output(sdk)
    this.output(coreSdk)
    this.arena.expose({ sdk, core: coreSdk })
  }
}
