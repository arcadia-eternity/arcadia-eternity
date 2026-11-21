import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertEnvironmentRequirements,
  assertEnvironmentTeam,
  prepareEnvironmentRules,
  prepareRulesForContent,
  resolveEnvironmentMechanics,
  validateEnvironmentRules,
} from '../src/environment-rules.ts'
import { readInstalledEnvironmentDocument } from '../src/prepared-document.ts'
import { prepareBattleEnvironment } from '../src/environment.ts'
import { prepareContentPack } from '../src/testing.ts'
import { PreviewAutomation } from '../src/preview-control.ts'

const pet = (species = 'sample:pet', values = {}) => ({ species, skills: ['sample:strike'], ...values })
const rules = values => ({ schemaVersion: 1, ...values })
const rejected = run => assert.throws(run, { code: 'ENVIRONMENT_TEAM_REJECTED' })

test('supported rules are copied and unsupported policies fail before admission', () => {
  const input = rules({ tier: 'standard', team: { minSize: 2, maxSize: 4, uniqueSpecies: true } })
  const checked = validateEnvironmentRules(input)
  checked.team.maxSize = 5
  assert.equal(input.team.maxSize, 4)
  assert.deepEqual(validateEnvironmentRules(), rules({}))
  for (const input of [rules({ tier: 'unknown-tier' }), { schemaVersion: 3 }])
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
  assert.doesNotThrow(() =>
    assertEnvironmentRequirements({ capabilities: ['rules.composition.v1', 'team.skill-slots.v1'] }),
  )
  assert.throws(() => assertEnvironmentRequirements({ capabilities: ['future-rules'] }), {
    code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
  })
  assert.doesNotThrow(() => assertEnvironmentRequirements({ engine: '4', sdk: '2' }))
  for (const input of [{ engine: '5' }, { sdk: '3' }])
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

test('environment rules reject rule-set references and constraint amendments', () => {
  const base = { id: 'base:cup', rules: { schemaVersion: 2, team: { maxSize: 2 } } }
  const local = { schemaVersion: 2, team: { minSize: 1 } }
  assert.deepEqual(prepareEnvironmentRules(local, [base]).rules, local)
  for (const field of [{ include: [base.id] }, { include: [] }, { constraintEdits: {} }])
    assert.throws(() => prepareEnvironmentRules({ schemaVersion: 2, ...field }, [base]), {
      code: 'ENVIRONMENT_RULES_INVALID',
    })
})

test('environment rules validate equipped skills and species enhancement eligibility', async () => {
  const { assertPlayableTeam } = await import('../src/environment-rules.ts')
  const draft = { species: 'x:a', nature: 'Hardy', level: 10, skills: ['x:other'] }
  const species = {
    id: draft.species,
    learnable_skills: [{ level: 1, skill_id: 'x:strike' }],
    enhancementBranches: ['divine'],
  }
  const check = (rules, pet) =>
    assertPlayableTeam(
      rules,
      [pet],
      () => species,
      () => ({ generation: 1 }),
      () => ({ branch: 'demonic' }),
      () => ({}),
    )
  for (const schemaVersion of [1, 2]) assert.throws(() => check({ schemaVersion }, draft), /不能学习/)
  const trained = { ...draft, skills: [], enhancement: 'x:stage' }
  assert.throws(() => check({ schemaVersion: 2, mechanics: { enhancement: { mode: 'active' } } }, trained), /强化阶段/)
  check({ schemaVersion: 1 }, trained)
  for (const mode of ['forbidden', 'suppressed'])
    check({ schemaVersion: 2, mechanics: { enhancement: { mode, stages: [mode] } } }, trained)
  assert.equal(trained.enhancement, 'x:stage')
})

test('new species inherit the environment enhancement branches at the required level', async () => {
  const { assertPlayableTeam } = await import('../src/environment-rules.ts')
  const pet = { species: 'new:pet', nature: 'Hardy', level: 100, skills: [], enhancement: 'new:stage' }
  const policy = { mode: 'active', minLevel: 100, defaultBranches: ['divine', 'demonic'] }
  const check = (branch, { level = 100, branches, enhancement = policy } = {}) =>
    assertPlayableTeam(
      { schemaVersion: 2, mechanics: { enhancement } },
      [{ ...pet, level }],
      () => ({ id: pet.species, learnable_skills: [], enhancementBranches: branches }),
      () => ({ generation: 1 }),
      () => ({ branch }),
    )
  for (const branch of policy.defaultBranches) check(branch)
  rejected(() => check('divine', { level: 99 }))
  rejected(() => check('divine', { enhancement: { ...policy, species: [] } }))
  rejected(() => check('demonic', { enhancement: { ...policy, stages: [] } }))
  assert.throws(() => check('demonic', { branches: ['divine'] }), /强化阶段/)
  assert.throws(() => check('divine', { branches: [] }), /强化阶段/)
  assert.throws(() => check('divine', { enhancement: { mode: 'active' } }), /强化阶段/)
  check('divine', { level: 99, enhancement: { ...policy, mode: 'suppressed' } })
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
    code: 'ENVIRONMENT_INVALID',
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
  const saved = { id: 'blue', version: 'a'.repeat(64), team: players[0].team }
  const control = new PreviewAutomation(prepared, { readTeams: async () => [saved] })
  t.after(() => control.close())
  const result = await control.call('team-validate', { teamId: saved.id })
  assert.equal(result.valid, false)
  assert.equal(result.teamVersion, saved.version)
  assert.equal(result.environmentId, 'restricted')
  assert.equal(result.environmentRevision, prepared.candidate.environmentRevision)
  assert.equal(result.diagnostic.code, 'ENVIRONMENT_TEAM_REJECTED')
  assert.match(result.diagnostic.message, /deny\.species.*sample:pet/)
  saved.version = 'b'.repeat(64)
  saved.team = []
  const changed = await control.call('team-validate', { teamId: saved.id })
  assert.equal(changed.teamVersion, saved.version)
  assert.match(changed.diagnostic.message, /当前为 0 只/)
  await assert.rejects(control.call('team-validate', { teamId: 'absent' }), { code: 'TEAM_MISSING' })
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

test('scopes combinations, exceptions and member quotas to the selected environment', () => {
  const pet = { species: 'pet_a', skills: ['fire', 'water'], emblem: 'ward' }
  const other = { species: 'pet_b', skills: ['ice', 'fire'] }
  const allOf = [
    { kind: 'species', ids: ['pet_a'] },
    { kind: 'skill', ids: ['ice'] },
  ]
  const rule = { id: 'custom:ice', kind: 'ban', scope: 'pet', allOf }
  const admitted = constraints => ({ schemaVersion: 2, constraints })
  assert.doesNotThrow(() => assertEnvironmentTeam(admitted([rule]), [pet, other]))
  assert.throws(() => assertEnvironmentTeam(admitted([rule]), [{ ...pet, skills: ['ice'] }]), {
    code: 'ENVIRONMENT_TEAM_REJECTED',
  })
  const teamBan = { ...rule, scope: 'team' }
  assert.throws(() => assertEnvironmentTeam(admitted([teamBan]), [pet, other]), {
    code: 'ENVIRONMENT_TEAM_REJECTED',
    detail: /custom:ice/,
  })
  const exception = { ...teamBan, exceptWhen: [{ kind: 'mark', ids: ['ward'] }] }
  assert.doesNotThrow(() => assertEnvironmentTeam(admitted([exception]), [pet, other]))
  const quota = { id: 'custom:quota', kind: 'memberLimit', max: 1, allOf: [{ kind: 'skill', ids: ['fire', 'water'] }] }
  assert.doesNotThrow(() => assertEnvironmentTeam(admitted([quota]), [pet]))
  assert.throws(() => assertEnvironmentTeam(admitted([exception, quota]), [pet, other]), {
    code: 'ENVIRONMENT_TEAM_REJECTED',
  })
  assert.throws(() => validateEnvironmentRules(admitted([rule, rule])), { code: 'ENVIRONMENT_RULES_INVALID' })
})

test('preparation expands typed collections in limits and exceptions against the selected version', async () => {
  const collection = { id: 'league:starters', kind: 'species', ids: ['sample:pet'] }
  const condition = { kind: 'species', ids: ['sample:other'], fromCollections: [collection.id] }
  const rule = { id: 'league:quota', kind: 'memberLimit', allOf: [condition], max: 1 }
  const root = { schemaVersion: 2, constraints: [rule], collections: [collection] }
  const prepared = prepareEnvironmentRules(root).rules
  assert.deepEqual(prepared.constraints[0].allOf[0], { kind: 'species', ids: ['sample:other', 'sample:pet'] })
  assert.equal(prepared.collections, undefined)
  rejected(() => assertEnvironmentTeam(prepared, [pet(), pet('sample:other')]))
  const changed = prepareEnvironmentRules({ ...root, collections: [{ ...collection, ids: ['sample:third'] }] }).rules
  assert.doesNotThrow(() => assertEnvironmentTeam(changed, [pet(), pet('sample:other')]))
  assert.throws(
    () => prepareEnvironmentRules({ ...root, collections: [{ ...collection, kind: 'skill' }] }),
    /COLLECTION_KIND/,
  )
  assert.throws(() => prepareEnvironmentRules({ schemaVersion: 2, constraints: [rule] }), /COLLECTION_MISSING/)
})

test('host slot rules classify equipped skills against captured content and preserve older formats', async () => {
  const { assertLearningChoices } = await import('../src/environment-rules.ts')
  const rules = validateEnvironmentRules({
    schemaVersion: 2,
    mechanics: { skillSlots: { normalMax: 2, climaxMax: 3, climaxMin: 1 } },
  })
  const inspect = (policy, skills) =>
    assertLearningChoices(
      policy,
      [{ species: 'cup:pet', nature: 'cup:nature', level: 100, skills }],
      () => ({ id: 'cup:pet', learnable_skills: skills.map(skill_id => ({ skill_id, level: 1 })) }),
      () => ({ generation: 1 }),
      () => undefined,
      id => (id.startsWith('climax') ? { category: 'Climax' } : { category: 'Physical' }),
    )
  assert.doesNotThrow(() => inspect(rules, ['a', 'b', 'climax-1', 'climax-2', 'climax-3']))
  assert.throws(() => inspect(rules, ['a', 'b', 'c', 'climax-1']), /普通技能最多/)
  assert.throws(() => inspect(rules, ['a']), /必杀技能至少/)
  assert.doesNotThrow(() => inspect({ schemaVersion: 1 }, ['a', 'b', 'c', 'd', 'e']))
  assert.throws(() =>
    validateEnvironmentRules({ schemaVersion: 2, mechanics: { skillSlots: { normalMax: 3, climaxMax: 3 } } }),
  )
})

test('new-pet IV defaults are configured independently of the admission limit', () => {
  const cap = { schemaVersion: 2, mechanics: { individualValues: { max: 120 } } }
  const defaults = { schemaVersion: 2, mechanics: { individualValueDefault: 60 } }
  const prepared = prepareEnvironmentRules({ schemaVersion: 2, mechanics: { ...cap.mechanics, ...defaults.mechanics } })
  assert.deepEqual(resolveEnvironmentMechanics(prepared.rules).individualValues, { max: 120, defaultValue: 60 })
  assert.equal(resolveEnvironmentMechanics(cap).individualValues.defaultValue, 31)
  assert.equal(
    resolveEnvironmentMechanics({ mechanics: { individualValues: { max: 12 } } }).individualValues.defaultValue,
    12,
  )
  assert.throws(() => prepareEnvironmentRules(defaults), /IV_DEFAULT_EXCEEDS_MAX/)
  assert.throws(() => validateEnvironmentRules(defaults), /IV_DEFAULT_EXCEEDS_MAX/)
  assertEnvironmentTeam(prepared.rules, [pet('sample:pet', { ivs: { hp: 120 } })])
})

test('a plain npm project selects one direct environment package and rejects ambiguous rules', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-npm-preset-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const base = '@arcadia-eternity/data-pack-base'
  const names = ['environment-default', 'environment-training-120']
  for (const name of names) {
    const root = join(directory, 'node_modules', name)
    await mkdir(root, { recursive: true })
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name,
        dependencies: { [base]: '4.12.0' },
        arcadiaEnvironment: {
          schemaVersion: 2,
          id: name,
          name,
          sources: [],
          rules: { schemaVersion: 2 },
          requires: {},
        },
      }),
    )
  }
  const select = dependencies => writeFile(join(directory, 'package.json'), JSON.stringify({ dependencies }))
  await select({})
  assert.equal(await readInstalledEnvironmentDocument(directory), undefined)
  await select({ [names[1]]: '^4.12.0' })
  const selected = await readInstalledEnvironmentDocument(directory)
  assert.equal(selected.id, names[1])
  assert.deepEqual(selected.packages, { [base]: '4.12.0' })
  await select(Object.fromEntries(names.map(name => [name, '^4.12.0'])))
  await assert.rejects(readInstalledEnvironmentDocument(directory), { code: 'ENVIRONMENT_PRESET_AMBIGUOUS' })
})

