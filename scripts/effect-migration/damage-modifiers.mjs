import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'

import { fields, normalize, number, condition } from './authoring-emitter.mjs'
import { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'
import { turnOrderReferences } from './turn-order.mjs'
const orderMappings = {
  effect_ability_damage_boost_10_percent_when_first: ['/condition/conditions/1', 'isFirstSkillUsedThisTurn'],
  effect_ability_damage_reduction_10_percent_when_last: [
    '/condition/conditions/1/condition',
    'isLastSkillUsedThisTurn',
  ],
  effect_skill_damage_increase_30_percent_if_first: ['/condition/conditions/1', 'isFirstSkillUsedThisTurn'],
  effect_skill_damage_increase_30_percent_if_last: ['/condition/conditions/1', 'isLastSkillUsedThisTurn'],
  effect_skill_add_fixed_damage_50_if_first: ['/condition/conditions/1', 'isFirstSkillUsedThisTurn'],
  effect_skill_add_fixed_damage_50_if_last: ['/condition/conditions/1', 'isLastSkillUsedThisTurn'],
  effect_skill_add_damage_50_percent_if_last: ['/condition/conditions/1', 'isLastSkillUsedThisTurn'],
}
const q = JSON.stringify
export function classifyDamageModifier(original) {
  const { definition: spelling, paths } = repairSkillSelector(original)
  if (!spelling || typeof spelling !== 'object' || Array.isArray(spelling))
    return { reason: 'unsupported definition fields' }
  const repaired = repairSkillPaths(spelling)
  if (repaired.reason) return repaired
  const d = repaired.definition
  if (!d || typeof d !== 'object' || Array.isArray(d)) return { reason: 'unsupported definition fields' }
  if (
    !fields(d, [
      'id',
      'trigger',
      'priority',
      'condition',
      'apply',
      ...['consumesStacks', 'tags'].filter(k => Object.hasOwn(d, k)),
    ]) ||
    typeof d.id !== 'string' ||
    !d.id ||
    !Number.isFinite(d.priority)
  )
    return { reason: 'unsupported definition fields' }
  if ('consumesStacks' in d && (!Number.isSafeInteger(d.consumesStacks) || d.consumesStacks < 0))
    return { reason: 'invalid stack consumption' }
  if ('tags' in d && (!Array.isArray(d.tags) || !d.tags.every(t => typeof t === 'string')))
    return { reason: 'invalid effect tags' }
  const triggers = Array.isArray(d.trigger) ? d.trigger : [d.trigger]
  if (
    !triggers.length ||
    new Set(triggers).size !== triggers.length ||
    !triggers.every(t => ['OnBeforeCalculateDamage', 'OnDamage'].includes(t))
  )
    return { reason: 'requires a supported damage stage' }
  const a = d.apply
  if (
    !fields(a, ['type', 'target', 'percent', 'delta']) ||
    a.type !== 'addModified' ||
    !(a.target === 'damageContext' || (fields(a.target, ['base']) && a.target.base === 'damageContext'))
  )
    return { reason: 'requires an unchained damage-context target' }
  const orderConditions = turnOrderReferences(d)
  const mapping = orderMappings[d.id]
  const expectedOrder = mapping ? [{ path: mapping[0], condition: mapping[1] }] : []
  if (JSON.stringify(orderConditions) !== JSON.stringify(expectedOrder))
    return { reason: 'order correction needs an exact source mapping' }
  const parameters = []
  const when = condition(d.condition, 'damage', undefined, 'condition', { turnOrder: !!mapping }),
    percent = number(a.percent, parameters, 'percent'),
    delta = number(a.delta, parameters, 'delta')
  if (!when) return { reason: 'condition requires a separate semantic mapping' }
  if (!percent || !delta) return { reason: 'numeric value or parameter requires a separate semantic mapping' }
  return {
    id: d.id,
    ...(paths.length ? { selectorRepairs: paths } : {}),
    ...(orderConditions.length ? { orderConditions } : {}),
    ...(repaired.changes.length ? { pathRepairs: repaired.changes } : {}),
    ...(paths.length || orderConditions.length || repaired.changes.length
      ? {
          additionalDecisions: [
            ...(paths.length ? ['C07'] : []),
            ...(orderConditions.length ? ['C08'] : []),
            ...(repaired.changes.length ? ['C09'] : []),
          ],
        }
      : {}),
    priority: d.priority,
    triggers,
    when,
    percent: percent.code,
    delta: delta.code,
    ...(parameters.length ? { parameters } : {}),
    ...('consumesStacks' in d ? { consumesStacks: d.consumesStacks } : {}),
    ...('tags' in d ? { tags: [...d.tags] } : {}),
  }
}
const protectedIds = new Set(['effect_mark_damage_boost_based_on_hp_percentage'])
export async function generateDamageModifiers({ check = false } = {}) {
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [i, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(d.id)) throw new Error(`Duplicate effect ${d.id}`)
      seen.add(d.id)
      if (d.apply?.type !== 'addModified') continue
      const source = {
        id: d.id,
        sourceFile,
        sourcePath: `/${i}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(d)))
          .digest('hex'),
      }
      if (protectedIds.has(d.id)) {
        records.push({ ...source, recipe: null, classification: 'U', status: 'handwritten-override-retained' })
        continue
      }
      const recipe = classifyDamageModifier(d)
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else
        records.push({
          ...source,
          recipe,
          classification: 'U',
          status: 'generated-candidate',
        })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const entries = records
    .filter(r => r.status === 'generated-candidate')
    .map(({ recipe: r }) => {
      const params = r.parameters
        ?.map(
          p =>
            `${p.name}:numberParam({default:${q(p.value)},tags:${q(p.tags ?? [])},legacyAliases:${q(p.configId ? [`${r.id}.${p.configId}`] : [])}})`,
        )
        .join(',')
      const compiled = `compileEffect(defineEffect({id:${q(r.id)},on:${q(r.triggers)},priority:${r.priority},${r.consumesStacks !== undefined ? `consumesStacks:${r.consumesStacks},` : ''}${r.tags ? `tags:${q(r.tags)},` : ''}${params ? 'parameters,' : ''}when:${r.when},execute:contexts.damage.apply(ops.modifyDamage({percent:${r.percent},delta:${r.delta}}))}))`
      return `${q(r.id)}:${params ? `(()=>{const parameters={${params}};return ${compiled}})()` : compiled}`
    })
  const code = `// Generated by scripts/effect-migration/damage-modifiers.mjs. Candidates only.
import {compileEffect,defineEffect,numberParam,conditions,contexts,targets,checks,ops,values,type EffectFrame} from '../content/authoring'
export function createGeneratedDamageModifierEffects(){return Object.freeze({${entries.join(',\n')}})}
export const generatedDamageModifierEffects=createGeneratedDamageModifierEffects()
`
  for (const [path, raw] of [
    ['packages/battle/src/v4/official/damage-modifiers.generated.ts', code],
    [
      'docs/v4/validation/damage-modifiers-candidates.json',
      JSON.stringify({ formatVersion: 1, records, rejected }, null, 2),
    ],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    if (check) {
      if ((await readFile(path, 'utf8')) !== output) throw new Error(`Generated drift: ${path}`)
    } else await writeFile(path, output)
  }
  return { generated: entries.length, protected: records.length - entries.length, rejected: rejected.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateDamageModifiers({ check: process.argv.includes('--check') })))
}
