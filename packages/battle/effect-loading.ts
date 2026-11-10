/** Pure author-side loading SDK. This module is bundled into the admitted VM, never a global host registry. */
import {
  Effect,
  BaseMark,
  effectParameters,
  hasAuthoredParameters,
  defineCodeEffect,
  type EffectTrigger,
  type ParameterCatalog,
  type NativeBehaviorExport,
  type NativeEffectTrigger,
  type NativeEffectContext,
  type CodeEffectModuleContext,
} from '@arcadia-eternity/battle/authoring'

type Compiled = Effect<EffectTrigger>
export type EffectGroupResult =
  | Compiled
  | Readonly<Record<string, Compiled>>
  | {
      readonly effects: Readonly<Record<string, Compiled>>
      readonly parameters: ParameterCatalog
      readonly parameterMode?: 'fallback'
    }
export interface EffectLoadingContext {
  readonly marks: ReadonlyMap<string, BaseMark>
  readonly effects: ReadonlyMap<string, Compiled>
  readonly parameters: ReadonlyMap<string, ParameterCatalog>
  mark(id: string): BaseMark
}
interface GroupOptions {
  readonly id: string
  readonly dependsOn?: readonly string[]
}
interface Group extends GroupOptions {
  build(context: EffectLoadingContext): EffectGroupResult
}
const groups = new WeakMap<object, Group>()
/** Group large generated families without writing a central registration list. Dependencies are names, not order. */
export function effectGroup(options: GroupOptions) {
  return <T extends { build(context: EffectLoadingContext): EffectGroupResult }>(
    value: T,
    _context: ClassDecoratorContext,
  ) => {
    if (!options.id || groups.has(value)) throw new Error('Invalid or repeated effect group decorator')
    groups.set(
      value,
      Object.freeze({
        ...options,
        dependsOn: Object.freeze([...(options.dependsOn ?? [])]),
        build: (context: EffectLoadingContext) => value.build(context),
      }),
    )
  }
}

interface EffectOptions {
  readonly id: string
  readonly sourceKind: 'skill' | 'petMark'
  readonly priority?: number
}
type Handler = (context: NativeEffectContext<NativeEffectTrigger>, content: CodeEffectModuleContext) => void
const handlers = new WeakMap<object, { trigger: NativeEffectTrigger; call: Handler }>()
const definitions = new WeakMap<object, (context: CodeEffectModuleContext) => NativeBehaviorExport>()
/** Static methods cannot accidentally retain per-battle state in an author class instance. */
export function on<T extends NativeEffectTrigger>(trigger: T) {
  return (
    value: (context: NativeEffectContext<T>, content: CodeEffectModuleContext) => void,
    context: ClassMethodDecoratorContext,
  ) => {
    if (!context.static || context.private) throw new Error('@on requires a public static method')
    if (handlers.has(value)) throw new Error('Duplicate trigger decorator')
    handlers.set(value, { trigger, call: value as Handler })
  }
}
export function effect(options: EffectOptions) {
  return <T extends abstract new (...args: never[]) => object>(value: T, _context: ClassDecoratorContext) => {
    if (!options.id || definitions.has(value)) throw new Error('Invalid or repeated effect decorator')
    const custom = Reflect.get(value, 'create') as
      | ((context: CodeEffectModuleContext) => NativeBehaviorExport)
      | undefined
    if (typeof custom === 'function') {
      definitions.set(value, context => {
        const definition = custom(context)
        if (definition.id !== context.id(options.id) || definition.sourceKind !== options.sourceKind)
          throw new Error(`Mismatched effect factory: ${options.id}`)
        return definition
      })
      return
    }
    const entries = Object.getOwnPropertyNames(value).flatMap(key => {
      const method = Object.getOwnPropertyDescriptor(value, key)?.value
      const handler = typeof method === 'function' ? handlers.get(method) : undefined
      return handler ? [handler] : []
    })
    if (!entries.length) throw new Error(`Effect ${options.id} has no @on methods`)
    if (new Set(entries.map(entry => entry.trigger)).size !== entries.length)
      throw new Error(`Duplicate trigger in ${options.id}`)
    definitions.set(value, context =>
      defineCodeEffect({
        ...options,
        id: context.id(options.id),
        triggers: entries.map(entry => entry.trigger),
        apply: event => {
          entries.find(entry => entry.trigger === event.trigger)!.call(event, context)
        },
      }),
    )
  }
}

