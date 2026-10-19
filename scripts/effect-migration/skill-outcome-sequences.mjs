import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { fields, normalize, condition, members } from './authoring-emitter.mjs'
import { repairSkillSelector, repairSkillPaths } from './skill-context-corrections.mjs'
import { classifySkillOutcome } from './skill-outcomes.mjs'
import { classifySkillPower } from './skill-power.mjs'
const outcomeTypes = ['addAccuracy', 'addCritRate', 'setSureHit', 'setSureMiss', 'setSureCrit']
const skillActionTypes = [...outcomeTypes, 'addPower', 'amplifyPower']
function action(a, trigger) {
  if (a?.value?.type === 'conditional') return
  if (skillActionTypes.includes(a?.type)) {
    const classifier = outcomeTypes.includes(a.type) ? classifySkillOutcome : classifySkillPower
    const recipe = classifier({ id: 'sequence-node', trigger, priority: 0, apply: a })
    if (recipe.reason || recipe.parameters?.length) return
    return `contexts.skillUse.apply(ops.${recipe.operation}(${recipe.value ?? recipe.amount}))`
  }
  if (!['consumeStacks', 'destroyMark'].includes(a?.type)) return
  if (!fields(a, ['type', 'target', ...(a.type === 'consumeStacks' ? ['value'] : [])])) return
  const target =
    a.target === 'mark' || (fields(a.target, ['base']) && a.target.base === 'mark')
      ? 'targets.sourceMark'
      : members(a.target, 'skill')
  if (!target) return
  if (a.type === 'destroyMark') return `${target}.apply(ops.removeMark())`
  if (!Number.isFinite(a.value)) return
  return `${target}.apply(ops.consumeStacks(${JSON.stringify(a.value)}))`
}
export function classifySkillOutcomeSequence(original) {
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
      'condition',
      'apply',
      ...['tags', 'consumesStacks'].filter(k => Object.hasOwn(d, k)),
    ]) ||
    typeof d.id !== 'string' ||
    !d.id ||
    !Number.isFinite(d.priority)
  )
    return { reason: 'unsupported definition fields' }
  if (!['BeforeUseSkillCheck', 'AfterUseSkillCheck', 'BeforeHit'].includes(d.trigger))
    return { reason: 'unsupported trigger' }
  if (!Array.isArray(d.apply) || !d.apply.length || !d.apply.some(a => skillActionTypes.includes(a?.type)))
    return { reason: 'requires a skill outcome or power action list' }
  if ('consumesStacks' in d && (!Number.isSafeInteger(d.consumesStacks) || d.consumesStacks < 0))
    return { reason: 'invalid stack consumption' }
  if ('tags' in d && (!Array.isArray(d.tags) || !d.tags.every(x => typeof x === 'string')))
    return { reason: 'invalid tags' }
  if (/isFirstSkillUsedThisTurn|isLastSkillUsedThisTurn/.test(JSON.stringify(d)))
    return { reason: 'order correction needs a source mapping' }
  const parameters = []
  const when = condition(d.condition, 'skill', parameters, 'condition', {
    eventOwnership: true,
    collectionCompare: true,
    defensiveSkill: true,
    skillCategory: true,
  })
  if (!when || parameters.length) return { reason: 'condition needs a separate mapping' }
  const actions = d.apply.map((a, i) => ({ sourcePath: `/apply/${i}`, code: action(a, d.trigger) }))
  if (actions.some(a => !a.code)) return { reason: 'unsupported sequence action or parameter' }
  return {
    id: d.id,
    trigger: d.trigger,
    priority: d.priority,
    when,
    actions,
    repairedPaths: paths,
    ...(repaired.changes.length ? { pathRepairs: repaired.changes } : {}),
    ...('consumesStacks' in d ? { consumesStacks: d.consumesStacks } : {}),
    ...('tags' in d ? { tags: d.tags } : {}),
  }
}
export async function generateSkillOutcomeSequences({ check = false } = {}) {
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [index, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(d.id)) throw new Error(`Duplicate effect ${d.id}`)
      seen.add(d.id)
      if (!Array.isArray(d.apply) || !d.apply.some(a => skillActionTypes.includes(a?.type))) continue
      const source = {
        id: d.id,
        sourceFile,
        sourcePath: `/${index}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(d)))
          .digest('hex'),
      }
      const recipe = classifySkillOutcomeSequence(d)
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else
        records.push({
          ...source,
          recipe,
          classification: 'U',
          decision: 'C07',
          ...(recipe.pathRepairs ? { additionalDecisions: ['C09'] } : {}),
          status: 'generated-correction-candidate',
        })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const entries = records.map(
    ({ recipe: r }) =>
      `${JSON.stringify(r.id)}:compileEffect(defineEffect({id:${JSON.stringify(r.id)},on:${JSON.stringify(r.trigger)},priority:${r.priority},${r.consumesStacks !== undefined ? `consumesStacks:${r.consumesStacks},` : ''}${r.tags ? `tags:${JSON.stringify(r.tags)},` : ''}when:${r.when},execute:actions.sequence(${r.actions.map(a => a.code).join(',')})}))`,
  )
  const imports = [
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
  const code = `// Generated by scripts/effect-migration/skill-outcome-sequences.mjs. Explicit C07/C09 candidates.\nimport {${imports.join(',')}} from '../content/authoring'\nexport function createGeneratedSkillOutcomeSequences(){return Object.freeze({${entries.join(',\n')}})}\nexport const generatedSkillOutcomeSequences=createGeneratedSkillOutcomeSequences()\n`
  for (const [path, raw] of [
    ['packages/battle/src/v4/official/skill-outcome-sequences.generated.ts', code],
    [
      'docs/v4/validation/skill-outcome-sequences-candidates.json',
      JSON.stringify({ formatVersion: 1, records, rejected }),
    ],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    if (check) {
      if ((await readFile(path, 'utf8')) !== output) throw new Error(`Generated drift: ${path}`)
    } else await writeFile(path, output)
  }
  return { generated: records.length, rejected: rejected.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateSkillOutcomeSequences({ check: process.argv.includes('--check') })))
}
