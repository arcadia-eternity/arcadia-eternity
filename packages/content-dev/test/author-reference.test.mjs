import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { NativeSpeciesSchema, NativeSkillSchema, NativeMarkSchema } from '@arcadia-eternity/battle/engine'
import { creatorPages } from '../src/creator-docs.ts'
import { authorReference, referenceTopics } from '../src/author-reference.ts'
import { teamDocument, TeamDocumentSchema } from '../src/project-teams.ts'
import { environmentDocument, EnvironmentDocumentSchema } from '../src/debug-environments.ts'

test('author references derive runtime fields from the installed parser and distinguish source linking', async () => {
  for (const [topic, schema] of Object.entries({
    species: NativeSpeciesSchema,
    skills: NativeSkillSchema,
    marks: NativeMarkSchema,
  })) {
    const result = await authorReference({ topic })
    assert.deepEqual(result.schema, toJsonSchemaCompat(schema))
    assert.equal(result.stage, 'linked-runtime')
    assert.match(result.notes.join('\n'), /not a validator for unlinked source/)
    assert.match(result.notes.join('\n'), /\$ref/)
    assert.equal(result.schema.properties.presentation, undefined)
  }
  const skill = await authorReference({ topic: 'skills' })
  assert.ok(skill.schema.properties.behaviors)
  assert.match(skill.examples[0].text, /\$ref:/)
  await assert.rejects(authorReference({ topic: '../../package.json' }), { code: 'REFERENCE_UNKNOWN' })
})

test('team and environment references share validators used by saved project documents', async () => {
  const team = await authorReference({ topic: 'team' })
  assert.equal(team.schema.properties.team.maxItems, 6)
  assert.equal(team.schema.properties.team.items.properties.id, undefined)
  assert.equal(team.schema.properties.team.items.additionalProperties, false)
  const validTeam = { schemaVersion: 1, id: 'blue', name: ' 蓝队 ', team: [] }
  assert.deepEqual(teamDocument(validTeam), TeamDocumentSchema.parse(validTeam))
  assert.equal(teamDocument(validTeam).name, '蓝队')
  assert.throws(() => teamDocument({ ...validTeam, id: null }), { code: 'TEAM_INVALID' })
  assert.throws(() => teamDocument({ ...validTeam, team: [{ id: '0'.repeat(21) }] }), { code: 'TEAM_INVALID' })
  const environment = await authorReference({ topic: 'environment' })
  assert.deepEqual(environment.schema, toJsonSchemaCompat(EnvironmentDocumentSchema))
  assert.equal(environmentDocument(JSON.parse(environment.examples[0].text)).schemaVersion, 2)
  const validEnvironment = { schemaVersion: 1, id: 'interaction', name: ' 测试 ', packages: {}, sources: [] }
  assert.deepEqual(environmentDocument(validEnvironment), EnvironmentDocumentSchema.parse(validEnvironment))
  for (const change of [
    { id: 'default' },
    { packages: { '@example/pack': 'file:../pack' } },
    { sources: ['pack', 'pack'] },
  ])
    assert.throws(() => environmentDocument({ ...validEnvironment, ...change }), { code: 'ENVIRONMENT_INVALID' })
})

test('description tags match the renderer and effects come from the shipped template', async () => {
  const result = await authorReference({ topic: 'descriptions' })
  const renderer = await readFile(new URL('../../web-ui/src/i18n/richDescription.ts', import.meta.url), 'utf8')
  const styleBlock = renderer.split('export const descriptionStyles')[1].split('\n}')[0]
  const tags = [...styleBlock.matchAll(/^  (\w+):/gm)].map(match => match[1])
  assert.deepEqual(result.tags, [...tags, 'mark'])
  assert.match(result.notes.join('\n'), /preserve \{stack\}/)
  assert.match(result.notes.join('\n'), /not implemented/)
  const effects = await authorReference({ topic: 'effects' })
  assert.equal(
    effects.examples[0].text,
    await readFile(new URL('../template/src/effects/slow.effect.ts', import.meta.url), 'utf8'),
  )
  const authoring = await authorReference({ topic: 'authoring' })
  assert.equal(
    authoring.instructions,
    await readFile(new URL('../../../docs/guides/ugc-authoring-agent/SKILL.md', import.meta.url), 'utf8'),
  )
  for (const topic of referenceTopics) assert.ok(JSON.stringify(await authorReference({ topic })).length < 32 * 1024)
})

