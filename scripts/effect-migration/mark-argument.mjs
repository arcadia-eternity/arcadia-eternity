import { fields, condition } from './authoring-emitter.mjs'
/** Resolve declared mark identities; only the chosen conditional value is read at execution. */
export function markArgument(input, domain, parameters, path, dependencies, conditionOptions) {
  if (
    fields(input, ['type', 'value']) &&
    input.type === 'entity:baseMark' &&
    typeof input.value === 'string' &&
    input.value
  ) {
    dependencies.add(input.value)
    return `resolved.get(${JSON.stringify(input.value)})!`
  }
  if (!fields(input, ['type', 'condition', 'trueValue', 'falseValue']) || input.type !== 'conditional') return
  const when = condition(input.condition, domain, parameters, `${path}_condition`, conditionOptions)
  const yes = markArgument(input.trueValue, domain, parameters, `${path}_true`, dependencies, conditionOptions)
  const no = markArgument(input.falseValue, domain, parameters, `${path}_false`, dependencies, conditionOptions)
  if (when && yes && no) return `values.choose(${when},${yes},${no})`
}
