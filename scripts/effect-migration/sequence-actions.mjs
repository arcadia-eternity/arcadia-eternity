import { fields, members, number } from './authoring-emitter.mjs'
import { classifySkillOutcome } from './skill-outcomes.mjs'
import { classifySkillPower } from './skill-power.mjs'
const outcomeTypes = ['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit']
const skillActionTypes = [...outcomeTypes, 'addPower', 'amplifyPower']
export function sequenceAction(a, trigger, domain = 'skill', parameters = [], path = 'value') {
  if (a?.value?.type === 'conditional') return
  if (['heal', 'dealDamage', 'addRage'].includes(a?.type)) {
    if (!fields(a, ['type', 'target', 'value'])) return
    const target = typeof a.target === 'string' ? a.target : fields(a.target, ['base']) ? a.target.base : undefined
    const roots = {
      self: 'ownerPet',
      opponent: 'opponentActive',
      ...(a.type === 'addRage' ? { selfPlayer: 'selfPlayer' } : {}),
    }
    if (!Object.hasOwn(roots, target)) return
    const value = number(a.value, parameters, path, domain)
    if (!value) return
    return `targets.${roots[target]}.apply(ops.${a.type}(${value.code}))`
  }
  if (skillActionTypes.includes(a?.type)) {
    const classifier = outcomeTypes.includes(a.type) ? classifySkillOutcome : classifySkillPower
    const recipe = classifier({ id: 'sequence-node', trigger, priority: 0, apply: a })
    if (recipe.reason || recipe.parameters?.length) return
    return `contexts.skillUse.apply(ops.${recipe.operation}(${recipe.value ?? recipe.amount}))`
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
  if (!['consumeStacks', 'destroyMark'].includes(a?.type)) return
  if (!fields(a, ['type', 'target', ...(a.type === 'consumeStacks' ? ['value'] : [])])) return
  const target =
    a.target === 'mark' || (fields(a.target, ['base']) && a.target.base === 'mark')
      ? 'targets.sourceMark'
      : members(a.target, domain)
  if (!target) return
  if (a.type === 'destroyMark') return `${target}.apply(ops.removeMark())`
  if (!Number.isFinite(a.value)) return
  return `${target}.apply(ops.consumeStacks(${JSON.stringify(a.value)}))`
}
