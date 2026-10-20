import { fields } from './authoring-emitter.mjs'
/** Fresh skill membership and filters; no guessed field aliases. */
export function skillSelection(target) {
  if (target === 'skill') return 'targets.sourceSkill'
  if (target === 'selfSkills' || (fields(target, ['base']) && target.base === 'selfSkills')) return 'targets.selfSkills'
  if (!fields(target, ['base', 'chain']) || target.base !== 'selfSkills' || !Array.isArray(target.chain)) return
  let code = 'targets.selfSkills'
  for (const step of target.chain) {
    if (!fields(step, ['type', 'extractor', 'evaluator']) || step.type !== 'whereAttr') return
    const x = step.extractor,
      e = step.evaluator
    if (!fields(x, ['type', 'arg'])) return
    if (
      x.type === 'base' &&
      x.arg === 'tags' &&
      fields(e, ['type', 'tag']) &&
      e.type === 'contain' &&
      typeof e.tag === 'string'
    ) {
      code += `.where(skill => skill.tags.includes(${JSON.stringify(e.tag)}))`
      continue
    }
    if (
      (x.type === 'base' && x.arg === 'baseId') ||
      (['base', 'dynamic'].includes(x.type) && x.arg === 'element') ||
      (x.type === 'dynamic' && x.arg === 'category')
    ) {
      if (!fields(e, ['type', 'value']) || !['same', 'notSame'].includes(e.type) || typeof e.value !== 'string') return
      code += `.where(skill => (skill.${x.arg} as string) ${e.type === 'same' ? '===' : '!=='} ${JSON.stringify(e.value)})`
      continue
    }
    if (
      x.type === 'dynamic' &&
      x.arg === 'power' &&
      fields(e, ['type', 'operator', 'value']) &&
      e.type === 'compare' &&
      e.operator === '<' &&
      Number.isFinite(e.value)
    ) {
      code += `.where(skill => skill.power < ${e.value})`
      continue
    }
    return
  }
  return code
}
