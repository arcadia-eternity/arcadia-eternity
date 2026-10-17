import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { EffectParser } from '@arcadia-eternity/battle/v4/legacy'
import { setGlobalLogger } from '@arcadia-eternity/battle/v4'

setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
const effectFiles = ['effect_global', 'effect_ability', 'effect_emblem', 'effect_mark', 'effect_skill']
const callerFiles = ['skill', 'mark_global', 'mark_ability', 'mark_emblem', 'mark']
const sha256 = value => createHash('sha256').update(value).digest('hex')
const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
const canonical = value => JSON.stringify(normalize(value))
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
function inspect(value, path = '', result = { nodes: [], config: [], references: [] }) {
  if (!value || typeof value !== 'object') return result
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspect(entry, `${path}/${index}`, result))
    return result
  }
  if (typeof value.type === 'string') result.nodes.push({ path, type: value.type })
  if (value.type?.startsWith('raw:'))
    result.config.push({ path, configId: value.configId ?? null, tags: value.tags ?? [] })
  if (typeof value.configId === 'string' && !value.type?.startsWith('raw:'))
    result.references.push({ path, kind: 'config', value: value.configId })
  if (value.type?.startsWith('entity:')) result.references.push({ path, kind: value.type, value: value.value })
  for (const key of Object.keys(value).sort())
    inspect(value[key], `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, result)
  return result
}
async function inventory(root) {
  const files = [],
    records = [],
    callers = new Map()
  for (const name of [...effectFiles, ...callerFiles]) {
    const path = `${root}/${name}.yaml`
    const text = await readFile(path, 'utf8')
    const data = parse(text, { merge: true })
    assert.ok(Array.isArray(data), `Expected array: ${path}`)
    files.push({ path, sha256: sha256(text), records: data.length })
    for (const [index, item] of data.entries()) {
      assert.equal(typeof item.id, 'string', `Missing ID: ${path}/${index}`)
      if (!effectFiles.includes(name)) {
        for (const [position, id] of (item.effect ?? []).entries()) {
          const refs = callers.get(id) ?? []
          refs.push({ file: path, id: item.id, path: `/${index}/effect/${position}` })
          callers.set(id, refs)
        }
        continue
      }
      let oracle
      try {
        EffectParser.parse(item)
        oracle = { structuralStatus: 'accepted', behaviorStatus: 'not-run' }
      } catch (error) {
        const diagnostic = error instanceof Error ? error.message : 'Unknown parser failure'
        oracle = {
          structuralStatus: 'rejected',
          behaviorStatus: 'not-run',
          diagnostic: diagnostic.slice(0, 2000),
          diagnosticSha256: sha256(diagnostic),
        }
      }
      records.push({
        id: item.id,
        sourceFile: path,
        sourcePath: `/${index}`,
        definitionSha256: sha256(canonical(item)),
        trigger: item.trigger,
        priority: item.priority,
        consumesStacks: item.consumesStacks ?? 0,
        ...inspect(item),
        oracle,
        semanticClass: 'U',
        decisionIds: [],
        scenarios: [],
        migrationStatus: 'not-generated',
      })
    }
  }
  const ids = new Set()
  for (const record of records) {
    assert.ok(!ids.has(record.id), `Duplicate effect: ${record.id}`)
    ids.add(record.id)
    record.callers = callers.get(record.id) ?? []
  }
  const danglingReferences = [...callers].filter(([id]) => !ids.has(id)).map(([id, uses]) => ({ id, uses }))
  return {
    root,
    sourceRevision: git(['log', '-1', '--format=%H', '--', root]),
    files,
    totalEffects: records.length,
    referencedEffects: records.filter(record => record.callers.length).length,
    referenceCount: [...callers.values()].reduce((sum, refs) => sum + refs.length, 0),
    oracleAccepted: records.filter(record => record.oracle.structuralStatus === 'accepted').length,
    danglingReferences,
    records,
  }
}
const datasets = []
for (const root of ['packages/battle/test/v4/fixtures/v1-data', 'packs/base/data']) datasets.push(await inventory(root))
const previous = new Map(datasets[0].records.map(record => [record.id, record.definitionSha256]))
const current = new Map(datasets[1].records.map(record => [record.id, record.definitionSha256]))
const comparison = {
  added: [...current.keys()].filter(id => !previous.has(id)),
  removed: [...previous.keys()].filter(id => !current.has(id)),
  changed: [...current.keys()].filter(id => previous.has(id) && previous.get(id) !== current.get(id)),
  identical: [...current.keys()].filter(id => previous.get(id) === current.get(id)),
}
const report = {
  formatVersion: 1,
  evidence:
    'Source structure and legacy parser acceptance only. No behavior equivalence is inferred; all unverified definitions remain U.',
  oracleTree: git(['rev-parse', 'HEAD:packages/battle/src/v4/legacy']),
  datasets,
  comparison,
}
const path = 'docs/v4/validation/effect-migration-inventory.json'
const output = await format(JSON.stringify(report), { ...(await resolveConfig(path)), parser: 'json' })
if (process.argv.includes('--check'))
  assert.equal(await readFile(path, 'utf8'), output, 'Migration evidence drift; inspect sources before regenerating')
else await writeFile(path, output)
console.log(
  JSON.stringify({
    datasets: datasets.map(({ root, totalEffects, oracleAccepted, referenceCount, danglingReferences }) => ({
      root,
      totalEffects,
      oracleAccepted,
      referenceCount,
      danglingReferences: danglingReferences.length,
    })),
    comparison: Object.fromEntries(Object.entries(comparison).map(([key, ids]) => [key, ids.length])),
  }),
)
