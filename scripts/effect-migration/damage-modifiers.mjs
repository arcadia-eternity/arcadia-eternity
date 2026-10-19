import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'

const fields = (v, keys) =>
  v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).sort().join(',') === [...keys].sort().join(',')
const q = JSON.stringify
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
function root(s) {
  if (s === 'self') return 'targets.ownerPet'
  if (s === 'opponent') return 'targets.opponentActive'
  if (s === 'mark') return 'targets.sourceMark'
  if (s === 'selfMarks') return 'targets.ownerMarks'
}
function markFilter(step) {
  if (!fields(step, ['type', 'extractor', 'evaluator']) || step.type !== 'whereAttr') return
  const { extractor: e, evaluator: v } = step
  if (
    fields(e, ['type', 'arg']) &&
    e.type === 'base' &&
    e.arg === 'baseId' &&
    fields(v, ['type', 'value']) &&
    v.type === 'same' &&
    typeof v.value === 'string'
  )
    return `mark => mark.baseId === ${q(v.value)}`
  if (
    fields(e, ['type', 'arg']) &&
    e.type === 'base' &&
    e.arg === 'tags' &&
    fields(v, ['type', 'tag']) &&
    v.type === 'contain' &&
    typeof v.tag === 'string'
  )
    return `mark => mark.tags.includes(${q(v.tag)})`
}
function members(s) {
  if (!fields(s, ['base', 'chain']) || s.base !== 'selfMarks' || !Array.isArray(s.chain)) return
  let code = root(s.base)
  for (const step of s.chain) {
    const filter = markFilter(step)
    if (!filter) return
    code += `.where(${filter})`
  }
  return code
}
/** Static TS emitter for explicitly understood numeric steps; no runtime interpreter is emitted. */
function selectedNumber(s, parameters, path) {
  if (!fields(s, ['base', 'chain']) || !Array.isArray(s.chain)) return
  let code = root(s.base),
    numeric = false
  if (!code) return
  for (const [index, step] of s.chain.entries()) {
    if (!numeric && s.base === 'selfMarks') {
      const filter = markFilter(step)
      if (filter) {
        code += `.where(${filter})`
        continue
      }
    }
    if (!fields(step, ['type', 'arg'])) return
    if (!numeric) {
      const e = step.arg
      let name
      if (step.type === 'select' && fields(e, ['type', 'arg']) && e.type === 'base') name = e.arg
      else if (
        step.type === 'select' &&
        fields(e, ['type', 'arg']) &&
        e.type === 'dynamic' &&
        e.arg === 'lastSkillUsedTimes'
      )
        name = e.arg
      else if (step.type === 'selectPath' && step.arg === 'stack') name = step.arg
      if (['mark', 'selfMarks'].includes(s.base) && name === 'stack') code += '.select(mark => mark.stack).first()'
      else if (['self', 'opponent'].includes(s.base) && ['currentHp', 'maxHp', 'lastSkillUsedTimes'].includes(name))
        code += `.select(pet => pet.${name === 'maxHp' ? 'stat.maxHp' : name}).first()`
      else return
      numeric = true
    } else {
      const parameter = !Number.isFinite(step.arg)
        ? rawParameter(step.arg, parameters, `${path}_step${index}`)
        : undefined
      if (!Number.isFinite(step.arg) && !parameter) return
      // A configured divisor may become zero. Keep it out until the zero contract is mapped.
      if (parameter && step.type === 'divide') return
      const n = parameter ? 'factor' : q(step.arg)
      const expression = {
        multiply: `Math.floor(n * ${n})`,
        divide: `Math.floor(n / ${n})`,
        add: `n + ${n}`,
        clampMin: `Math.max(n, ${n})`,
        clampMax: `Math.min(n, ${n})`,
      }[step.type]
      if (!expression || (step.type === 'divide' && step.arg === 0)) return
      code = parameter
        ? `values.combine(${code},${parameter.code},(n,factor) => ${expression})`
        : `${code}.map(n => ${expression})`
    }
  }
  return numeric ? code : undefined
}
function rawParameter(v, parameters, name) {
  if (!parameters || !v || typeof v !== 'object' || v.type !== 'raw:number') return
  if (!Object.keys(v).every(k => ['type', 'value', 'configId', 'tags'].includes(k)) || !Number.isFinite(v.value)) return
  if ('configId' in v && (typeof v.configId !== 'string' || !v.configId)) return
  if ('tags' in v && (!Array.isArray(v.tags) || !v.tags.every(t => typeof t === 'string'))) return
  // Repeated legacy aliases share configuration, so reject them pending an explicit shared declaration mapping.
  if (v.configId && parameters.some(p => p.configId === v.configId)) return
  parameters.push({
    name,
    value: v.value,
    ...(v.configId ? { configId: v.configId } : {}),
    ...(v.tags ? { tags: [...v.tags] } : {}),
  })
  return { code: `parameters.${name}`, literal: false, required: true }
}
function number(v, parameters, path) {
  if (Number.isFinite(v)) return { code: q(v), literal: true }
  if (v?.type === 'raw:number') return rawParameter(v, parameters, path)
  if (fields(v, ['type', 'selector']) && v.type === 'dynamic') {
    const code = selectedNumber(v.selector, parameters, path)
    if (code) return { code, literal: false }
  }
  if (fields(v, ['type', 'condition', 'trueValue', 'falseValue']) && v.type === 'conditional') {
    // Legacy parsing treats a falsy false branch as absent, not numeric zero.
    if (!v.falseValue) return
    const c = condition(v.condition),
      yes = number(v.trueValue),
      no = number(v.falseValue)
    // Keep optional-valued branches out until the public choose contract explicitly supports them.
    if (c && yes?.literal && no?.literal)
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
    if (c && yes && no && (yes.literal || yes.required) && (no.literal || no.required))
      return { code: `values.choose(${c},${yes.code},${no.code})`, literal: false, required: true }
  }
}
function condition(c) {
  if (fields(c, ['type'])) {
    if (c.type === 'selfUseSkill') return 'conditions.selfUsesSkill'
    // This emitter accepts only the two DamageContext stages, where checkSelf is target ownership.
    if (c.type === 'selfBeDamaged' || c.type === 'checkSelf') return 'conditions.selfBeDamaged'
  }
  if (
    fields(c, ['type', 'conditions']) &&
    ['every', 'some'].includes(c.type) &&
    Array.isArray(c.conditions) &&
    c.conditions.length
  ) {
    const items = c.conditions.map(condition)
    if (items.every(Boolean)) return `conditions.${c.type === 'every' ? 'all' : 'any'}(${items.join(',')})`
  }
  if (fields(c, ['type', 'condition']) && c.type === 'not') {
    const inner = condition(c.condition)
    if (inner) return `conditions.not(${inner})`
  }
  if (fields(c, ['type', 'baseId']) && typeof c.baseId === 'string') {
    if (c.type === 'selfHasMark')
      return `targets.ownerMarks.where(mark => mark.baseId === ${q(c.baseId)}).condition(checks.exists())`
    if (c.type === 'opponentHasMark')
      return `targets.opponentActive.condition((_ctx,pets) => pets.some(pet => pet.marks.some(mark => mark.baseId === ${q(c.baseId)})))`
  }
  if (!fields(c, ['type', 'target', 'evaluator']) || c.type !== 'evaluate') return
  const e = c.evaluator
  if (fields(e, ['type']) && e.type === 'exist') {
    const ms = members(c.target)
    if (ms) return `${ms}.condition(checks.exists())`
  }
  if (
    fields(e, ['type', 'operator', 'value']) &&
    e.type === 'compare' &&
    ['<', '>', '<=', '>=', '=='].includes(e.operator)
  ) {
    // Legacy compare checks every member with some(); only single-entity roots may use first().
    if (!['self', 'opponent', 'mark'].includes(c.target?.base)) return
    const left = selectedNumber(c.target),
      right = number(e.value)
    if (left && right)
      return `((ctx: EffectFrame) => {const left=ctx.read(${left});const right=${right.literal ? right.code : `ctx.read(${right.code})`};return left!==undefined && right!==undefined && left ${e.operator === '==' ? '===' : e.operator} right})`
  }
  if (
    fields(e, ['type', 'value']) &&
    e.type === 'same' &&
    typeof e.value === 'string' &&
    fields(c.target, ['base', 'chain']) &&
    c.target.base === 'damageContext' &&
    Array.isArray(c.target.chain) &&
    c.target.chain.length === 1
  ) {
    const step = c.target.chain[0]
    if (fields(step, ['type', 'arg']) && step.type === 'selectPath' && ['damageType', 'element'].includes(step.arg))
      return `contexts.damage.condition((_ctx,events) => events[0]?.${step.arg} === ${q(e.value)})`
  }
}
export function classifyDamageModifier(d) {
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
  const parameters = []
  const when = condition(d.condition),
    percent = number(a.percent, parameters, 'percent'),
    delta = number(a.delta, parameters, 'delta')
  if (!when) return { reason: 'condition requires a separate semantic mapping' }
  if (!percent || !delta) return { reason: 'numeric value or parameter requires a separate semantic mapping' }
  return {
    id: d.id,
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
