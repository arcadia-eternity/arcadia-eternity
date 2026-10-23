import { Type } from '@sinclair/typebox'
import { BaseMark } from '../mark'
import { ConfigModifierType } from '../config'
import { defineAction } from './capabilities'
import { markParameterContract, type MarkInstanceParams } from './mark-parameters'

/** Bind a finite action to registered content; authors cannot name arbitrary constructors or functions. */
export function defineAddMarkAction(definition: {
  readonly id: string
  readonly mark: BaseMark
  readonly target: 'ownerPet' | 'skillTarget'
}) {
  const { id, mark, target } = definition
  if (Object.getPrototypeOf(mark) !== BaseMark.prototype)
    throw new Error('Add-mark actions require standard mark content')
  if (target !== 'ownerPet' && target !== 'skillTarget') throw new Error('Invalid add-mark target capability')
  const contract = markParameterContract(mark)
  const stack = Type.Integer({ minimum: 1, default: 1 })
  const duration = Type.Integer({ minimum: 1, default: mark.config.duration > 0 ? mark.config.duration : 3 })
  const operations = [ConfigModifierType.delta, ConfigModifierType.override] as const
  const defaults = contract?.normalize({}) ?? {}
  const instanceSchema = contract
    ? {
        ...contract.schema,
        properties: Object.fromEntries(
          Object.entries(contract.schema.properties).map(([field, schema]) => [
            field,
            Type.Intersect([schema, contract.publicParams[field].effectiveSchema], { default: defaults[field] }),
          ]),
        ),
      }
    : Type.Object({}, { additionalProperties: false })
  return defineAction({
    id,
    needs: [target],
    params: Type.Object(
      {
        mark: Type.Literal(mark.id, { default: mark.id }),
        stack,
        duration,
        instanceParams: { ...instanceSchema, default: defaults },
      },
      { additionalProperties: false },
    ),
    publicParams: {
      stack: { effectiveSchema: stack, operations },
      duration: { effectiveSchema: duration, operations },
      instanceParams: { fields: contract?.publicParams ?? {} },
    },
    execute(context, args) {
      context.ops.addMark(context[target], mark, {
        stack: args.stack,
        duration: args.duration,
        instanceParams: contract ? (args.instanceParams as MarkInstanceParams) : undefined,
      })
    },
  })
}
