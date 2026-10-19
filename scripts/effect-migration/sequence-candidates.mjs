import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { fields, normalize, condition } from './authoring-emitter.mjs'
import { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'
import { sequenceAction } from './sequence-actions.mjs'
export function classifySequence(original, profile) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) return { reason: 'invalid definition' }
  const { definition: spelling, paths } = repairSkillSelector(original)
  const repaired = repairSkillPaths(spelling)
  if (repaired.reason) return repaired
  const d = repaired.definition
  const valueRepairs = []
  if (d.id === 'effect_skill_raise_atk_1_stage_and_other_1_stage') {
    const node = d.apply?.[1]?.statType
    if (node?.type !== 'selectorValue') return { reason: 'C10 source node changed: /apply/1/statType/type' }
    node.type = 'selector'
    valueRepairs.push({ path: '/apply/1/statType/type', before: 'selectorValue', after: 'selector' })
  }
  if (
    !fields(d, [
      'id',
      'trigger',
      'priority',
      'condition',
      'apply',
      ...['tags', 'consumesStacks'].filter(k => Object.hasOwn(d, k)),
    ]) ||
    typeof d.id !== 'string' ||
    !d.id ||
    !Number.isFinite(d.priority)
  )
    return { reason: 'unsupported definition fields' }
  if (!profile.triggers.includes(d.trigger)) return { reason: 'unsupported trigger' }
  if (!Array.isArray(d.apply) || !d.apply.length || !d.apply.some(a => profile.actionTypes.includes(a?.type)))
    return { reason: 'requires a supported action list' }
  if (d.apply.some(a => profile.excludeActionTypes?.includes(a?.type)))
    return { reason: 'action list belongs to another sequence catalog' }
  if ('consumesStacks' in d && (!Number.isSafeInteger(d.consumesStacks) || d.consumesStacks < 0))
    return { reason: 'invalid stack consumption' }
  if ('tags' in d && (!Array.isArray(d.tags) || !d.tags.every(x => typeof x === 'string')))
    return { reason: 'invalid tags' }
  if (/isFirstSkillUsedThisTurn|isLastSkillUsedThisTurn/.test(JSON.stringify(d)))
    return { reason: 'order correction needs a source mapping' }
  const domain = profile.domain ?? (d.trigger === 'OnDamage' ? 'damage' : 'skill')
  const parameters = []
  const when = condition(d.condition, domain, parameters, 'condition', {
    eventOwnership: true,
    collectionCompare: true,
    defensiveSkill: true,
    skillCategory: true,
  })
  if (!when || parameters.length) return { reason: 'condition needs a separate mapping' }
  const actions = d.apply.map((a, i) => ({
    sourcePath: `/apply/${i}`,
    code: sequenceAction(a, d.trigger, domain, parameters, `action${i}_value`),
  }))
  if (parameters.length && !profile.parameters) return { reason: 'action parameters need a separate mapping' }
  if (actions.some(a => !a.code)) return { reason: 'unsupported sequence action or parameter' }
  return {
    id: d.id,
    trigger: d.trigger,
    priority: d.priority,
    when,
    actions,
    ...(parameters.length ? { parameters } : {}),
    repairedPaths: paths,
    ...(valueRepairs.length ? { valueRepairs } : {}),
    ...(repaired.changes.length ? { pathRepairs: repaired.changes } : {}),
    ...('consumesStacks' in d ? { consumesStacks: d.consumesStacks } : {}),
    ...('tags' in d ? { tags: d.tags } : {}),
  }
}
export async function generateSequences(profile, { check = false } = {}) {
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [index, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(d.id)) throw new Error(`Duplicate effect ${d.id}`)
      seen.add(d.id)
      if (!Array.isArray(d.apply) || !d.apply.some(a => profile.actionTypes.includes(a?.type))) continue
      if (d.apply.some(a => profile.excludeActionTypes?.includes(a?.type))) continue
      const source = {
        id: d.id,
        sourceFile,
        sourcePath: `/${index}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(d)))
          .digest('hex'),
      }
      const recipe = classifySequence(d, profile)
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else
        records.push({
          ...source,
          recipe,
          classification: 'U',
          ...(recipe.repairedPaths.length ? { decision: 'C07' } : {}),
          ...(recipe.pathRepairs || recipe.valueRepairs
            ? { additionalDecisions: [...(recipe.pathRepairs ? ['C09'] : []), ...(recipe.valueRepairs ? ['C10'] : [])] }
            : {}),
          status:
            recipe.repairedPaths.length || recipe.pathRepairs || recipe.valueRepairs
              ? 'generated-correction-candidate'
              : 'generated-candidate',
        })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const entries = records.map(({ recipe: r }) => {
    const params = r.parameters
      ?.map(
        p =>
          `${p.name}:numberParam({default:${JSON.stringify(p.value)},tags:${JSON.stringify(p.tags ?? [])},legacyAliases:${JSON.stringify(p.configId ? [`${r.id}.${p.configId}`] : [])}})`,
      )
      .join(',')
    const compiled = `compileEffect(defineEffect({id:${JSON.stringify(r.id)},on:${JSON.stringify(r.trigger)},priority:${r.priority},${r.consumesStacks !== undefined ? `consumesStacks:${r.consumesStacks},` : ''}${r.tags ? `tags:${JSON.stringify(r.tags)},` : ''}${params ? 'parameters,' : ''}when:${r.when},execute:actions.sequence(${r.actions.map(a => a.code).join(',')})}))`
    return `${JSON.stringify(r.id)}:${params ? `(()=>{const parameters={${params}};return ${compiled}})()` : compiled}`
  })
  const imports = [
    'selectFrom',
    'numberParam',
    'compileEffect',
    'defineEffect',
    'conditions',
    'contexts',
    'targets',
    'checks',
    'ops',
    'actions',
    'values',
  ].filter(name => entries.some(e => e.includes(`${name}(`) || e.includes(`${name}.`)))
  if (entries.some(e => e.includes(': EffectFrame'))) imports.push('type EffectFrame')
  const code = `// Generated by scripts/effect-migration/${profile.slug}.mjs. ${profile.comment}\nimport {${imports.join(',')}} from '../content/authoring'\nexport function ${profile.factory}(){return Object.freeze({${entries.join(',\n')}})}\nexport const ${profile.exportName}=${profile.factory}()\n`
  for (const [path, raw] of [
    [`packages/battle/src/v4/official/${profile.slug}.generated.ts`, code],
    [`docs/v4/validation/${profile.slug}-candidates.json`, JSON.stringify({ formatVersion: 1, records, rejected })],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    if (check) {
      if ((await readFile(path, 'utf8')) !== output) throw new Error(`Generated drift: ${path}`)
    } else await writeFile(path, output)
  }
  return { generated: records.length, rejected: rejected.length }
}
