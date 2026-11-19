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

test('local restrictions replace each inherited field and retain its provenance', () => {
  const base = {
    id: 'base:cup',
    rules: {
      schemaVersion: 2,
      team: { maxSize: 3, uniqueSpecies: true },
      deny: { species: ['x:a'] },
      allow: { skills: ['x:s1'] },
    },
  }
  const local = {
    schemaVersion: 2,
    include: [base.id],
    team: { maxSize: 6 },
    deny: { species: [] },
    allow: { skills: ['x:s1', 'x:s2'] },
  }
  const result = prepareEnvironmentRules(local, [base])
  assert.deepEqual(result.rules.team, { maxSize: 6, uniqueSpecies: true })
  assert.deepEqual(result.rules.allow, local.allow)
  assert.deepEqual(result.rules.deny, local.deny)
  assert.deepEqual(result.fields.find(field => field.path.join('.') === 'team.maxSize').effectiveSources, [
    '$environment',
  ])
  assert.deepEqual(result.requiredCapabilities, ['rules.composition.v1'])
  assert.throws(() => prepareEnvironmentRules(local, [base], { engine: '4', sdk: '2', capabilities: [] }), {
    code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
  })
})

test('plain and composed environments validate equipped skills and species enhancement eligibility', async () => {
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
  const ruleSets = ['forbidden', 'suppressed'].map(mode => ({
    id: 'x:' + mode,
    rules: { schemaVersion: 2, mechanics: { enhancement: { mode, stages: [mode] } } },
  }))
  for (const policy of [{ schemaVersion: 1 }, ...ruleSets.map(row => row.rules)]) check(policy, trained)
  const combined = prepareEnvironmentRules({ schemaVersion: 2, include: ruleSets.map(row => row.id) }, ruleSets)
  assert.equal(combined.rules.mechanics.enhancement.mode, 'suppressed')
  assert.equal(trained.enhancement, 'x:stage')
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
  assert.throws(() => assertEnvironmentTeam(admitted([teamBan]), [pet, other]), { code: 'ENVIRONMENT_TEAM_REJECTED' })
  const exception = { ...teamBan, exceptWhen: [{ kind: 'mark', ids: ['ward'] }] }
  assert.doesNotThrow(() => assertEnvironmentTeam(admitted([exception]), [pet, other]))
  const quota = { id: 'custom:quota', kind: 'memberLimit', max: 1, allOf: [{ kind: 'skill', ids: ['fire', 'water'] }] }
  assert.doesNotThrow(() => assertEnvironmentTeam(admitted([quota]), [pet]))
  assert.throws(() => assertEnvironmentTeam(admitted([exception, quota]), [pet, other]), {
    code: 'ENVIRONMENT_TEAM_REJECTED',
  })
  assert.throws(() => validateEnvironmentRules(admitted([rule, rule])), { code: 'ENVIRONMENT_RULES_INVALID' })
})

test('locked rule sets compose diamonds, report both sides of a conflict, and keep room rules portable', async () => {
  const { prepareEnvironmentRules } = await import('../src/environment-rules.ts')
  const rules = (include, local = {}) => ({ schemaVersion: 2, include, ...local })
  const cell = multiplier => ({
    matchups: { adjustments: [{ attack: 'crystal:type', defense: 'sound:type', multiplier }] },
  })
  const base = {
    id: 'base:common',
    rules: rules([], { mechanics: { individualValues: { max: 31 } }, allow: { skills: ['a', 'b', 'c'] } }),
  }
  const left = {
    id: 'crystal:cup',
    rules: rules([base.id], { ...cell(2), allow: { skills: ['a', 'c'] }, team: { maxSize: 5 } }),
  }
  const right = {
    id: 'sound:cup',
    rules: rules([base.id], { ...cell(0.5), allow: { skills: ['b', 'c'] }, team: { maxSize: 3 } }),
  }
  const catalog = [base, left, right]
  const mix = { id: 'mod:mix', rules: rules([left.id, right.id]) }
  assert.throws(() => prepareEnvironmentRules(mix.rules, catalog), /crystal:cup.*sound:cup/)
  const root = rules([mix.id], cell(0))
  const resolved = prepareEnvironmentRules(root, [...catalog, mix])
  assert.deepEqual(resolved, prepareEnvironmentRules(root, [mix, ...catalog.reverse()]))
  assert.deepEqual(resolved.rules.allow.skills, ['c'])
  assert.equal(resolved.rules.team.maxSize, 3)
  assert.equal(resolved.rules.mechanics.individualValues.max, 31)
  assert.equal(resolved.rules.matchups.adjustments[0].multiplier, 0)
  assert.deepEqual(resolved.fields.find(f => f.path.includes('adjustments')).effectiveSources, ['$environment'])
  assert.deepEqual(resolved.fields.find(f => f.path.includes('adjustments')).sources, [
    '$environment',
    left.id,
    right.id,
  ])
  assert.deepEqual(validateEnvironmentRules(resolved.rules), resolved.rules)
  assert.throws(() => validateEnvironmentRules(root), /RULES_INVALID/)
  assert.throws(() => prepareEnvironmentRules(root, catalog), /RULE_SET_MISSING.*mod:mix/)
  assert.throws(() => prepareEnvironmentRules(root, [{ ...mix, rules: rules([mix.id]) }]), /RULE_CYCLE.*mod:mix/)
})

