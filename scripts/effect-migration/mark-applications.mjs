import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
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
const selfCondition = condition =>
  (fields(condition, ['type']) && condition.type === 'selfUseSkill') ||
  (fields(condition, ['type', 'conditions']) &&
    condition.type === 'every' &&
    Array.isArray(condition.conditions) &&
    condition.conditions.length === 1 &&
    selfCondition(condition.conditions[0]))
export function classifyMarkApplication(definition) {
  if (
    !fields(definition, ['id', 'trigger', 'priority', 'apply', 'condition']) ||
    typeof definition.id !== 'string' ||
    !definition.id ||
    !Number.isFinite(definition.priority)
  )
    return { reason: 'unsupported definition fields or identity/priority' }
  const action = definition.apply
  if (
    !fields(action, ['type', 'target', 'mark'], ['stack', 'duration']) ||
    action.type !== 'addMark' ||
    !['self', 'opponent'].includes(action.target)
  )
    return { reason: 'requires one addMark action on self/opponent' }
  if (
    !fields(action.mark, ['type', 'value']) ||
    action.mark.type !== 'entity:baseMark' ||
    typeof action.mark.value !== 'string' ||
    !action.mark.value
  )
    return { reason: 'requires a fixed base mark reference' }
  if (['stack', 'duration'].some(key => Object.hasOwn(action, key) && !Number.isFinite(action[key])))
    return { reason: 'requires finite literal stack/duration, without Config or dynamic values' }
  const triggers = Array.isArray(definition.trigger) ? definition.trigger : [definition.trigger]
  if (
    !triggers.length ||
    new Set(triggers).size !== triggers.length ||
    !triggers.every(trigger => ['OnHit', 'OnMiss'].includes(trigger)) ||
    !selfCondition(definition.condition)
  )
    return { reason: 'unsupported condition/trigger combination' }
  return {
    id: definition.id,
    priority: definition.priority,
    triggers,
    target: action.target,
    markId: action.mark.value,
    // Both the old parser and operator use truthiness: explicit zero is treated as omitted.
    ...(action.stack ? { stack: action.stack } : {}),
    ...(action.duration ? { duration: action.duration } : {}),
  }
}
const protectedIds = new Set([
  'effect_skill_add_mark_shuiwenpingzhang',
  'effect_mark_onDestroy_add_mark_shanghaizengjia',
])
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
      if (!mark) throw new Error(`Missing dependency ${recipe.markId} for ${definition.id}`)
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
  const entries = candidates.map(
    ({ recipe: r }) => `${JSON.stringify(r.id)}: defineNativeEffect({
    id: ${JSON.stringify(r.id)} as effectId, triggers: [${r.triggers.map(t => `EffectTrigger.${t}`).join(', ')}], priority: ${r.priority}, when: selfUsesSkill,
    apply(context) { const owner = context.source.owner; if (!(owner instanceof Pet)) return;
      const target = ${r.target === 'self' ? 'owner' : 'context.battle.getOpponent(owner.owner!).activePet'};
      target.addMark(new AddMarkContext(context, target, resolved.get(${JSON.stringify(r.markId)})!, ${r.stack ?? 'undefined'}, ${r.duration ?? 'undefined'}));
    },
  })`,
  )
  const code = `// Generated by scripts/effect-migration/mark-applications.mjs. Candidates only; no production registration.
import { EffectTrigger, type effectId } from '@arcadia-eternity/const'
import { AddMarkContext, type EffectContext, UseSkillContext } from '../context'
import { Pet } from '../pet'
import { BaseMark, MarkInstanceImpl } from '../mark'
import { SkillInstance } from '../skill'
import { defineNativeEffect } from '../content/native-effect'
function selfUsesSkill(context: EffectContext<EffectTrigger>): boolean {
  if (!(context.parent instanceof UseSkillContext)) return false
  return context.source.owner === context.parent.pet && (context.source instanceof SkillInstance ? context.source === context.parent.skill : context.source instanceof MarkInstanceImpl)
}
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
