import { domainFields, evaluationReads, parameterMethods, projectedMethods } from './projection'
import { effectSdkFunctions, phaseOperations } from '../engine/content/sdk-capabilities'
import { Arena } from 'quickjs-emscripten-sync'
import { registerArenaProjection } from './arena-session'
import * as sdk from '../../authoring'
import { Battle } from '../engine/battle'
import { assertEvaluationOperation, getDamageEvaluation } from '../engine/phase/damage'
import {
  AddMarkContext,
  Context,
  DamageContext,
  EffectContext,
  HealContext,
  RageContext,
  RemoveMarkContext,
} from '../engine/context'
import { Pet } from '../engine/pet'
import { Player } from '../engine/player'
import { BaseMark, MarkInstanceImpl } from '../engine/mark'
import { BaseSkill, SkillInstance } from '../engine/skill'
import { Effect } from '../engine/effect'
import { ConfigSystem } from '../engine/config'
import { ParameterCatalog } from '../engine/content/parameters'
import {
  defineNativeBehavior,
  normalizeBehaviorDefinitions,
  BehaviorCompilationError,
} from '../engine/content/behaviors'
import { SandboxFault, type SandboxPolicy } from './contracts'

type Fn = (...args: unknown[]) => unknown
type Scope = {
  active: boolean
  readonly values: object[]
  effect?: EffectContext<import('@arcadia-eternity/const').EffectTrigger>
}
const isClassConstructor = (value: Fn) => /^class(?:\s|\{)/.test(Function.prototype.toString.call(value))
const projectedClasses = {
  Pet,
  Player,
  Battle,
  MarkInstanceImpl,
  ConfigSystem,
  Context,
  BaseMark,
  BaseSkill,
  SkillInstance,
  Effect,
}
const projectionRules = (Object.keys(projectedMethods) as (keyof typeof projectedMethods)[]).map(name => ({
  Class: projectedClasses[name],
  methods: projectedMethods[name] as readonly string[],
}))
const denied = new Set(['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments'])
const coreSdk = { ...sdk, defineNativeBehavior, normalizeBehaviorDefinitions, BehaviorCompilationError }
const authorFunctions = new Set<string>(effectSdkFunctions)
type PhaseOperation = (typeof phaseOperations)[number]
const phaseFunctions = new Map<unknown, PhaseOperation>(phaseOperations.map(name => [sdk[name], name]))
const eventPhases = {
  dealDamage: DamageContext,
  heal: HealContext,
  changeRage: RageContext,
  addMark: AddMarkContext,
  removeMark: RemoveMarkContext,
} as const

function frame(value: object): boolean {
  return typeof Reflect.get(value, 'read') === 'function' && !!Reflect.get(value, 'ops')
}
/** SDK-specific projections and canonical registrations. Arena owns marshalling, proxies and handles. */
export class ArenaEffectSdk {
  private readonly canonical = new WeakSet<object>()
  private readonly proposedEvents = new WeakMap<Context, Scope>()
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
            const previous = this.activeScope
            const scope: Scope = {
              active: true,
              values: [],
              effect: args.find(arg => arg instanceof EffectContext) ?? previous?.effect,
            }
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
  private validatePhase(operation: PhaseOperation, args: unknown[]): void {
    const deny = (reason: string): never => this.reject(new SandboxFault('permission', 'sdk', reason))
    if (getDamageEvaluation()) return deny(`Cannot perform ${operation} during damage evaluation`)
    const scope = this.activeScope
    if (!scope?.effect) return deny('Phase operations require an active effect')
    const { battle } = scope.effect
    const isPet = (target: unknown) => target instanceof Pet && battle.petMap.get(target.id) === target
    const isMark = (mark: unknown) =>
      mark instanceof MarkInstanceImpl &&
      (mark.owner === battle || isPet(mark.owner)) &&
      mark.owner?.marks.includes(mark)
    const [event, target, ...rest] = args
    if (operation === 'transferMarks' || operation === 'consumeMarkStacks') {
      if (event !== scope.effect) return deny('Phase parent must be the current effect')
      if (operation === 'transferMarks') {
        if ((target !== battle && !isPet(target)) || !rest.every(isMark)) return deny('Invalid mark transfer')
      } else if (!isMark(target) || typeof rest[0] !== 'number' || !Number.isFinite(rest[0]) || rest[0] < 0)
        return deny('Invalid mark consumption')
      return
    }
    const Event = eventPhases[operation]
    if (!(event instanceof Event) || this.proposedEvents.get(event) !== scope || event.parent !== scope.effect)
      return deny(`${operation} requires a current proposal`)
    if (
      ((event instanceof DamageContext || event instanceof HealContext) &&
        (event.source !== scope.effect.source || !isPet(event.target))) ||
      (event instanceof RageContext && event.target !== battle.playerA && event.target !== battle.playerB) ||
      (event instanceof AddMarkContext &&
        (!(event.baseMark instanceof BaseMark) || (event.target !== battle && !isPet(event.target)))) ||
      (event instanceof RemoveMarkContext && !isMark(event.mark))
    )
      return deny(`Invalid ${operation} proposal target or source`)
    this.proposedEvents.delete(event)
  }
  output<T>(value: T, scope: Scope | undefined = this.activeScope, ephemeral = false): T {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || this.canonical.has(value as object))
      return value
    if (Array.isArray(value)) {
      for (const item of value) this.output(item, scope, ephemeral)
      return value
    }
    if (value instanceof Map || value instanceof Set) {
      for (const item of value.values()) this.output(item, scope, ephemeral)
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
          if (isClass && getDamageEvaluation())
            return this.reject(
              new SandboxFault('permission', 'sdk', 'Cannot construct host objects during damage evaluation'),
            )
          if (value === DamageContext) {
            const [parent, source, target] = input
            if (
              input.length > 13 ||
              !this.activeScope?.effect ||
              parent !== this.activeScope.effect ||
              source !== this.activeScope.effect.source ||
              !(target instanceof Pet) ||
              this.activeScope.effect.battle.petMap.get(target.id) !== target
            )
              return this.reject(new SandboxFault('permission', 'sdk', 'Invalid damage proposal identity'))
          }
          const result = isClass ? Reflect.construct(fn, input) : fn(...input)
          if (isClass && result instanceof Context && this.activeScope?.effect)
            this.proposedEvents.set(result, this.activeScope)
          return ephemeral ? this.output(result, scope, true) : this.output(result)
        })
      if (isClass) Object.defineProperty(callable, Symbol.hasInstance, { value: (item: unknown) => item instanceof fn })
      this.register(fn, callable)
      if (ephemeral) scope?.values.push(fn)
      return value
    }
    const original = value as object
    const session = this.session
    const domainRule = projectionRules.find(rule => original instanceof rule.Class)
    const isDomain = !!domainRule,
      isFrame = frame(original)
    const temporary = isFrame || original instanceof Context || (ephemeral && !isDomain)
    const keys: readonly PropertyKey[] = isFrame
      ? ['trigger', 'parent', 'read', 'ops']
      : isDomain
        ? [...domainFields, ...domainRule.methods]
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
              if (isDomain && !domainRule.methods.includes(String(key)))
                return this.reject(new SandboxFault('permission', 'sdk', 'Direct domain methods denied'))
              if (isClassConstructor(member as Fn)) return this.output(member)
              if (!members.has(key)) {
                const phase = phaseFunctions.get(member)
                members.set(key, (...args) => {
                  // Check at call time, including handles captured in an earlier callback.
                  if (getDamageEvaluation()) {
                    if (isDomain && !evaluationReads.includes(String(key))) {
                      try {
                        const operation =
                          key === 'addModified'
                            ? original instanceof HealContext
                              ? 'modifyHeal'
                              : 'modifyDamage'
                            : String(key)
                        assertEvaluationOperation(operation, [original])
                      } catch (error) {
                        return this.reject(
                          new SandboxFault(
                            'permission',
                            'sdk',
                            error instanceof Error ? error.message : 'Damage evaluation forbids this operation',
                          ),
                        )
                      }
                    }
                    if (
                      original instanceof ParameterCatalog &&
                      ['register', 'install', 'restore'].includes(String(key))
                    )
                      return this.reject(
                        new SandboxFault('permission', 'sdk', 'Cannot change parameters during damage evaluation'),
                      )
                  }
                  if (phase) this.validatePhase(phase, args)
                  return Reflect.apply(member, original, args)
                })
              }
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
