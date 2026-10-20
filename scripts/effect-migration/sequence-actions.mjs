import { fields, members, number, selectedNumber } from './authoring-emitter.mjs'
import { classifySkillOutcome } from './skill-outcomes.mjs'
import { classifySkillPower } from './skill-power.mjs'
export const sequenceConditionOptions = Object.freeze({
  eventOwnership: true,
  collectionCompare: true,
  defensiveSkill: true,
  skillCategory: true,
})
const outcomeTypes = ['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit']
const skillActionTypes = [...outcomeTypes, 'addPower', 'amplifyPower']
export function sequenceAction(a, trigger, domain = 'skill', parameters = [], path = 'value') {
  if (a?.value?.type === 'conditional' && !['heal', 'dealDamage', 'addRage'].includes(a.type)) return
  if (a?.type === 'addAttributeModifier') {
    if (
      !fields(a, ['type', 'target', 'stat', 'modifierType', 'value']) ||
      !['delta', 'percent', 'override'].includes(a.modifierType)
    )
      return
    const target = typeof a.target === 'string' ? a.target : fields(a.target, ['base']) ? a.target.base : undefined
    let selected,
      operation = 'addAttributeModifier'
    if (
      ['self', 'selfTeam'].includes(target) &&
      ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion', 'critRate', 'ragePerTurn', 'weight'].includes(a.stat)
    )
      selected = target === 'self' ? 'targets.ownerPet' : 'targets.selfTeam'
    else if (
      fields(a.target, ['base', 'chain']) &&
      a.target.base === 'selfSkills' &&
      Array.isArray(a.target.chain) &&
      a.stat === 'accuracy' &&
      a.target.chain.length === 1
    ) {
      const step = a.target.chain[0],
        extractor = step?.extractor,
        evaluator = step?.evaluator
      if (
        !fields(step, ['type', 'extractor', 'evaluator']) ||
        step.type !== 'whereAttr' ||
        !fields(extractor, ['type', 'arg']) ||
        extractor.type !== 'base'
      )
        return
      if (
        extractor.arg === 'baseId' &&
        fields(evaluator, ['type', 'value']) &&
        evaluator.type === 'same' &&
        typeof evaluator.value === 'string'
      )
        selected = `targets.selfSkills.where(skill => skill.baseId === ${JSON.stringify(evaluator.value)})`
      if (
        extractor.arg === 'tags' &&
        fields(evaluator, ['type', 'tag']) &&
        evaluator.type === 'contain' &&
        typeof evaluator.tag === 'string'
      )
        selected = `targets.selfSkills.where(skill => skill.tags.includes(${JSON.stringify(evaluator.tag)}))`
      operation = 'addSkillAttributeModifier'
    }
    if (!selected) return
    if (target === 'self' && fields(a.value, ['type', 'selector']) && a.value.type === 'dynamic') {
      const query = a.value.selector
      if (
        fields(query, ['base', 'chain']) &&
        query.base === 'mark' &&
        Array.isArray(query.chain) &&
        query.chain.length === 2
      ) {
        const [attribute, multiply] = query.chain
        if (
          fields(attribute, ['type', 'arg']) &&
          attribute.type === 'selectAttribute$' &&
          attribute.arg === 'stack' &&
          fields(multiply, ['type', 'arg']) &&
          multiply.type === 'multiply'
        ) {
          const factor = number(multiply.arg, parameters, `${path}_factor`, domain)
          if (
            factor &&
            !factor.literal &&
            fields(multiply.arg, ['type', 'configId', 'value']) &&
            multiply.arg.type === 'raw:number'
          )
            return `${selected}.apply(ops.bindAttribute({key:${JSON.stringify(`${path}_binding`)},attribute:${JSON.stringify(a.stat)},operation:${JSON.stringify(a.modifierType)},value:bindings.combine(targets.sourceMark.first().capture({key:"source",scope:"binding"}).attribute("stack").follow({key:"stack"}),${factor.code}.capture({key:"factor",scope:"binding"}),(stack,factor)=>Math.floor(stack*factor)),stacking:"append",lifetime:"sourceMark",missing:"detach"}))`
        }
      }
    }
    const value = number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `${selected}.apply(ops.${operation}(${JSON.stringify(a.stat)},${JSON.stringify(a.modifierType)},${value}))`
  }
  if (a?.type === 'stun') {
    if (!fields(a, ['type', 'target']) || a.target !== 'usingSkillContext') return
    return 'contexts.skillUse.apply(ops.disableContext())'
  }
  if (a?.type === 'disableContext') {
    if (!fields(a, ['type', 'target'])) return
    if (!['addMarkContext', 'effectContext'].includes(a.target)) return
    const target = a.target === 'addMarkContext' ? 'addMark' : 'effect'
    if (!target) return
    return `contexts.${target}.apply(ops.disableContext())`
  }
  if (['setMarkDuration', 'setMarkStack', 'setMarkMaxStack'].includes(a?.type)) {
    if (!fields(a, ['type', 'target', 'value'])) return
    if (!(a.target === 'addMarkContext' || (fields(a.target, ['base']) && a.target.base === 'addMarkContext'))) return
    const value =
      fields(a.value, ['type', 'selector']) && a.value.type === 'dynamic'
        ? selectedNumber(a.value.selector, parameters, path, 'all', domain)
        : number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `contexts.addMark.apply(ops.${a.type}(${value}))`
  }
  if (['addMultihitResult', 'setMultihit'].includes(a?.type)) {
    if (!fields(a, ['type', 'target', 'value'])) return
    if (!(a.target === 'usingSkillContext' || (fields(a.target, ['base']) && a.target.base === 'usingSkillContext')))
      return
    const value =
      a.type === 'addMultihitResult' && fields(a.value, ['type', 'selector']) && a.value.type === 'dynamic'
        ? selectedNumber(a.value.selector, parameters, path, 'all', domain)
        : number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `contexts.skillUse.apply(ops.${a.type}(${value}))`
  }
  if (a?.type === 'addThreshold') {
    if (
      !fields(a, ['type', 'target', ...['min', 'max'].filter(key => Object.hasOwn(a, key))]) ||
      a.target !== 'damageContext'
    )
      return
    const bounds = []
    for (const key of ['min', 'max']) {
      // The legacy parser drops literal zero; a raw:number zero remains an explicit value.
      if (!Object.hasOwn(a, key) || a[key] === 0) continue
      if (a[key]?.type === 'conditional') return
      const bound = number(a[key], parameters, `${path}_${key}`, domain)
      if (!bound) return
      bounds.push(`${key}:${bound.code}`)
    }
    return `contexts.damage.apply(ops.setDamageThreshold({${bounds.join(',')}}))`
  }
  if (a?.type === 'preventDamage') {
    if (!fields(a, ['type', 'target']) || a.target !== 'damageContext') return
    return 'contexts.damage.apply(ops.preventDamage())'
  }
  if (a?.type === 'addModified') {
    if (a.percent?.type === 'conditional' || a.delta?.type === 'conditional') return
    if (
      !fields(a, ['type', 'target', 'percent', 'delta']) ||
      !(a.target === 'damageContext' || (fields(a.target, ['base']) && a.target.base === 'damageContext'))
    )
      return
    const percent = number(a.percent, parameters, `${path}_percent`, domain)
    const delta = number(a.delta, parameters, `${path}_delta`, domain)
    if (!percent || !delta) return
    return `contexts.damage.apply(ops.modifyDamage({percent:${percent.code},delta:${delta.code}}))`
  }
  if (['heal', 'dealDamage', 'addRage'].includes(a?.type)) {
    if (!fields(a, ['type', 'target', 'value'])) return
    const target = typeof a.target === 'string' ? a.target : fields(a.target, ['base']) ? a.target.base : undefined
    const roots = {
      self: 'ownerPet',
      opponent: 'opponentActive',
      ...(a.type === 'addRage' ? { selfPlayer: 'selfPlayer' } : {}),
    }
    if (!Object.hasOwn(roots, target)) return
    const value = number(a.value, parameters, path, domain, {
      ...sequenceConditionOptions,
      dynamicClamp: true,
      conditionalDivisor: true,
      dynamicMultiply: true,
      conditionalParameters: true,
    })
    if (!value) return
    return `targets.${roots[target]}.apply(ops.${a.type}(${value.code}))`
  }
  if (skillActionTypes.includes(a?.type)) {
    const classifier = outcomeTypes.includes(a.type) ? classifySkillOutcome : classifySkillPower
    const recipe = classifier({ id: 'sequence-node', trigger, priority: 0, apply: a })
    if (recipe.reason || recipe.parameters?.length) return
    return `contexts.skillUse.apply(ops.${recipe.operation}(${recipe.value ?? recipe.amount}))`
  }
  if (a?.type === 'clearStatStage') {
    if (!fields(a, ['type', 'target', ...['statType', 'cleanStageStrategy'].filter(key => Object.hasOwn(a, key))]))
      return
    if (!['self', 'opponent'].includes(a.target)) return
    const strategy = a.cleanStageStrategy ?? 'positive'
    if (!['positive', 'negative', 'all'].includes(strategy) || a.cleanStageStrategy === null) return
    const stats = !Object.hasOwn(a, 'statType') ? [] : Array.isArray(a.statType) ? a.statType : [a.statType]
    if (!stats.every(stat => ['atk', 'def', 'spa', 'spd', 'spe'].includes(stat))) return
    return `targets.${a.target === 'self' ? 'ownerPet' : 'opponentActive'}.apply(ops.clearStatStages({stats:${JSON.stringify(stats)},strategy:${JSON.stringify(strategy)}}))`
  }
  if (a?.type === 'statStageBuff') {
    if (!fields(a, ['type', 'target', 'statType', 'value']) || !Number.isFinite(a.value)) return
    const target = typeof a.target === 'string' ? a.target : fields(a.target, ['base']) ? a.target.base : undefined
    if (!['self', 'opponent'].includes(target)) return
    const stats = ['atk', 'def', 'spa', 'spd', 'spe']
    if (!stats.includes(a.statType)) {
      const pick = a.statType
      if (
        !fields(pick, ['type', 'value', 'chain']) ||
        pick.type !== 'selector' ||
        !Array.isArray(pick.value) ||
        !pick.value.length ||
        !pick.value.every(v => stats.includes(v)) ||
        !Array.isArray(pick.chain) ||
        pick.chain.length !== 1 ||
        !fields(pick.chain[0], ['type', 'arg']) ||
        pick.chain[0].type !== 'randomPick' ||
        pick.chain[0].arg !== 1
      )
        return
      return `targets.${target === 'self' ? 'ownerPet' : 'opponentActive'}.apply((ctx,pets) => {const stat=ctx.read(selectFrom(${JSON.stringify(pick.value)} as const).shuffled().first());if(stat!==undefined) ops.changeStatStage(stat,${a.value})(ctx,pets)})`
    }
    return `targets.${target === 'self' ? 'ownerPet' : 'opponentActive'}.apply(ops.changeStatStage(${JSON.stringify(a.statType)},${a.value}))`
  }
  if (!['consumeStacks', 'destroyMark', 'addStacks'].includes(a?.type)) return
  if (!fields(a, ['type', 'target', ...(a.type !== 'destroyMark' ? ['value'] : [])])) return
  const target =
    a.target === 'mark' || (fields(a.target, ['base']) && a.target.base === 'mark')
      ? 'targets.sourceMark'
      : members(a.target, domain)
  if (!target) return
  if (a.type === 'destroyMark') return `${target}.apply(ops.removeMark())`
  if (a.type !== 'addStacks' && !Number.isFinite(a.value) && a.value?.type !== 'raw:number') return
  const amount = number(a.value, parameters, path, domain)
  if (!amount) return
  return `${target}.apply(ops.${a.type}(${amount.code}))`
}
