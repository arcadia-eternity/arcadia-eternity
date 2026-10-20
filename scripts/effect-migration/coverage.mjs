import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { normalize } from './authoring-emitter.mjs'
// These older standalone ledgers hash parsed YAML insertion order, as their public tests do.
const insertionOrderLedgers = new Set([
  'curse-mark-application.json',
  'random-weather-application.json',
  'random-mark-applications.json',
])
const candidateStatuses = new Set([
  'generated-candidate',
  'generated-correction-candidate',
  'native-candidate',
  'handwritten-candidate',
  'handwritten-override-retained',
])
/** Candidate ownership only. This is deliberately not production or behavioral acceptance. */
export async function candidateCoverage() {
  const definitions = new Map(),
    owners = new Map()
  for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${kind}.yaml`
    for (const definition of parse(await readFile(sourceFile, 'utf8'), { merge: true })) {
      if (definitions.has(definition.id)) throw new Error(`Duplicate source: ${definition.id}`)
      definitions.set(definition.id, {
        sourceFile,
        insertionOrderSha256: createHash('sha256').update(JSON.stringify(definition)).digest('hex'),
        definitionSha256: createHash('sha256')
          .update(JSON.stringify(normalize(definition)))
          .digest('hex'),
      })
    }
  }
  for (const name of (await readdir('docs/v4/validation')).filter(name => name.endsWith('.json')).sort()) {
    const ledger = `docs/v4/validation/${name}`,
      data = JSON.parse(await readFile(ledger, 'utf8'))
    for (const record of data.records ?? [data]) {
      // The original stat-stage generator predates the status field.
      const legacyStageRecord =
        name === 'stat-stages-candidates.json' && record.status === undefined && record.recipe?.id === record.id
      if (!candidateStatuses.has(record.status) && !legacyStageRecord) continue
      const source = definitions.get(record.id)
      if (
        !source ||
        record.sourceFile !== source.sourceFile ||
        record.definitionSha256 !==
          (insertionOrderLedgers.has(name) ? source.insertionOrderSha256 : source.definitionSha256)
      )
        throw new Error(`Candidate source drift: ${ledger}: ${record.id}`)
      const entries = owners.get(record.id) ?? []
      if (!entries.includes(ledger)) entries.push(ledger)
      owners.set(record.id, entries)
    }
  }
  return {
    total: definitions.size,
    covered: owners.size,
    uncovered: [...definitions.keys()].filter(id => !owners.has(id)).sort(),
    owners: Object.fromEntries([...owners].sort(([a], [b]) => a.localeCompare(b, 'en'))),
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--uncovered')) throw new Error('Only --uncovered supported')
  const result = await candidateCoverage()
  console.log(
    JSON.stringify({
      total: result.total,
      covered: result.covered,
      uncovered: process.argv.includes('--uncovered') ? result.uncovered : result.uncovered.length,
    }),
  )
}
