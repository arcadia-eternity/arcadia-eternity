import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { condition, number } from './authoring-emitter.mjs'
import { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, normalize(value[key])]),
    )
  return value
}
const hash = value =>
  createHash('sha256')
    .update(JSON.stringify(normalize(value)))
    .digest('hex')
const fields = (value, required, optional = []) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => [...required, ...optional].includes(key))
const requiredCondition = (condition, type) =>
  (fields(condition, ['type']) && condition.type === type) ||
  (fields(condition, ['type', 'conditions']) &&
    condition.type === 'every' &&
    Array.isArray(condition.conditions) &&
    condition.conditions.some(item => requiredCondition(item, type)))
// C11 applies only to these reviewed switch-target nodes; stage/guard remain unchanged.
const switchTargetIds = new Set([
  'effect_emblem_add_mark_shoudaoshanghaijianshao_15_on_switchin',
  'effect_emblem_add_mark_switchinpet_shoudaoshanghaijianshao_25_on_switchout',
  'effect_mark_add_damage_increase_25_on_switch_in',
])
export function classifyMarkApplication(original) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) return { reason: 'invalid definition' }
  const { definition: spelling, paths } = repairSkillSelector(original)
  const repaired = repairSkillPaths(spelling)
  if (repaired.reason) return repaired
  const definition = repaired.definition
  const switchTargetRepairs = []
  if (switchTargetIds.has(definition.id)) {
    const target = definition.apply?.target
    if (
      !fields(target, ['base', 'chain']) ||
      target.base !== 'switchPetContext' ||
      !Array.isArray(target.chain) ||
      target.chain.length !== 1 ||
      !fields(target.chain[0], ['type', 'arg']) ||
      target.chain[0].type !== 'selectPath' ||
      target.chain[0].arg !== 'switchInPetId'
    )
      return { reason: 'C11 switch target source node changed' }
    target.chain[0].arg = 'switchInPet'
    switchTargetRepairs.push({ path: '/apply/target/chain/0/arg', before: 'switchInPetId', after: 'switchInPet' })
  }
  if (
    !fields(definition, ['id', 'trigger', 'priority', 'apply'], ['condition', 'tags']) ||
    typeof definition.id !== 'string' ||
    !definition.id ||
    !Number.isFinite(definition.priority)
  )
    return { reason: 'unsupported definition fields or identity/priority' }
  if (
    'tags' in definition &&
    (!Array.isArray(definition.tags) || !definition.tags.every(tag => typeof tag === 'string'))
  )
    return { reason: 'invalid effect tags' }
  const action = definition.apply
  const switchTarget =
    fields(action?.target, ['base', 'chain']) &&
    action.target.base === 'switchPetContext' &&
    Array.isArray(action.target.chain) &&
    action.target.chain.length === 1 &&
    fields(action.target.chain[0], ['type', 'arg']) &&
    action.target.chain[0].type === 'selectPath' &&
    action.target.chain[0].arg === 'switchInPet'
  if (
    !fields(action, ['type', 'target', 'mark'], ['stack', 'duration']) ||
    action.type !== 'addMark' ||
    (!['self', 'opponent', 'battle'].includes(action.target) && !switchTarget)
  )
    return { reason: 'requires one addMark action on self/opponent/battle' }
  if (
    !fields(action.mark, ['type', 'value']) ||
    action.mark.type !== 'entity:baseMark' ||
    typeof action.mark.value !== 'string' ||
    !action.mark.value
  )
    return { reason: 'requires a fixed base mark reference' }
  const triggers = Array.isArray(definition.trigger) ? definition.trigger : [definition.trigger]
  const damageStage = triggers.every(trigger => ['OnDamage', 'PostDamage'].includes(trigger))
  const domain = damageStage
    ? 'damage'
    : triggers.every(trigger => ['OnSwitchIn', 'OnSwitchOut'].includes(trigger))
      ? 'switch'
      : 'skill'
  const parameters = []
  const when = 'condition' in definition ? condition(definition.condition, domain, parameters) : '() => true'
  const options = {}
  // Match legacy declaration order; runtime consumption remains stack then duration.
  for (const key of ['duration', 'stack']) {
    if (!Object.hasOwn(action, key)) continue
    const value = number(action[key], parameters, key, domain)
    if (!value) return { reason: 'unsupported stack/duration value' }
    // Literal zero was omitted by the parser; a queried/configured zero reaches AddMarkContext.
    if (value.literal) {
      if (action[key]) options[key] = action[key]
    } else options[`${key}Value`] = value.code
  }
  const supportedStage =
    (triggers.length === 1 &&
      triggers[0] === 'OnSwitchOut' &&
      fields(definition.condition, ['type']) &&
      ['selfSwitchIn', 'selfSwitchOut'].includes(definition.condition.type)) ||
    (damageStage &&
      (requiredCondition(definition.condition, 'selfBeDamaged') ||
        requiredCondition(definition.condition, 'selfUseSkill'))) ||
    (triggers.length === 1 &&
      ['OnMarkDestroy', 'OnMarkDurationEnd'].includes(triggers[0]) &&
      !('condition' in definition)) ||
    (triggers.length === 1 &&
      triggers[0] === 'BeforeMultiHit' &&
      requiredCondition(definition.condition, 'selfUseSkill')) ||
    (triggers.every(trigger => ['BeforeHit', 'OnHit', 'OnMiss'].includes(trigger)) &&
      (requiredCondition(definition.condition, 'selfUseSkill') ||
        requiredCondition(definition.condition, 'selfBeSkillTarget'))) ||
    (triggers.length === 1 &&
      triggers[0] === 'OnSwitchIn' &&
      fields(definition.condition, ['type']) &&
      definition.condition.type === 'selfSwitchIn') ||
    (triggers.length === 1 &&
      triggers[0] === 'OnBattleStart' &&
      (!('condition' in definition) ||
        (fields(definition.condition, ['type']) && definition.condition.type === 'petIsActive')))
  if (!triggers.length || new Set(triggers).size !== triggers.length || !supportedStage || !when)
    return { reason: 'unsupported condition/trigger combination' }
  const decisions = [
    ...(paths.length ? ['C07'] : []),
    ...(repaired.changes.length ? ['C09'] : []),
    ...(switchTargetRepairs.length ? ['C11'] : []),
    ...(/conditions\.(first|last)SkillThisTurn/.test(when) ? ['C08'] : []),
  ]
  return {
    ...(paths.length ? { selectorRepairs: paths } : {}),
    ...(switchTargetRepairs.length ? { switchTargetRepairs } : {}),
    ...(repaired.changes.length ? { pathRepairs: repaired.changes } : {}),
    id: definition.id,
    priority: definition.priority,
    ...(definition.tags ? { tags: [...definition.tags] } : {}),
    triggers,
    target: switchTarget ? 'switchIn' : action.target,
    when,
    ...(decisions.length ? { additionalDecisions: decisions } : {}),
    markId: action.mark.value,
    ...options,
    ...(parameters.length ? { parameters } : {}),
  }
}
const protectedIds = new Set([
  'effect_skill_add_mark_shuiwenpingzhang',
  'effect_mark_onDestroy_add_mark_shanghaizengjia',
])
export function renderMarkApplications(recipes, dependencies) {
  const entries = recipes.map(r => {
    const options = ['stack', 'duration'].flatMap(key =>
      `${key}Value` in r ? [`${key}: ${r[`${key}Value`]}`] : key in r ? [`${key}: ${JSON.stringify(r[key])}`] : [],
    )
    const params = r.parameters
      ?.map(
        p =>
          `${p.name}: numberParam({default: ${JSON.stringify(p.value)}, tags: ${JSON.stringify(p.tags ?? [])}, legacyAliases: ${JSON.stringify(p.configId ? [`${r.id}.${p.configId}`] : [])}})`,
      )
      .join(',')
    const compiled = `compileEffect(defineEffect({
      id: ${JSON.stringify(r.id)}, on: ${JSON.stringify(r.triggers)}, priority: ${r.priority}, ${params ? 'parameters,' : ''} ${r.tags ? `tags: ${JSON.stringify(r.tags)},` : ''} when: ${r.when},
      execute: ${r.target === 'switchIn' ? 'contexts.switchPet.select(event => event.switchInPet)' : r.target === 'battle' ? 'contexts.battle' : r.target === 'self' ? 'targets.ownerPet' : 'targets.opponentActive'}.apply(ops.addMark(resolved.get(${JSON.stringify(r.markId)})!${options.length ? `, {${options.join(',')}}` : ''})),
    }))`
    return `${JSON.stringify(r.id)}: ${params ? `(() => {const parameters = {${params}};return ${compiled}})()` : compiled}`
  })
  return `// Generated by scripts/effect-migration/mark-applications.mjs. Candidates only; no production registration.
import { BaseMark } from '../mark'
import { compileEffect, defineEffect, numberParam, conditions, targets, ops, values, checks, ${entries.some(entry => entry.includes('contexts.')) ? 'contexts,' : ''} type EffectFrame } from '../content/authoring'
export const generatedMarkApplicationDependencies = Object.freeze(${JSON.stringify(dependencies)})
export function createGeneratedMarkApplications(marks: ReadonlyMap<string, BaseMark>) {
  const resolved = new Map<string, BaseMark>()
  for (const id of generatedMarkApplicationDependencies) {
    const mark = marks.get(id)
    if (!(mark instanceof BaseMark) || mark.id !== id) throw new Error('Missing or mismatched native mark dependency: ' + id)
    resolved.set(id, mark)
  }
  return Object.freeze({${entries.join(',\n')}})
}
`
}
export async function generateMarkApplications({ check = false } = {}) {
  const marks = new Map()
  for (const name of ['mark', 'mark_global', 'mark_ability', 'mark_emblem']) {
    const sourceFile = `packs/base/data/${name}.yaml`
    for (const [index, definition] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (marks.has(definition.id)) throw new Error(`Duplicate mark: ${definition.id}`)
      marks.set(definition.id, { definition, sourceFile, sourcePath: `/${index}` })
    }
  }
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['effect_global', 'effect_ability', 'effect_emblem', 'effect_mark', 'effect_skill']) {
    const sourceFile = `packs/base/data/${name}.yaml`
    for (const [index, definition] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(definition.id)) throw new Error(`Duplicate effect: ${definition.id}`)
      seen.add(definition.id)
      if (definition.apply?.type !== 'addMark') continue
      const source = { id: definition.id, sourceFile, sourcePath: `/${index}`, definitionSha256: hash(definition) }
      const recipe = classifyMarkApplication(definition)
      if (recipe.reason) {
        rejected.push({ ...source, reason: recipe.reason })
        continue
      }
      const mark = marks.get(recipe.markId)
      if (!mark) {
        rejected.push({ ...source, reason: `Missing mark dependency: ${recipe.markId}` })
        continue
      }
      records.push({
        ...source,
        recipe,
        classification: 'U',
        status: protectedIds.has(recipe.id) ? 'handwritten-override-retained' : 'generated-candidate',
        dependency: {
          id: recipe.markId,
          sourceFile: mark.sourceFile,
          sourcePath: mark.sourcePath,
          definitionSha256: hash(mark.definition),
          effectIds: mark.definition.effect ?? mark.definition.effects ?? [],
        },
      })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const candidates = records.filter(record => record.status === 'generated-candidate')
  const dependencies = [...new Set(candidates.map(record => record.recipe.markId))].sort()
  const code = renderMarkApplications(
    candidates.map(record => record.recipe),
    dependencies,
  )
  for (const [path, raw] of [
    ['packages/battle/src/v4/official/mark-applications.generated.ts', code],
    [
      'docs/v4/validation/mark-applications-candidates.json',
      JSON.stringify(
        {
          formatVersion: 1,
          scope:
            'Fixed addMark application boundary; downstream mark effects are explicit dependencies and not claimed migrated.',
          records,
          rejected,
        },
        null,
        2,
      ),
    ],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    if (check) {
      if ((await readFile(path, 'utf8')) !== output) throw new Error(`Generated candidate drift: ${path}`)
    } else await writeFile(path, output)
  }
  return {
    generated: candidates.length,
    protected: records.length - candidates.length,
    dependencies: dependencies.length,
    rejected: rejected.length,
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check is supported')
  console.log(JSON.stringify(await generateMarkApplications({ check: process.argv.includes('--check') })))
}
