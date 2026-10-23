import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { parse } from 'yaml'
import { format, resolveConfig } from 'prettier'
import { ConfigSystem, createOfficialEffectCandidates, setGlobalLogger } from '@arcadia-eternity/battle/v4'
import { MarkParser } from '@arcadia-eternity/battle/v4/legacy'
import { normalize } from './authoring-emitter.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tags = value => [...(value ?? [])].sort()
export function rawParameters(value, path = '', output = []) {
  if (!value || typeof value !== 'object') return output
  if (typeof value.type === 'string' && value.type.startsWith('raw:'))
    output.push({ nodePath: path, value: value.value, tags: value.tags ?? [], configId: value.configId })
  for (const [key, child] of Object.entries(value))
    rawParameters(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`, output)
  return output
}

/** Declaration/default/tag correspondence only; execution timing needs its own runtime evidence. */
export function matchParameterSurface(definitions, parameters, resolveAlias, extensions) {
  const used = new Set()
  const records = []
  for (const source of definitions)
    for (const raw of rawParameters(source.definition)) {
      const legacyAlias = raw.configId ? `${source.id}.${raw.configId}` : null
      const matching = legacyAlias
        ? parameters.filter(parameter => parameter.address === resolveAlias(source.id, legacyAlias))
        : parameters.filter(
            parameter =>
              parameter.effectId === source.id &&
              same(parameter.value, raw.value) &&
              same(tags(parameter.tags), tags(raw.tags)),
          )
      assert.equal(matching.length, 1, `Missing or ambiguous raw parameter: ${source.id}${raw.nodePath}`)
      const parameter = matching[0]
      assert.equal(parameter.effectId, source.id, `Foreign parameter alias: ${legacyAlias}`)
      assert.ok(same(parameter.value, raw.value), `Changed default: ${source.id}${raw.nodePath}`)
      assert.ok(same(tags(parameter.tags), tags(raw.tags)), `Changed tags: ${source.id}${raw.nodePath}`)
      assert.ok(!used.has(parameter.address), `Multiple source nodes share ${parameter.address}`)
      used.add(parameter.address)
      records.push({
        effectId: source.id,
        sourceFile: source.sourceFile,
        sourcePath: source.sourcePath,
        definitionSha256: source.definitionSha256,
        nodePath: raw.nodePath,
        address: parameter.address,
        legacyAlias,
        defaultValue: raw.value,
        tags: tags(raw.tags),
      })
    }
  const added = parameters.filter(parameter => !used.has(parameter.address))
  assert.equal(new Set(extensions.map(extension => extension.address)).size, extensions.length, 'Duplicate extension')
  for (const parameter of added) {
    const extension = extensions.find(extension => extension.address === parameter.address)
    assert.ok(extension, `Undeclared parameter extension: ${parameter.address}`)
    assert.equal(extension.effectId, parameter.effectId, 'Foreign parameter extension')
    assert.ok(same(extension.defaultValue, parameter.value), `Changed extension default: ${parameter.address}`)
    assert.ok(same(tags(extension.tags), tags(parameter.tags)), `Changed extension tags: ${parameter.address}`)
    assert.ok(typeof extension.reason === 'string' && extension.reason.length > 0, 'Missing extension reason')
  }
  assert.equal(added.length, extensions.length, 'Stale or source-overlapping parameter extension')
  return {
    formatVersion: 1,
    evidence:
      'Every current raw node maps to one native address with the same default/tags; explicit aliases resolve. Does not infer execution-time equivalence.',
    summary: {
      sourceDeclarations: records.length,
      explicitAliases: records.filter(record => record.legacyAlias).length,
      nativeParameters: parameters.length,
      extensions: added.length,
    },
    records: records.sort((a, b) => `${a.effectId}${a.nodePath}`.localeCompare(`${b.effectId}${b.nodePath}`, 'en')),
    extensions,
  }
}

export async function auditCurrentParameterSurface() {
  setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
  const marks = new Map()
  for (const kind of ['mark', 'mark_ability', 'mark_emblem', 'mark_global'])
    for (const definition of parse(await readFile(`packs/base/data/${kind}.yaml`, 'utf8'), { merge: true }))
      marks.set(definition.id, MarkParser.parse({ ...definition, effect: [] }))
  const native = createOfficialEffectCandidates(marks)
  const definitions = []
  for (const kind of ['global', 'ability', 'emblem', 'mark', 'skill']) {
    const sourceFile = `packs/base/data/effect_${kind}.yaml`
    const source = parse(await readFile(sourceFile, 'utf8'), { merge: true })
    for (const [index, definition] of source.entries())
      definitions.push({
        id: definition.id,
        sourceFile,
        sourcePath: `/${index}`,
        definitionSha256: hash(JSON.stringify(normalize(definition))),
        definition,
      })
  }
  const extensions = JSON.parse(await readFile('docs/v4/validation/official-parameter-extensions.json', 'utf8')).records
  const config = ConfigSystem.createInstance('native-parameter-surface-audit')
  try {
    for (const catalog of new Set(native.parameters.values())) catalog.install(config)
    const parameters = config
      .getRegisteredKeys()
      .filter(key => key.startsWith('ae:param:'))
      .map(address => ({
        effectId: JSON.parse(address.slice('ae:param:'.length))[0],
        address,
        value: config.get(address),
        tags: config.getConfigTags(address),
      }))
    return matchParameterSurface(
      definitions,
      parameters,
      (id, alias) => native.parameters.get(id)?.addressOf(alias),
      extensions,
    )
  } finally {
    config.destroy()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(
    process.argv.slice(2).every(argument => argument === '--check'),
    'Only --check is supported',
  )
  const report = await auditCurrentParameterSurface()
  const path = 'docs/v4/validation/official-parameter-mapping.json'
  const output = await format(JSON.stringify(report), { ...(await resolveConfig(path)), parser: 'json' })
  if (process.argv.includes('--check')) assert.equal(await readFile(path, 'utf8'), output, 'Parameter surface drift')
  else await writeFile(path, output)
  console.log(JSON.stringify(report.summary))
}