export interface EffectSource {
  readonly file: string
  readonly exports: Readonly<Record<string, unknown>>
}
/** All exports may be inspected; only decorated classes participate. Importing helpers registers nothing. */
export function loadEffectGroups(sources: readonly EffectSource[], marks: ReadonlyMap<string, BaseMark>) {
  const providers = new Map<string, { group: Group; file: string }>()
  const seen = new Set<object>()
  for (const source of sources)
    for (const value of Object.values(source.exports)) {
      if (typeof value !== 'function' || seen.has(value)) continue
      seen.add(value)
      const group = groups.get(value)
      if (!group) continue
      const previous = providers.get(group.id)
      if (previous) throw new Error(`Duplicate effect group ${group.id}: ${previous.file}, ${source.file}`)
      providers.set(group.id, { group, file: source.file })
    }
  const effects = new Map<string, Compiled>(),
    parameters = new Map<string, ParameterCatalog>(),
    families = new Map<string, string>()
  const complete = new Set<string>(),
    chain: string[] = []
  const context: EffectLoadingContext = {
    marks,
    effects,
    parameters,
    mark(id) {
      const mark = marks.get(id)
      if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error(`Missing or mismatched mark: ${id}`)
      return mark
    },
  }
  function visit(id: string) {
    if (complete.has(id)) return
    if (chain.includes(id)) throw new Error(`Effect initialization cycle: ${[...chain, id].join(' -> ')}`)
    const provider = providers.get(id)
    if (!provider) throw new Error(`Missing effect group: ${[...chain, id].join(' -> ')}`)
    chain.push(id)
    try {
      for (const dependency of provider.group.dependsOn ?? []) visit(dependency)
      const result = provider.group.build(context)
      const grouped = !(result instanceof Effect) && 'effects' in result && 'parameters' in result
      const table = result instanceof Effect ? { [result.id]: result } : grouped ? result.effects : result
      for (const [key, effect] of Object.entries(table)) {
        if (!(effect instanceof Effect) || effect.id !== key) throw new Error(`Invalid effect: ${key}`)
        if (effects.has(key)) throw new Error(`Duplicate effect ${key}: ${families.get(key)}, ${id}`)
        effects.set(key, effect)
        families.set(key, id)
        if (hasAuthoredParameters(effect)) parameters.set(key, effectParameters(effect))
        if (grouped && (result.parameterMode !== 'fallback' || !hasAuthoredParameters(effect)))
          parameters.set(key, result.parameters as ParameterCatalog)
      }
      complete.add(id)
    } catch (error) {
      throw new Error(
        `${provider.file} [${id}]: ${error instanceof Error ? error.message : 'Effect construction failed'}`,
        { cause: error },
      )
    } finally {
      chain.pop()
    }
  }
  for (const id of providers.keys()) visit(id)
  return { effects, parameters, families }
}
export function loadCodeEffects(
  sources: readonly EffectSource[],
  context: CodeEffectModuleContext,
  catalog = false,
): readonly NativeBehaviorExport[] {
  const result: NativeBehaviorExport[] = [],
    seen = new Set<object>(),
    ids = new Set<string>()
  for (const source of sources)
    for (const value of Object.values(source.exports)) {
      if (typeof value !== 'function' || seen.has(value)) continue
      seen.add(value)
      if (!catalog && groups.has(value))
        throw new Error(`${source.file}: Fixed effect groups require a catalog host; use @effect for behavior uses`)
      const factory = definitions.get(value)
      if (!factory) continue
      const definition = factory(context)
      if (ids.has(definition.id)) throw new Error(`${source.file}: Duplicate effect ${definition.id}`)
      ids.add(definition.id)
      result.push(definition)
    }
  for (const registration of loadEffectTemplates(sources)) {
    const definition = registration.register(context.marks)
    if (ids.has(definition.id)) throw new Error(`Duplicate effect ${definition.id}`)
    ids.add(definition.id)
    result.push(definition)
  }
  return Object.freeze(result)
}

export interface EffectTemplateRegistration {
  readonly template: {
    readonly id: string
    readonly definition: import('@arcadia-eternity/battle/engine').BehaviorDefinition
  }
  readonly register: (marks: ReadonlyMap<string, BaseMark>) => NativeBehaviorExport
}
const templateGroups = new WeakMap<object, () => readonly EffectTemplateRegistration[]>()
export function effectTemplates<T extends { readonly templates: readonly EffectTemplateRegistration[] }>(
  value: T,
  _context: ClassDecoratorContext,
) {
  templateGroups.set(value, () => value.templates)
}
export function loadEffectTemplates(sources: readonly EffectSource[]): readonly EffectTemplateRegistration[] {
  const result: EffectTemplateRegistration[] = [],
    seen = new Set<object>(),
    ids = new Set<string>()
  for (const source of sources)
    for (const value of Object.values(source.exports)) {
      if (typeof value !== 'function' || seen.has(value)) continue
      seen.add(value)
      for (const registration of templateGroups.get(value)?.() ?? []) {
        if (ids.has(registration.template.id))
          throw new Error(`${source.file}: Duplicate template ${registration.template.id}`)
        ids.add(registration.template.id)
        result.push(registration)
      }
    }
  return Object.freeze(result)
}
