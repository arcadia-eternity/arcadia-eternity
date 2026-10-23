import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { writeMigrationArtifact } from './artifacts.mjs'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { fields, normalize } from './authoring-emitter.mjs'
const percentages = {
  effect_emblem_increase_rage_on_damage: 20,
  effect_mark_increase_rage_on_damage_10_percent: 10,
  effect_mark_increase_rage_on_damage_20_percent: 20,
}
export function classifyRageModifier(d) {
  if (!d || !Object.hasOwn(percentages, d.id)) return { reason: 'not an admitted damage-rage definition' }
  if (
    !fields(d, ['id', 'trigger', 'priority', 'condition', 'apply']) ||
    d.trigger !== 'BeforeRageGain' ||
    d.priority !== 0 ||
    !fields(d.condition, ['type']) ||
    d.condition.type !== 'selfBeDamaged' ||
    !fields(d.apply, ['type', 'target', 'percent', 'delta']) ||
    d.apply.type !== 'addModified' ||
    d.apply.target !== 'rageContext' ||
    d.apply.percent !== percentages[d.id] ||
    d.apply.delta !== 0
  )
    return { reason: 'historical damage-rage source changed' }
  return {
    id: d.id,
    percent: d.apply.percent,
    delta: 0,
    trigger: 'BeforeRageGain',
    condition: 'ownerReceivesDamageRage',
    historicalReference: '61c349fa7ca35c392b0e751c9238759b02aefcb3',
  }
}
export async function generateRageModifiers({ check = false } = {}) {
  const records = [],
    rejected = []
  for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${kind}.yaml`
    for (const [i, d] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      if (d.apply?.type !== 'addModified' || d.apply?.target !== 'rageContext') continue
      const source = {
          id: d.id,
          sourceFile,
          sourcePath: `/${i}`,
          definitionSha256: createHash('sha256')
            .update(JSON.stringify(normalize(d)))
            .digest('hex'),
        },
        recipe = classifyRageModifier(d)
      if (recipe.reason) rejected.push({ ...source, reason: recipe.reason })
      else records.push({ ...source, recipe, classification: 'U', status: 'generated-candidate' })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const code = `// Generated candidates preserving historical pre-settlement damage-rage behavior.\nimport {compileEffect,defineEffect,conditions,contexts,ops} from '../content/authoring'\nexport function createGeneratedRageModifiers(){return Object.freeze({${records.map(({ recipe: r }) => `${JSON.stringify(r.id)}:compileEffect(defineEffect({id:${JSON.stringify(r.id)},on:'BeforeRageGain',priority:0,when:conditions.ownerReceivesDamageRage,execute:contexts.rage.apply(ops.modifyRage({percent:${r.percent},delta:0}))}))`).join(',')}})}\nexport const generatedRageModifiers=createGeneratedRageModifiers()\n`
  for (const [path, raw] of [
    ['packages/battle/src/v4/official/rage-modifiers.generated.ts', code],
    [
      'docs/v4/validation/rage-modifiers-candidates.json',
      JSON.stringify({ formatVersion: 1, records, rejected }, null, 2),
    ],
  ]) {
    const output = await format(raw, { ...(await resolveConfig(path)), filepath: path })
    await writeMigrationArtifact(path, output, { check })
  }
  return { generated: records.length, rejected: rejected.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(a => a !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateRageModifiers({ check: process.argv.includes('--check') })))
}