test('constraint amendments bind exceptions to their declared ban and explicitly handle replaced targets', async () => {
  const { prepareEnvironmentRules } = await import('../src/environment-rules.ts')
  const condition = (kind, ...ids) => ({ kind, ids })
  const ban = { id: 'cup:ban', kind: 'ban', scope: 'team', allOf: [condition('skill', 'sample:strike')] }
  const base = { id: 'cup:base', rules: { schemaVersion: 2, constraints: [ban] } }
  const exception = { target: ban.id, allOf: [condition('species', 'sample:pet')] }
  const narrow = {
    id: 'cup:narrow',
    rules: { schemaVersion: 2, include: [base.id], constraintEdits: { exceptions: [exception] } },
  }
  const data = [base, narrow]
  const prepare = changes =>
    prepareEnvironmentRules(
      {
        schemaVersion: 2,
        include: [narrow.id],
        constraintEdits: changes,
      },
      data,
    ).rules
  assert.doesNotThrow(() => assertEnvironmentTeam(prepare({}), [pet()]))
  rejected(() => assertEnvironmentTeam(prepare({}), [pet('sample:other')]))
  assert.throws(() => prepare({ remove: [ban.id] }), /EXCEPTION_DANGLING/)
  assert.throws(() => prepare({ replace: [{ ...ban, scope: 'pet' }] }), /EXCEPTION_DANGLING/)
  assert.throws(() => prepare({ exceptions: [{ ...exception, target: 'missing' }] }), /TARGET_MISSING/)
  const cleared = prepare({ clearExceptions: [ban.id], replace: [{ ...ban, scope: 'pet' }] })
  rejected(() => assertEnvironmentTeam(cleared, [pet()]))
  assert.equal(prepare({ clearExceptions: [ban.id], remove: [ban.id] }).constraints, undefined)
  assert.throws(
    () => prepareEnvironmentRules({ schemaVersion: 2, include: [base.id], constraints: [ban] }, data),
    /ALREADY_EXISTS/,
  )
})

test('preparation expands typed collections in limits and exceptions against the selected version', async () => {
  const { prepareEnvironmentRules } = await import('../src/environment-rules.ts')
  const collection = { id: 'league:starters', kind: 'species', ids: ['sample:pet'] }
  const condition = { kind: 'species', ids: ['sample:other'], fromCollections: [collection.id] }
  const rule = { id: 'league:quota', kind: 'memberLimit', allOf: [condition], max: 1 }
  const base = { id: 'league:cup', rules: { schemaVersion: 2, constraints: [rule], collections: [collection] } }
  const root = { schemaVersion: 2, include: [base.id] }
  const prepared = prepareEnvironmentRules(root, [base]).rules
  assert.deepEqual(prepared.constraints[0].allOf[0], { kind: 'species', ids: ['sample:other', 'sample:pet'] })
  assert.equal(prepared.collections, undefined)
  rejected(() => assertEnvironmentTeam(prepared, [pet(), pet('sample:other')]))
  const changed = prepareEnvironmentRules({ ...root, collections: [{ ...collection, ids: ['sample:third'] }] }, [
    base,
  ]).rules
  assert.doesNotThrow(() => assertEnvironmentTeam(changed, [pet(), pet('sample:other')]))
  assert.throws(
    () => prepareEnvironmentRules({ ...root, collections: [{ ...collection, kind: 'skill' }] }, [base]),
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

test('new-pet IV defaults inherit independently of the admission limit', () => {
  const cap = { id: 'sample:cap', rules: { schemaVersion: 2, mechanics: { individualValues: { max: 120 } } } }
  const defaults = { id: 'sample:start', rules: { schemaVersion: 2, mechanics: { individualValueDefault: 60 } } }
  const prepared = prepareEnvironmentRules({ schemaVersion: 2, include: [cap.id, defaults.id] }, [cap, defaults])
  assert.deepEqual(resolveEnvironmentMechanics(prepared.rules).individualValues, { max: 120, defaultValue: 60 })
  assert.equal(resolveEnvironmentMechanics(cap.rules).individualValues.defaultValue, 31)
  assert.equal(
    resolveEnvironmentMechanics({ mechanics: { individualValues: { max: 12 } } }).individualValues.defaultValue,
    12,
  )
  assert.throws(
    () => prepareEnvironmentRules({ schemaVersion: 2, include: [defaults.id] }, [defaults]),
    /IV_DEFAULT_EXCEEDS_MAX/,
  )
  assert.throws(() => validateEnvironmentRules(defaults.rules), /IV_DEFAULT_EXCEEDS_MAX/)
  assertEnvironmentTeam(prepared.rules, [pet('sample:pet', { ivs: { hp: 120 } })])
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
