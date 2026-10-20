import { markArgument } from './mark-argument.mjs'
import { skillSelection } from './skill-selection.mjs'
import { stackBinding, bindStackAttribute } from './stack-binding.mjs'
import { fields, members, number, selectedNumber, condition } from './authoring-emitter.mjs'
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
export function sequenceAction(a, trigger, domain = 'skill', parameters = [], path = 'value', markDependencies) {
  if (a?.type === 'conditional') {
    if (
      !markDependencies ||
      !fields(a, ['type', 'condition', 'trueOperator', ...('falseOperator' in a ? ['falseOperator'] : [])])
    )
      return
    const when = condition(a.condition, domain, parameters, `${path}_condition`, {
      ...sequenceConditionOptions,
      opponentProbability: true,
    })
    const yes = sequenceAction(a.trueOperator, trigger, domain, parameters, `${path}_true`, markDependencies)
    const no =
      'falseOperator' in a
        ? sequenceAction(a.falseOperator, trigger, domain, parameters, `${path}_false`, markDependencies)
        : undefined
    if (!when || !yes || ('falseOperator' in a && !no)) return
    return `actions.choose(${when},${yes}${no ? `,${no}` : ''})`
  }
  if (a?.type === 'addMark' && markDependencies) {
    if (
      !fields(a, ['type', 'target', 'mark', ...['stack', 'duration'].filter(k => Object.hasOwn(a, k))]) ||
      !['self', 'opponent'].includes(a.target)
    )
      return
    const mark = markArgument(a.mark, domain, parameters, `${path}_mark`, markDependencies, sequenceConditionOptions)
    if (!mark) return
    const options = []
    for (const key of ['stack', 'duration']) {
      if (!Object.hasOwn(a, key)) continue
      // The legacy parser treats a literal zero as an omitted option.
      if (a[key] === 0) continue
      const value = number(a[key], parameters, `${path}_${key}`, domain)?.code
      if (!value) return
      options.push(`${key}:${value}`)
    }
    return `targets.${a.target === 'self' ? 'ownerPet' : 'opponentActive'}.apply(ops.addMark(${mark}${options.length ? `,{${options.join(',')}}` : ''}))`
  }
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
      const binding = stackBinding(a.value.selector, parameters, path, domain)
      if (binding) return bindStackAttribute(selected, a.stat, a.modifierType, binding, path)
    }
    const value = number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `${selected}.apply(ops.${operation}(${JSON.stringify(a.stat)},${JSON.stringify(a.modifierType)},${value}))`
  }
  if (a?.type === 'setValue' && fields(a, ['type', 'target', 'value']) && typeof a.value === 'boolean') {
    const target = a.target
    if (
      !fields(target, ['base', 'chain']) ||
      target.base !== 'selfSkills' ||
      !Array.isArray(target.chain) ||
      !target.chain.length
    )
      return
    const last = target.chain.at(-1)
    if (!fields(last, ['type', 'arg']) || last.type !== 'selectProp' || last.arg !== 'sureHit') return
    const selected = skillSelection({ ...target, chain: target.chain.slice(0, -1) })
    return selected ? `${selected}.apply(ops.setSkillSureHit(${a.value}))` : undefined
  }
  if (a?.type === 'addSkillAttributeModifier') {
    if (
      !fields(a, ['type', 'target', 'attribute', 'modifierType', 'value']) ||
      !['power', 'accuracy', 'rage', 'priority'].includes(a.attribute) ||
      !['delta', 'percent', 'override'].includes(a.modifierType)
    )
      return
    const selected = skillSelection(a.target)
    if (!selected) return
    if (trigger === 'OnMarkCreated' && fields(a.value, ['type', 'selector']) && a.value.type === 'dynamic') {
      const binding = stackBinding(a.value.selector, parameters, path, domain)
      if (binding) return bindStackAttribute(selected, a.attribute, a.modifierType, binding, path, 'bindSkillAttribute')
    }
    const value = number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `${selected}.apply(ops.addSkillAttributeModifier(${JSON.stringify(a.attribute)},${JSON.stringify(a.modifierType)},${value},{lifetime:"sourceMarkOrTargetSkill"}))`
  }
  if (a?.type === 'addDynamicAttributeModifier') {
    if (
      !fields(a, ['type', 'target', 'stat', 'modifierType', 'observableValue']) ||
      !(a.target === 'self' || (fields(a.target, ['base']) && a.target.base === 'self')) ||
      !['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion', 'critRate', 'ragePerTurn', 'weight'].includes(
        a.stat,
      ) ||
      !['delta', 'percent', 'override'].includes(a.modifierType)
    )
      return
    const binding = stackBinding(a.observableValue, parameters, path, domain)
    if (!binding) return
    return bindStackAttribute('targets.ownerPet', a.stat, a.modifierType, binding, path)
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
    if (
      markDependencies &&
      a.type === 'setMultihit' &&
      Array.isArray(a.value) &&
      a.value.length &&
      a.value.every(Number.isFinite)
    )
      return `contexts.skillUse.apply(ops.setMultihit(selectFrom(${JSON.stringify(a.value)}).all()))`
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
  if (a?.type === 'addValue') {
    if (
      !fields(a, ['type', 'target', 'value']) ||
      !fields(a.target, ['base', 'chain']) ||
      a.target.base !== 'usingSkillContext' ||
      !Array.isArray(a.target.chain) ||
      a.target.chain.length !== 1
    )
      return
    const step = a.target.chain[0]
    if (
      !fields(step, ['type', 'arg']) ||
      step.type !== 'selectProp' ||
      !['rage', 'evasion', 'priority'].includes(step.arg)
    )
      return
    const value = number(a.value, parameters, path, domain)?.code
    if (!value) return
    return `contexts.skillUse.property(${JSON.stringify(step.arg)}).apply(ops.add(${value}))`
  }
  if (a?.type === 'setActualTarget') {
    if (
      !fields(a, ['type', 'target', 'newTarget']) ||
      a.target !== 'usingSkillContext' ||
      !fields(a.newTarget, ['type', 'selector']) ||
      a.newTarget.type !== 'dynamic' ||
      a.newTarget.selector !== 'self'
    )
      return
    return 'contexts.skillUse.apply(ops.setActualTarget(targets.ownerPet.first()))'
  }
  if (a?.type === 'setIgnoreStageStrategy') {
    if (
      !fields(a, ['type', 'target', 'value']) ||
      a.target !== 'usingSkillContext' ||
      !['none', 'all', 'positive', 'negative'].includes(a.value)
    )
      return
    return `contexts.skillUse.apply(ops.setIgnoreStageStrategy(${JSON.stringify(a.value)}))`
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
  if (a?.type === 'clearStatStage' || a?.type === 'reverseStatStage') {
    if (!fields(a, ['type', 'target', ...['statType', 'cleanStageStrategy'].filter(key => Object.hasOwn(a, key))]))
      return
    if (!['self', 'opponent'].includes(a.target)) return
    const strategy = a.cleanStageStrategy ?? 'positive'
    if (!['positive', 'negative', 'all'].includes(strategy) || a.cleanStageStrategy === null) return
    const stats = !Object.hasOwn(a, 'statType') ? [] : Array.isArray(a.statType) ? a.statType : [a.statType]
    if (!stats.every(stat => ['atk', 'def', 'spa', 'spd', 'spe'].includes(stat))) return
    return `targets.${a.target === 'self' ? 'ownerPet' : 'opponentActive'}.apply(ops.${a.type === 'clearStatStage' ? 'clearStatStages' : 'reverseStatStages'}({stats:${JSON.stringify(stats)},strategy:${JSON.stringify(strategy)}}))`
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
  if (
    a.type !== 'addStacks' &&
    !Number.isFinite(a.value) &&
    a.value?.type !== 'raw:number' &&
    !(markDependencies && a.type === 'consumeStacks' && a.value?.type === 'dynamic')
  )
    return
  const amount = number(a.value, parameters, path, domain)
  if (!amount) return
  return `${target}.apply(ops.${a.type}(${amount.code}))`
}
