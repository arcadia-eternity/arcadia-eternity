import { fields, number } from './authoring-emitter.mjs'
/** Capture a source identity once, then retain the live stack source. */
export function stackBinding(query, parameters, path, domain) {
  if (
    !fields(query, ['base', 'chain']) ||
    query.base !== 'mark' ||
    !Array.isArray(query.chain) ||
    ![1, 2].includes(query.chain.length)
  )
    return
  const [attribute, project] = query.chain
  if (!fields(attribute, ['type', 'arg']) || attribute.type !== 'selectAttribute$' || attribute.arg !== 'stack') return
  const stack =
    'targets.sourceMark.first().capture({key:"source",scope:"binding"}).attribute("stack").follow({key:"stack"})'
  if (query.chain.length === 1) return stack
  if (!fields(project, ['type', 'arg']) || !['multiply', 'clampMax'].includes(project.type)) return
  if (
    !(
      typeof project.arg === 'number' ||
      (fields(project.arg, ['type', 'configId', 'value']) && project.arg.type === 'raw:number')
    )
  )
    return
  const operand = number(project.arg, parameters, `${path}_factor`, domain)
  if (!operand) return
  const expression = project.type === 'multiply' ? 'Math.floor(stack*factor)' : 'Math.min(stack,factor)'
  if (operand.literal) return `${stack}.map(stack => ${expression.replaceAll('factor', operand.code)})`
  return `bindings.combine(${stack},${operand.code}.capture({key:"factor",scope:"binding"}),(stack,factor)=>${expression})`
}
export function bindStackAttribute(selected, stat, operation, value, path) {
  return `${selected}.apply(ops.bindAttribute({key:${JSON.stringify(`${path}_binding`)},attribute:${JSON.stringify(stat)},operation:${JSON.stringify(operation)},value:${value},stacking:"append",lifetime:"sourceMark",missing:"detach"}))`
}
