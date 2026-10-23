import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeMigrationArtifact } from './artifacts.mjs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { fields, normalize, condition, selectedNumber } from './authoring-emitter.mjs'

// Emit all values: critical rate consumes each; accuracy consumes only the first.
function outcomeValues(value, parameters, path = 'amount') {
  if (Number.isFinite(value)) return JSON.stringify([value])
  if (fields(value, ['type', 'selector']) && value.type === 'dynamic')
    return selectedNumber(value.selector, parameters, path, 'all', 'skill')
}

import { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'
export { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'

const firstSkillIds = new Set([
  'effect_emblem_xianzhi_crit_rate_5_percent_if_first',
  'effect_skill_add_crit_rate_50_if_first',
  'effect_skill_add_crit_rate_65_if_first',
  'effect_skill_crit_if_first',
  'effect_skill_sure_hit_if_first',
])
function orderNodes(value, path = '') {
  if (!value || typeof value !== 'object') return []
  return [
    ...(['isFirstSkillUsedThisTurn', 'isLastSkillUsedThisTurn'].includes(value.type)
      ? [{ path, type: value.type }]
      : []),
    ...Object.entries(value).flatMap(([key, child]) => orderNodes(child, `${path}/${key}`)),
  ]
}
export function classifySkillOutcome(original) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) return { reason: 'invalid definition' }
  const { definition: spelling, paths } = repairSkillSelector(original)
  const repaired = repairSkillPaths(spelling)
  if (repaired.reason) return repaired
  const d = repaired.definition
  if (
    !fields(d, [
      'id',
      'trigger',
      'priority',
      ...('condition' in d ? ['condition'] : []),
      'apply',
      ...['tags', 'consumesStacks'].filter(k => Object.hasOwn(d, k)),
    ]) ||
    typeof d.id !== 'string' ||
    !d.id ||
    !Number.isFinite(d.priority)
  )
    return { reason: 'unsupported definition fields' }
  if (!['BeforeUseSkillCheck', 'AfterUseSkillCheck', 'BeforeHit'].includes(d.trigger))
    return { reason: 'unsupported skill stage' }
  if ('consumesStacks' in d && (!Number.isSafeInteger(d.consumesStacks) || d.consumesStacks < 0))
    return { reason: 'invalid stack consumption' }
  if ('tags' in d && (!Array.isArray(d.tags) || !d.tags.every(x => typeof x === 'string')))
    return { reason: 'invalid tags' }
  const a = d.apply
  const override = ['setSureHit', 'setSureMiss', 'setSureCrit'].includes(a?.type)
  if (
    !fields(a, ['type', 'target', override ? 'priority' : 'value']) ||
    !['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit'].includes(a.type)
  )
    return { reason: 'unsupported outcome action' }
  if (a.target !== 'usingSkillContext' && !(fields(a.target, ['base']) && a.target.base === 'usingSkillContext'))
    return { reason: 'unsupported target chain' }
  const parameters = []
  const amount = Number.isFinite(override ? a.priority : a.value) ? (override ? a.priority : a.value) : undefined
  const value = !override && amount === undefined ? outcomeValues(a.value, parameters) : undefined
  if (amount === undefined && !value) return { reason: 'unsupported outcome value' }
  const order = orderNodes(d)
  const expectedOrder = firstSkillIds.has(d.id)
    ? [{ path: '/condition/conditions/1', type: 'isFirstSkillUsedThisTurn' }]
    : []
  if (JSON.stringify(order) !== JSON.stringify(expectedOrder))
    return { reason: 'turn-order correction source nodes changed or unmapped' }
  const when =
    'condition' in d
      ? condition(d.condition, 'skill', parameters, 'condition', {
          eventOwnership: true,
          collectionCompare: true,
          defensiveSkill: true,
        })
      : '() => true'
  if (!when) return { reason: 'condition needs a separate mapping' }
  return {
    id: d.id,
    trigger: d.trigger,
    priority: d.priority,
    operation: a.type,
    ...(amount !== undefined ? { amount } : { value }),
    when,
    ...(parameters.length ? { parameters } : {}),
    repairedPaths: paths,
    ...(order.length ? { orderConditions: order } : {}),
    ...(repaired.changes.length ? { pathRepairs: repaired.changes } : {}),
    ...('consumesStacks' in d ? { consumesStacks: d.consumesStacks } : {}),
    ...('tags' in d ? { tags: d.tags } : {}),
  }
}
export async function generateSkillOutcome({ check = false } = {}) {
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [index, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(d.id)) throw new Error(`Duplicate effect ${d.id}`)
      seen.add(d.id)
      if (!['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit'].includes(d.apply?.type)) continue
      const source = {
        id: d.id,
        sourceFile,
        sourcePath: `/${index}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(d)))
          .digest('hex'),
      }
      const recipe = classifySkillOutcome(d)
      const additionalDecisions = [
        ...(/conditions\.(firstSkillThisTurn|lastSkillThisTurn)/.test(recipe.when ?? '') ? ['C08'] : []),
        ...(recipe.pathRepairs ? ['C09'] : []),
      ]
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else
        records.push({
          ...source,
          recipe,
          classification: 'U',
          decision: 'C07',
          ...(additionalDecisions.length ? { additionalDecisions } : {}),
          status: 'generated-correction-candidate',
        })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const q = JSON.stringify
  const entries = records.map(({ recipe: r }) => {
    const params = r.parameters
      ?.map(
        p =>
          `${p.name}:numberParam({default:${q(p.value)},tags:${q(p.tags ?? [])},legacyAliases:${q(p.configId ? [`${r.id}.${p.configId}`] : [])}})`,
      )
      .join(',')
    const compiled = `compileEffect(defineEffect({id:${q(r.id)},on:${q(r.trigger)},priority:${r.priority},${r.consumesStacks !== undefined ? `consumesStacks:${r.consumesStacks},` : ''}${r.tags ? `tags:${q(r.tags)},` : ''}${params ? 'parameters,' : ''}when:${r.when},execute:contexts.skillUse.apply(ops.${r.operation}(${r.value ?? r.amount}))}))`
    return `${q(r.id)}:${params ? `(()=>{const parameters={${params}};return ${compiled}})()` : compiled}`
  })
  const imports = [
    'compileEffect',
    'defineEffect',
    'numberParam',
    'conditions',
    'contexts',
    'targets',
    'checks',
    'ops',
    'values',
  ].filter(name => entries.some(entry => entry.includes(`${name}(`) || entry.includes(`${name}.`)))
  if (entries.some(entry => entry.includes(': EffectFrame'))) imports.push('type EffectFrame')
  const code = `// Generated by scripts/effect-migration/skill-outcomes.mjs. C07 correction candidates only.\nimport {${imports.join(',')}} from '@arcadia-eternity/battle/v4/authoring'\nexport function createGeneratedSkillOutcomeEffects(){return Object.freeze({${entries.join(',\n')}})}\nexport const generatedSkillOutcomeEffects=createGeneratedSkillOutcomeEffects()\n`
  for (const [path, raw] of [
    ['packs/base/src/effects/skill-outcomes.generated.ts', code],
    ['docs/v4/validation/skill-outcomes-candidates.json', JSON.stringify({ formatVersion: 1, records, rejected })],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    await writeMigrationArtifact(path, output, { check })
  }
  return { generated: records.length, rejected: rejected.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillOutcome({ check: process.argv.includes('--check') })))
}
