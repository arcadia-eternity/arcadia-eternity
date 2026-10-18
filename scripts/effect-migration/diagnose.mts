import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { effectDSLSchema } from '../../packages/battle/src/v4/legacy/schema/effectSchema'
import { relevant } from './diagnostic-issues.mjs'

const inventory = JSON.parse(await readFile('docs/v4/validation/effect-migration-inventory.json', 'utf8'))
const dataset = inventory.datasets.find((item: { root: string }) => item.root === 'packs/base/data')
assert.equal(
  inventory.oracleTree,
  execFileSync('git', ['rev-parse', 'HEAD:packages/battle/src/v4/legacy'], { encoding: 'utf8' }).trim(),
)
const definitions = new Map<string, unknown>()
for (const file of dataset.files.filter((file: { path: string }) => file.path.includes('/effect_'))) {
  const text = await readFile(file.path, 'utf8')
  assert.equal(createHash('sha256').update(text).digest('hex'), file.sha256, `Source drift: ${file.path}`)
  for (const effect of parse(text, { merge: true })) definitions.set(effect.id, effect)
}
const pointer = (path: (string | number)[]) =>
  '/' + path.map(part => String(part).replaceAll('~', '~0').replaceAll('/', '~1')).join('/')

const records = dataset.records.map((record: any) => {
  const definition = definitions.get(record.id)
  const parsed = effectDSLSchema.safeParse(definition)
  const diagnostics = parsed.success ? [] : relevant(parsed.error.issues, definition)
  const unique = [...new Map(diagnostics.map(diagnostic => [JSON.stringify(diagnostic), diagnostic])).values()]
  // A diagnosis-only experiment, never a migration or an equivalence claim.
  const aliases: string[] = []
  function rename(value: any, path: (string | number)[] = []): any {
    if (value === 'useSkillContext' && ['base', 'target'].includes(String(path.at(-1)))) {
      aliases.push(pointer(path))
      return 'usingSkillContext'
    }
    if (Array.isArray(value)) return value.map((item, index) => rename(item, [...path, index]))
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rename(item, [...path, key])]))
    return value
  }
  const experiment = effectDSLSchema.safeParse(rename(definition))
  return {
    id: record.id,
    sourceFile: record.sourceFile,
    sourcePath: record.sourcePath,
    originalSchemaAccepted: parsed.success,
    oracleParserAccepted: record.oracle.structuralStatus === 'accepted',
    diagnostics: unique,
    ...(parsed.success && record.oracle.structuralStatus === 'rejected'
      ? { parserDiagnostic: record.oracle.diagnostic }
      : {}),
    selectorAliasExperiment: { paths: aliases, schemaAccepted: experiment.success },
  }
})
const report = {
  formatVersion: 1,
  oracleTree: inventory.oracleTree,
  sourceFiles: dataset.files.filter((file: { path: string }) => file.path.includes('/effect_')),
  evidence:
    'Schema diagnostics and one isolated selector-spelling experiment only. No production data is changed, no parser/runtime acceptance or behavioral equivalence is inferred from the experiment.',
  summary: {
    definitions: records.length,
    schemaAccepted: records.filter((record: any) => record.originalSchemaAccepted).length,
    schemaRejected: records.filter((record: any) => !record.originalSchemaAccepted).length,
    schemaAcceptedButParserRejected: records.filter(
      (record: any) => record.originalSchemaAccepted && !record.oracleParserAccepted,
    ).length,
    parserAccepted: records.filter((record: any) => record.oracleParserAccepted).length,
    schemaAcceptedAfterAliasExperiment: records.filter((record: any) => record.selectorAliasExperiment.schemaAccepted)
      .length,
    newlySchemaAcceptedByAliasExperiment: records.filter(
      (record: any) => !record.originalSchemaAccepted && record.selectorAliasExperiment.schemaAccepted,
    ).length,
  },
  records,
}
const path = 'docs/v4/validation/effect-oracle-diagnostics.json'
const output = await format(JSON.stringify(report), { ...(await resolveConfig(path)), parser: 'json' })
if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), output, 'Oracle diagnostics drift')
else await writeFile(path, output)
console.log(JSON.stringify(report.summary))
