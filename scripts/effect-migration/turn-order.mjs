import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { normalize } from './authoring-emitter.mjs'

export function turnOrderReferences(value, path = '') {
  if (Array.isArray(value)) return value.flatMap((v, i) => turnOrderReferences(v, `${path}/${i}`))
  if (!value || typeof value !== 'object') return []
  const own = ['isFirstSkillUsedThisTurn', 'isLastSkillUsedThisTurn'].includes(value.type)
    ? [{ path, condition: value.type }]
    : []
  return [
    ...own,
    ...Object.entries(value).flatMap(([k, v]) =>
      turnOrderReferences(v, `${path}/${k.replaceAll('~', '~0').replaceAll('/', '~1')}`),
    ),
  ]
}
export async function generateTurnOrder({ check = false } = {}) {
  const records = []
  for (const name of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${name}.yaml`
    for (const [index, definition] of parse(await readFile(sourceFile, 'utf8'), { merge: true }).entries()) {
      const nodes = turnOrderReferences(definition)
      if (!nodes.length) continue
      records.push({
        id: definition.id,
        sourceFile,
        sourcePath: `/${index}`,
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(definition)))
          .digest('hex'),
        trigger: definition.trigger,
        nodes,
      })
    }
  }
  records.sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const path = 'docs/v4/validation/turn-order-correction.json'
  const output = await format(
    JSON.stringify({
      formatVersion: 1,
      decision: 'C08',
      previousRevision: 'cdf6fdf4',
      scope: 'Potential source references, not per-ID behavioral acceptance. Direct skill ancestry remains required.',
      records,
    }),
    { ...(await resolveConfig(path)), filepath: path },
  )
  if (check) {
    if ((await readFile(path, 'utf8')) !== output) throw new Error('Turn-order scope drift')
  } else await writeFile(path, output)
  return { references: records.length }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--check')) throw new Error('Only --check supported')
  console.log(JSON.stringify(await generateTurnOrder({ check: process.argv.includes('--check') })))
}
