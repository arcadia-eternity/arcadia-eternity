import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertEnvironmentRequirements,
  assertEnvironmentTeam,
  validateEnvironmentRules,
} from '../src/environment-rules.mjs'
import { prepareBattleEnvironment } from '../src/environment.mjs'
import { prepareContentPack } from '../src/testing.mjs'

const pet = (species = 'sample:pet', values = {}) => ({ species, skills: ['sample:strike'], ...values })
const rules = values => ({ schemaVersion: 1, ...values })
const rejected = run => assert.throws(run, { code: 'ENVIRONMENT_TEAM_REJECTED' })

test('supported rules are copied and unsupported policies fail before admission', () => {
  const input = rules({ tier: 'standard', team: { minSize: 2, maxSize: 4, uniqueSpecies: true } })
  const checked = validateEnvironmentRules(input)
  checked.team.maxSize = 5
  assert.equal(input.team.maxSize, 4)
  assert.deepEqual(validateEnvironmentRules(), rules({}))
  for (const input of [rules({ tier: 'unknown-tier' }), { schemaVersion: 2 }])
    assert.throws(() => validateEnvironmentRules(input), { code: 'ENVIRONMENT_RULES_UNSUPPORTED' })
  for (const input of [
    null,
    [],
    rules({ script: 'run.js' }),
    rules({ team: { minSize: 0 } }),
    rules({ team: { maxSize: 7 } }),
    rules({ team: { minSize: 4, maxSize: 2 } }),
    rules({ team: { uniqueSpecies: 'yes' } }),
    rules({ deny: { species: ['sample:pet', 'sample:pet'] } }),
  ])
    assert.throws(() => validateEnvironmentRules(input), { code: 'ENVIRONMENT_RULES_INVALID' })
})

test('capability requirements are explicitly supported or rejected, never ignored', () => {
  assert.doesNotThrow(() => assertEnvironmentRequirements())
  assert.doesNotThrow(() => assertEnvironmentRequirements({ capabilities: [] }))
  assert.throws(() => assertEnvironmentRequirements({ capabilities: ['future-rules'] }), {
    code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
  })
  for (const input of [{ engine: '4' }, { sdk: '2' }])
    assert.throws(() => assertEnvironmentRequirements(input), { code: 'ENVIRONMENT_REQUIREMENT_UNSUPPORTED' })
  for (const input of [null, { engine: '' }, { sdk: 2 }, { capabilities: 'future' }, { command: 'execute' }])
    assert.throws(() => assertEnvironmentRequirements(input), { code: 'ENVIRONMENT_REQUIREMENT_INVALID' })
})

test('team size, species uniqueness and allow/deny policies cover all selected content', () => {
  assert.doesNotThrow(() => assertEnvironmentTeam(undefined, [pet('sample:folder/pet', { ability: '', emblem: '' })]))
  rejected(() => assertEnvironmentTeam(undefined, []))
  rejected(() =>
    assertEnvironmentTeam(
      undefined,
      Array.from({ length: 7 }, () => pet()),
    ),
  )
  rejected(() => assertEnvironmentTeam(rules({ team: { minSize: 2 } }), [pet()]))
  rejected(() => assertEnvironmentTeam(rules({ team: { maxSize: 1 } }), [pet(), pet('sample:other')]))
  rejected(() => assertEnvironmentTeam(rules({ team: { uniqueSpecies: true } }), [pet(), pet()]))
  assert.doesNotThrow(() =>
    assertEnvironmentTeam(rules({ team: { uniqueSpecies: true } }), [pet(), pet('sample:other')]),
  )
  for (const [kind, id, team] of [
    ['species', 'sample:pet', [pet()]],
    ['skills', 'sample:strike', [pet()]],
    ['marks', 'sample:ability', [pet('sample:pet', { ability: 'sample:ability' })]],
    ['marks', 'sample:emblem', [pet('sample:pet', { emblem: 'sample:emblem' })]],
  ]) {
    assert.doesNotThrow(() => assertEnvironmentTeam(rules({ allow: { [kind]: [id] } }), team))
    rejected(() => assertEnvironmentTeam(rules({ allow: { [kind]: [] } }), team))
    rejected(() => assertEnvironmentTeam(rules({ deny: { [kind]: [id] } }), team))
    rejected(() => assertEnvironmentTeam(rules({ allow: { [kind]: [id] }, deny: { [kind]: [id] } }), team))
  }
})

async function fixture(t, definition) {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-rules-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'debug/environments'), { recursive: true })
  await mkdir(join(root, 'dist'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@sample/rules-test',
      version: '1.0.0',
      files: ['dist'],
      arcadia: { formatVersion: 1, projectId: 'rules-test', namespace: 'rules-test', content: 'dist/content.json' },
    }),
  )
  await writeFile(
    join(root, 'dist/content.json'),
    JSON.stringify({ data: { species: [], skills: [], marks: [], behaviors: [] } }),
  )
  await writeFile(join(root, 'arcadia.config.mjs'), "export default { teams: ['blue', 'orange'] }\n")
  const document = {
    schemaVersion: 2,
    id: 'restricted',
    name: 'Restricted',
    packages: {},
    sources: [],
    rules: rules({}),
    requires: {},
    ...definition,
  }
  await writeFile(join(root, 'debug/environments/restricted.json'), JSON.stringify(document))
  return root
}

test('author preparation rejects unsupported environment rules and requirements', async t => {
  const root = await fixture(t, { requires: { capabilities: ['future'] } })
  await assert.rejects(prepareBattleEnvironment(root, { environmentId: 'restricted' }), {
    code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
  })
  const second = await fixture(t, { rules: rules({ tier: 'unsupported' }) })
  await assert.rejects(prepareBattleEnvironment(second, { environmentId: 'restricted' }), {
    code: 'ENVIRONMENT_RULES_UNSUPPORTED',
  })
})

test('reference and worker author battles enforce the selected frozen environment rules', async t => {
  const root = await fixture(t, { rules: rules({ deny: { species: ['sample:pet'] } }) })
  const prepared = await prepareContentPack(root, {
    environmentId: 'restricted',
    cache: join(root, '.arcadia/npm-cache'),
  })
  t.after(() => prepared.dispose())
  assert.deepEqual(prepared.environmentDocument.rules, rules({ deny: { species: ['sample:pet'] } }))
  prepared.environmentDocument.rules.deny.species = []
  const players = [
    { name: 'One', team: [pet()] },
    { name: 'Two', team: [pet()] },
  ]
  await assert.rejects(prepared.createBattle('rejected-reference', { players }), { code: 'ENVIRONMENT_TEAM_REJECTED' })
  await assert.rejects(prepared.createBattleSession('rejected-worker', { players }), {
    code: 'ENVIRONMENT_TEAM_REJECTED',
  })
})

test('the legacy default author environment keeps working with an explicit empty rule policy', async t => {
  const root = await fixture(t, {})
  const prepared = await prepareContentPack(root, { cache: join(root, '.arcadia/npm-cache') })
  t.after(() => prepared.dispose())
  assert.equal(prepared.environmentDocument.schemaVersion, 2)
  assert.equal(prepared.environmentDocument.id, 'default')
  assert.deepEqual(prepared.environmentDocument.rules, { schemaVersion: 1 })
  assert.deepEqual(prepared.environmentDocument.requires, {})
  assert.ok(prepared.environment.revision)
})
