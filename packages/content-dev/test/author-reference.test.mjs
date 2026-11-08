import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js'
import { NativeSpeciesSchema, NativeSkillSchema, NativeMarkSchema } from '@arcadia-eternity/battle/engine'
import { authorReference, referenceTopics } from '../src/author-reference.mjs'
import { teamDocument, TeamDocumentSchema } from '../src/project-teams.mjs'
import { environmentDocument, EnvironmentDocumentSchema } from '../src/debug-environments.mjs'

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
  assert.equal(effects.examples[0].text, await readFile(new URL('../template/src/effects.ts', import.meta.url), 'utf8'))
  for (const topic of referenceTopics) assert.ok(JSON.stringify(await authorReference({ topic })).length < 32 * 1024)
})