test('each handbook page is discoverable and readable through its installed MCP topic', async () => {
  const paths = new Set()
  const queries = new Set()
  for (const page of creatorPages) {
    assert.ok(!paths.has(page.path), page.path)
    paths.add(page.path)
    const topic = await authorReference({ topic: page.topic })
    assert.ok(
      topic.entries.some(entry => entry.path === page.path),
      page.path,
    )
    for (const symbol of page.symbols) {
      const key = page.topic + '/' + symbol
      assert.ok(!queries.has(key), key)
      queries.add(key)
      const result = await authorReference({ topic: page.topic, symbol })
      assert.equal(result.path, '/' + page.path)
      assert.ok(result.markdown.startsWith('# ' + page.title + '\n'))
      assert.doesNotMatch(result.markdown, /^<<< /m)
    }
  }
})

test('SDK symbols cover dispatched triggers and preserve the actual frame and domain capabilities', async () => {
  const { nativeEffectTriggers } = await import('@arcadia-eternity/battle/authoring')
  const enumeration = await authorReference({ symbol: 'EffectTrigger' })
  const native = []
  for (const symbol of enumeration.members) {
    const item = await authorReference({ symbol })
    if (item.kind !== '触发器') continue
    native.push(symbol.slice('EffectTrigger.'.length))
    assert.ok(item.description && item.example && item.dispatches.length, symbol)
    assert.ok(item.fields.length, symbol)
    for (const name of [item.parent, ...item.fields, ...item.methods.map(method => method.symbol)])
      assert.equal((await authorReference({ symbol: name })).symbol, name)
  }
  assert.deepEqual(native.sort(), [...nativeEffectTriggers].sort())
  const hit = await authorReference({ symbol: 'EffectTrigger.OnHit' })
  assert.equal(hit.parent, 'UseSkillContext')
  assert.ok(
    hit.methods.some(method => method.receiver === 'ctx.parent.actualTarget' && method.symbol === 'Pet.addMark'),
  )
  assert.match((await authorReference({ symbol: 'UseSkillContext.actualTarget' })).signature, /Pet \| undefined/)
  assert.match((await authorReference({ symbol: 'Pet.addMark' })).signature, /AddMarkContext.*parameter-conflict/)
  assert.match(
    (await authorReference({ symbol: 'ops.bindAttribute' })).signature,
    /AttributeBindingOptions.*Operator<Pet>/,
  )
  assert.match((await authorReference({ symbol: 'ParameterCatalog.read' })).signature, /\n/)
  assert.match((await authorReference({ symbol: 'EffectFrame.ops.modifyDamage' })).signature, /DamageContext/)
  const before = await authorReference({ symbol: 'EffectTrigger.OnBeforeCalculateDamage' })
  assert.ok(before.methods.some(m => m.symbol === 'DamageContext.addModified'))
  assert.ok(!before.methods.some(m => m.symbol === 'Pet.damage'))
  for (const symbol of [
    'Pet.cleanupAttributeModifiers',
    'UseSkillContext.updateActualTarget',
    'NativeEffectContext.sourceActor',
  ])
    await assert.rejects(authorReference({ symbol }), { code: 'REFERENCE_UNKNOWN' })
  const a = await authorReference({ topic: 'sdk' })
  const b = await authorReference({ topic: 'sdk', offset: a.nextOffset })
  assert.equal(a.matches.length, 50)
  assert.ok(a.matches.at(-1).symbol < b.matches[0].symbol)
  const found = await authorReference({ query: 'addmark' })
  assert.ok(found.matches.some(item => item.symbol === 'Pet.addMark'))
})

test('every trigger example type-checks against the content SDK entry', async () => {
  const { default: ts } = await import('typescript')
  const { nativeEffectTriggers } = await import('@arcadia-eternity/battle/authoring')
  const { fileURLToPath } = await import('node:url')
  const source = [
    "import { effect, on, EffectTrigger, type NativeEffectContext, type EffectModuleContext, AddMarkContext, defineCodeEffect, numberParam, targets, ops } from '@arcadia-eternity/content-sdk'",
  ]
  for (const trigger of nativeEffectTriggers) {
    const event = await authorReference({ symbol: 'EffectTrigger.' + trigger })
    source.push(event.example.replace('function readEvent(', 'function read' + trigger + '('))
  }
  const file = fileURLToPath(new URL('../test/trigger-examples.ts', import.meta.url))
  const options = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    types: [],
    paths: { '@arcadia-eternity/content-sdk': [fileURLToPath(new URL('../src/index.ts', import.meta.url))] },
  }
  const host = ts.createCompilerHost(options)
  const read = host.readFile.bind(host)
  host.readFile = name => (name === file ? source.join('\n') : read(name))
  const program = ts.createProgram([file], options, host)
  const unit = program.getSourceFile(file)
  assert.ok(unit)
  const errors = [...program.getSyntacticDiagnostics(unit), ...program.getSemanticDiagnostics(unit)]
  assert.equal(ts.formatDiagnostics(errors, host), '')
})