test('offline consumers bind prepared declarations to the captured material and its references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-applied-rules-'))
  try {
    const document = {
      schemaVersion: 2,
      id: 'custom',
      name: 'Custom',
      sources: [],
      packages: {},
      requires: {},
      rules: { schemaVersion: 2, allow: { skills: ['custom:move'] } },
    }
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name: 'editable', private: true }))
    await writeFile(
      join(directory, '.arcadia-prepared.json'),
      JSON.stringify({
        format: 'arcadia.environment-installation/1',
        installationId: 'custom',
        contentRevision: 'A',
        document,
      }),
    )
    await assert.rejects(readInstalledEnvironmentDocument(directory, 'B'), { code: 'ENVIRONMENT_PREPARATION_REQUIRED' })
    const applied = await readInstalledEnvironmentDocument(directory, 'A')
    const data = { species: [], skills: [], marks: [] }
    assert.throws(() => prepareRulesForContent(applied.rules, data), { code: 'ENVIRONMENT_REFERENCE_MISSING' })
    data.skills.push({ id: 'custom:move' })
    assert.deepEqual(prepareRulesForContent(applied.rules, data).rules.allow.skills, ['custom:move'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('battle clocks and team selection are independent environment rules and constrain roster admission', () => {
  const mechanics = {
    timer: { enabled: true, turnTimeLimit: 15, totalTimeLimit: 0 },
    teamSelection: { enabled: true, minTeamSize: 2, maxTeamSize: 3 },
  }
  const direct = { schemaVersion: 2, mechanics }
  const prepared = prepareEnvironmentRules(direct)
  assert.deepEqual(prepared.rules.mechanics, mechanics)
  assert.ok(prepared.requiredCapabilities.includes('battle.timer.v1'))
  assert.ok(prepared.requiredCapabilities.includes('battle.team-selection.v1'))
  rejected(() => assertEnvironmentTeam(prepared.rules, [pet()]))
  const changed = prepareEnvironmentRules({ ...direct, mechanics: { ...mechanics, teamSelection: { enabled: false } } })
  assert.deepEqual(changed.rules.mechanics, { timer: mechanics.timer, teamSelection: { enabled: false } })
  assert.doesNotThrow(() => assertEnvironmentTeam(changed.rules, [pet()]))
  assert.throws(() => prepareEnvironmentRules({ ...direct, team: { maxSize: 1 } }), {
    code: 'ENVIRONMENT_TEAM_SELECTION_EXCEEDS_ROSTER',
  })
  for (const invalid of [
    { timer: { enabled: true, turnTimeLimit: -1 } },
    { teamSelection: { enabled: true, minTeamSize: 4, maxTeamSize: 2 } },
    { teamSelection: { enabled: true, maxTeamSize: 7 } },
  ])
    assert.throws(() => validateEnvironmentRules({ schemaVersion: 2, mechanics: invalid }), {
      code: 'ENVIRONMENT_RULES_INVALID',
    })
})
