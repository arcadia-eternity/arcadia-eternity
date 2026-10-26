import {
  defineNativeBehavior,
  type BaseMark,
  type BehaviorDefinition,
  type BehaviorParameter,
  type NativeBehaviorExport,
} from '@arcadia-eternity/battle/v4'
import {
  numberParam,
  stringParam,
  booleanParam,
  conditions,
  type Condition,
  type EffectDefinition,
  type Parameter,
  type Trigger,
} from '@arcadia-eternity/battle/v4/authoring'

export interface TemplateField {
  readonly label: string
  readonly unit?: string
  readonly contract: BehaviorParameter
}
export interface EffectTemplate {
  readonly id: string
  readonly family: string
  readonly title: string
  readonly description: string
  readonly timing: string
  readonly fields: Readonly<Record<string, TemplateField>>
  readonly definition: BehaviorDefinition
}
export interface TemplateRegistration {
  readonly template: EffectTemplate
  readonly register: (marks: ReadonlyMap<string, BaseMark>) => NativeBehaviorExport
}
export interface BuildContext {
  readonly number: (name: string) => Parameter<number>
  readonly text: (name: string) => string
  readonly mark: (name: string) => BaseMark
  readonly successor: (name: string) => BaseMark
  readonly scalar: (name: string) => number
}

export function numeric(
  label: string,
  value: number,
  minimum: number,
  maximum: number,
  unit?: string,
  integer = false,
): TemplateField {
  return {
    label,
    unit,
    contract: { kind: 'number', default: value, minimum, maximum, ...(integer ? { integer } : {}) },
  }
}
export function choice(label: string, values: readonly string[], value = values[0]): TemplateField {
  return { label, contract: { kind: 'string', default: value, enum: [...values], static: true } }
}
export function reference(label: string, kind: 'mark' | 'skill'): TemplateField {
  return { label, contract: { kind: 'string', default: '', maxLength: 256, reference: kind, static: true } }
}
export function textField(label: string, value: string): TemplateField {
  return { label, contract: { kind: 'string', default: value, maxLength: 128, static: true } }
}
export function probability(value: Parameter<number>): Condition {
  return ctx => {
    const percent = ctx.read(value)
    return percent === 100 || (percent > 0 && conditions.chance(value)(ctx))
  }
}
export const chance = () => numeric('触发概率', 100, 0, 100, '%')
export const stacks = () => numeric('层数', 1, 1, 100000, '层', true)
export const amount = (value = 10) => numeric('数值', value, -100000, 100000)
export const target = () => choice('对象', ['self', 'opponent'])
export const attributes = [
  'atk',
  'def',
  'spa',
  'spd',
  'spe',
  'accuracy',
  'evasion',
  'critRate',
  'weight',
  'ragePerTurn',
] as const
export const operations = ['delta', 'percent'] as const

/** A template fixes its executable plan; data supplies only the declared scalar fields and content references. */
export function template<T extends Trigger>(
  spec: {
    id: string
    family: string
    title: string
    description: string
    timing: string
    sourceKind: 'skill' | 'petMark'
    fields: Readonly<Record<string, TemplateField>>
  },
  build: (
    context: BuildContext,
  ) => Omit<EffectDefinition<T, Readonly<Record<string, Parameter<unknown>>>>, 'id' | 'parameters'>,
): TemplateRegistration {
  const parameters = Object.fromEntries(Object.entries(spec.fields).map(([name, field]) => [name, field.contract]))
  const exportId = `base/native/${spec.id}`
  const register = (marks: ReadonlyMap<string, BaseMark>) =>
    defineNativeBehavior({
      id: exportId,
      sourceKind: spec.sourceKind,
      parameters,
      build({ effectId, params, sourceMark }) {
        const tokens: Record<string, Parameter<unknown>> = Object.create(null)
        for (const [name, field] of Object.entries(parameters)) {
          const value = params[name]
          tokens[name] =
            field.kind === 'number'
              ? numberParam({ default: value as number })
              : field.kind === 'boolean'
                ? booleanParam({ default: value as boolean })
                : stringParam({ default: value as string })
        }
        const context: BuildContext = {
          number(name) {
            if (parameters[name]?.kind !== 'number') throw new Error(`Not a numeric template parameter: ${name}`)
            return tokens[name] as Parameter<number>
          },
          text(name) {
            if (parameters[name]?.kind !== 'string') throw new Error(`Not a text template parameter: ${name}`)
            return params[name] as string
          },
          scalar(name) {
            if (parameters[name]?.kind !== 'number' || !parameters[name].static)
              throw new Error(`Not a static numeric parameter: ${name}`)
            return params[name] as number
          },
          successor(name) {
            const mark = context.mark(name)
            if (!sourceMark || mark.id === sourceMark.id || mark.config.mutexGroup)
              throw new Error(
                'Successor must be a different mark without a mutex group; recursive removal is not supported',
              )
            return mark
          },
          mark(name) {
            const id = params[name]
            const value = typeof id === 'string' ? marks.get(id) : undefined
            if (!value) throw new Error(`Missing template mark: ${String(id)}`)
            return value
          },
        }
        return { ...build(context), id: effectId, parameters: tokens }
      },
    })
  // Normalize and freeze the public contract using the same code as the trusted export.
  const canonical = register(new Map())
  const fields = Object.fromEntries(
    Object.entries(spec.fields).map(([name, field]) => [
      name,
      Object.freeze({
        label: field.label,
        ...(field.unit ? { unit: field.unit } : {}),
        contract: canonical.parameters[name],
      }),
    ]),
  )
  const definition: BehaviorDefinition = Object.freeze({
    formatVersion: 1,
    id: `base/template/${spec.id}`,
    sourceKind: spec.sourceKind,
    parameters: canonical.parameters,
    implementation: Object.freeze({ kind: 'native', exportId }),
  })
  return Object.freeze({
    template: Object.freeze({
      id: definition.id,
      family: spec.family,
      title: spec.title,
      description: spec.description,
      timing: spec.timing,
      fields: Object.freeze(fields),
      definition,
    }),
    register,
  })
}
