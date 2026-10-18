import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
const fields = (v, required, optional = []) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  required.every(k => Object.hasOwn(v, k)) &&
  Object.keys(v).every(k => [...required, ...optional].includes(k))
function normalize(v) {
  return Array.isArray(v)
    ? v.map(normalize)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, normalize(v[k])]),
        )
      : v
}
function condition(c, path = 'condition') {
  if (fields(c, ['type']) && c.type === 'selfUseSkill') return [{ kind: 'self', path }]
  if (fields(c, ['type', 'conditions']) && c.type === 'every' && Array.isArray(c.conditions) && c.conditions.length) {
    const children = c.conditions.map((v, i) => condition(v, `${path}/${i}`))
    return children.every(Boolean) ? children.flat() : undefined
  }
  if (!fields(c, ['type', 'target', 'evaluator']) || c.type !== 'evaluate' || c.target !== 'self') return
  const e = c.evaluator
  if (!fields(e, ['type', 'percent']) || e.type !== 'probability') return
  const p = e.percent
  if (Number.isFinite(p)) return [{ kind: 'probability', path, value: p }]
  if (
    !fields(p, ['type', 'value'], ['configId', 'tags']) ||
    p.type !== 'raw:number' ||
    !Number.isFinite(p.value) ||
    (p.configId !== undefined && (typeof p.configId !== 'string' || !p.configId)) ||
    (p.tags !== undefined && (!Array.isArray(p.tags) || !p.tags.every(t => typeof t === 'string')))
  )
    return
  return [
    {
      kind: 'probability',
      path,
      value: p.value,
      parameter: true,
      tags: p.tags ?? [],
      ...(p.configId ? { alias: p.configId } : {}),
    },
  ]
}
export function classifyStatStage(d) {
  if (
    !fields(d, ['id', 'trigger', 'priority', 'apply', 'condition']) ||
    typeof d.id !== 'string' ||
    !d.id ||
    !Number.isFinite(d.priority)
  )
    return { reason: 'unsupported definition fields' }
  const a = d.apply
  const target = typeof a?.target === 'string' ? a.target : fields(a?.target, ['base']) ? a.target.base : undefined
  if (
    !fields(a, ['type', 'target', 'statType', 'value']) ||
    a.type !== 'statStageBuff' ||
    !['self', 'opponent'].includes(target) ||
    !['atk', 'def', 'spa', 'spd', 'spe'].includes(a.statType) ||
    !Number.isFinite(a.value)
  )
    return { reason: 'requires literal stat/value and self/opponent target' }
  const triggers = Array.isArray(d.trigger) ? d.trigger : [d.trigger]
  const clauses = condition(d.condition)
  if (
    !triggers.length ||
    new Set(triggers).size !== triggers.length ||
    !triggers.every(t => ['BeforeHit', 'OnHit', 'OnMiss'].includes(t)) ||
    !clauses ||
    !clauses.some(c => c.kind === 'self')
  )
    return { reason: 'unsupported trigger or admission condition' }
  const aliases = clauses.filter(c => c.alias).map(c => c.alias)
  if (new Set(aliases).size !== aliases.length) return { reason: 'shared legacy aliases require explicit mapping' }
  return { id: d.id, priority: d.priority, triggers, target, stat: a.statType, value: a.value, clauses }
}
export async function generateStatStages({ check = false } = {}) {
  const records = [],
    rejected = [],
    seen = new Set()
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [i, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (seen.has(d.id)) throw new Error(`Duplicate effect ${d.id}`)
      seen.add(d.id)
      if (d.apply?.type !== 'statStageBuff') continue
      const source = {
        id: d.id,
        sourceFile,
        sourcePath: `/${i}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(d)))
          .digest('hex'),
      }
      const recipe = classifyStatStage(d)
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else records.push({ ...source, recipe, classification: 'U' })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  rejected.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const parameters = [],
    entries = []
  for (const { recipe: r } of records) {
    const expressions = r.clauses.map(c => {
      if (c.kind === 'self') return 'selfUsesSkill(context)'
      let value = String(c.value)
      if (c.parameter) {
        const name = `p${parameters.length}`
        parameters.push(
          `const ${name} = defineParameter({address:parameterAddress(${JSON.stringify(r.id)},${JSON.stringify(c.path)},'percent'),schema:Type.Number({default:${c.value}}),effectiveSchema:Type.Number(),operations:[ConfigModifierType.delta,ConfigModifierType.override],tags:${JSON.stringify(c.tags)},aliases:${JSON.stringify(c.alias ? [`${r.id}.${c.alias}`] : [])}})`,
        )
        value = `parameters.read(context.battle.configSystem, ${name}, context.source)`
      }
      return `roll(context, ${value})`
    })
    entries.push(
      `${JSON.stringify(r.id)}: defineNativeEffect({id:${JSON.stringify(r.id)} as effectId,priority:${r.priority},triggers:[${r.triggers.map(t => `EffectTrigger.${t}`).join(',')}],when(context) {return ${expressions.join(' && ')}},apply(context) {const owner=context.source.owner; if(!(owner instanceof Pet)) return; const target=${r.target === 'self' ? 'owner' : 'context.battle.getOpponent(owner.owner!).activePet'};target.addStatStage(context,StatTypeWithoutHp.${r.stat},${r.value})}})`,
    )
  }
  const code = `// Generated by scripts/effect-migration/stat-stages.mjs. Candidates only.
import {Type} from '@sinclair/typebox'
import {EffectTrigger,StatTypeWithoutHp,type effectId} from '@arcadia-eternity/const'
import {UseSkillContext,type EffectContext} from '../context'
import {Pet} from '../pet'
import {SkillInstance} from '../skill'
import {MarkInstanceImpl} from '../mark'
import {ConfigModifierType} from '../config'
import {defineNativeEffect} from '../content/native-effect'
import {defineParameter,parameterAddress,ParameterCatalog} from '../content/parameters'
function selfUsesSkill(context: EffectContext<EffectTrigger>) {return context.parent instanceof UseSkillContext && context.source.owner===context.parent.pet && (context.source instanceof SkillInstance ? context.source===context.parent.skill : context.source instanceof MarkInstanceImpl)}
function roll(context: EffectContext<EffectTrigger>, percent: number) {return context.battle.random() < percent / 100}
${parameters.join('\n')}
const parameters=new ParameterCatalog([${parameters.map((_, i) => `p${i}`).join(',')}])
export const generatedStatStageCandidates=Object.freeze({parameters,effects:Object.freeze({${entries.join(',\n')}})})
`
  for (const [path, raw] of [
    ['packages/battle/src/v4/official/stat-stages.generated.ts', code],
    [
      'docs/v4/validation/stat-stages-candidates.json',
      JSON.stringify({ formatVersion: 1, records, rejected }, null, 2),
    ],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    if (check) {
      if ((await readFile(path, 'utf8')) !== output) throw new Error(`Generated drift: ${path}`)
    } else await writeFile(path, output)
  }
  return { generated: records.length, parameters: parameters.length, rejected: rejected.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateStatStages({ check: process.argv.includes('--check') })))
}
