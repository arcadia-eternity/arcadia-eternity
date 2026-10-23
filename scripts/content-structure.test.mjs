import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import YAML from 'yaml'
import { inventoryContent, planContentStructure, applyContentStructure } from './content-structure.mjs'

async function fixture(t, config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'content-structure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'data'))
  const manifest = {
    id: 'test',
    paths: { dataDir: 'data' },
    data: { species: ['species.yaml'], skills: ['skills.yaml'], marks: ['marks.yaml'] },
  }
  await writeFile(join(root, 'pack.json'), JSON.stringify(manifest) + '\n')
  const species = [
    {
      id: 'pet_a',
      learnable_skills: [{ skill_id: 'skill_shared' }, { skill_id: 'skill_a' }],
      ability: ['mark_a'],
      emblem: [],
    },
    { id: 'pet_b', learnable_skills: [{ skill_id: 'skill_shared' }], ability: [], emblem: [] },
    { id: 'pet_a2', learnable_skills: [{ skill_id: 'skill_a' }], ability: [], emblem: [] },
  ]
  const skills = [
    { id: 'skill_shared', effect: ['effect_shared'] },
    { id: 'skill_a', effect: ['effect_a'] },
    { id: 'skill_unreferenced', effect: [] },
  ]
  await writeFile(join(root, 'data/species.yaml'), YAML.stringify(species))
  await writeFile(join(root, 'data/skills.yaml'), YAML.stringify(skills))
  await writeFile(
    join(root, 'data/marks.yaml'),
    '# marker comments\n- id: mark_a\n  config: &config\n    duration: 3 # lifetime\n  effect: [effect_a]\n- id: mark_b\n  config: *config\n  effect: []\n',
  )
  const groups = {
    formatVersion: 1,
    groups: [
      { id: 'a', species: ['pet_a', 'pet_a2'] },
      { id: 'b', species: ['pet_b'] },
    ],
    ...config,
  }
  await writeFile(join(root, 'groups.yaml'), YAML.stringify(groups))
  return {
    root,
    options: {
      pack: join(root, 'pack.json'),
      groups: join(root, 'groups.yaml'),
      effectIds: ['effect_shared', 'effect_a', 'effect_unreferenced'],
    },
  }
}
async function readData(root) {
  const manifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'))
  const result = {}
  for (const kind of ['species', 'skills', 'marks']) {
    result[kind] = []
    for (const file of manifest.data[kind])
      result[kind].push(...YAML.parse(await readFile(join(root, 'data', file), 'utf8'), { merge: true }))
  }
  return result
}

test('inventory distinguishes declared ownership from exclusive and cross-family candidates', async t => {
  const { options } = await fixture(t)
  const inventory = await inventoryContent(options)
  assert.deepEqual(inventory.summary.counts, { species: 3, skills: 3, marks: 2, effects: 3 })
  assert.deepEqual(inventory.diagnostics, [])
  assert.deepEqual(
    inventory.candidates.find(item => item.id === 'skill_shared'),
    { kind: 'skills', id: 'skill_shared', groups: ['a', 'b'], status: 'multiple-groups' },
  )
  assert.equal(inventory.candidates.find(item => item.id === 'skill_a').status, 'exclusive-candidate')
  assert.equal(inventory.candidates.find(item => item.id === 'effect_unreferenced').status, 'unreferenced')
  assert.equal(inventory.records.skills.find(item => item.id === 'skill_a').owner, null)
})

test('plan and apply conserve all metadata, order and unresolved canonical sources', async t => {
  const { root, options } = await fixture(t)
  const before = await readData(root)
  const originalSkills = await readFile(join(root, 'data/skills.yaml'), 'utf8')
  const plan = planContentStructure(await inventoryContent(options))
  assert.equal(plan.summary.outputFiles, 3)
  assert.equal(plan.summary.deferredFiles, 2)
  assert.deepEqual(
    plan.writes.filter(item => item.path !== 'pack.json').map(item => item.path),
    ['data/groups/a/species.0000.yaml', 'data/groups/b/species.0001.yaml', 'data/groups/a/species.0002.yaml'],
  )
  assert.equal((await applyContentStructure(root, plan)).changed, true)
  assert.deepEqual(await readData(root), before)
  assert.equal(await readFile(join(root, 'data/skills.yaml'), 'utf8'), originalSkills)
  await assert.rejects(access(join(root, 'data/species.yaml')), { code: 'ENOENT' })
  assert.equal((await applyContentStructure(root, plan)).changed, false)
  const repeat = planContentStructure(await inventoryContent(options))
  assert.equal((await applyContentStructure(root, repeat)).changed, false)
})

test('explicit owners allow splitting YAML anchors without changing values or losing comments', async t => {
  const { root, options } = await fixture(t, { owners: { marks: { mark_a: 'a', mark_b: 'b' } } })
  const before = await readData(root)
  const inventory = await inventoryContent(options)
  const plan = planContentStructure(inventory)
  await applyContentStructure(root, plan)
  assert.deepEqual(await readData(root), before)
  const markFiles = plan.writes.filter(item => /marks\./.test(item.path))
  assert.equal(markFiles.length, 2)
  assert.match(markFiles[0].content, /marker comments/)
  assert.match(markFiles[0].content, /lifetime/)
  assert.doesNotMatch(markFiles[1].content, /\*config/)
})

test('duplicate IDs and missing references block mutation plans', async t => {
  const { root, options } = await fixture(t)
  const species = YAML.parse(await readFile(join(root, 'data/species.yaml'), 'utf8'))
  species.push({ id: 'pet_a', learnable_skills: [{ skill_id: 'missing' }] })
  await writeFile(join(root, 'data/species.yaml'), YAML.stringify(species))
  const inventory = await inventoryContent(options)
  assert.deepEqual(
    inventory.diagnostics.map(item => item.code),
    ['duplicate-id', 'missing-reference'],
  )
  assert.throws(() => planContentStructure(inventory), /resolve them before planning/)
})

test('without an effect catalog, references remain explicitly unchecked', async t => {
  const { options } = await fixture(t)
  const inventory = await inventoryContent({ ...options, effectIds: undefined })
  assert.equal(inventory.summary.effectReferencesChecked, false)
  assert.equal(inventory.summary.counts.effects, null)
  assert.deepEqual(inventory.diagnostics, [])
})

test('changed inputs and unrelated destination files fail before manifest changes', async t => {
  const { root, options } = await fixture(t)
  const plan = planContentStructure(await inventoryContent(options))
  const manifest = await readFile(join(root, 'pack.json'), 'utf8')
  await writeFile(join(root, 'data/species.yaml'), '# changed\n', { flag: 'a' })
  await assert.rejects(applyContentStructure(root, plan), /Input changed/)
  assert.equal(await readFile(join(root, 'pack.json'), 'utf8'), manifest)
  await assert.rejects(access(join(root, 'data/groups')), { code: 'ENOENT' })
  await writeFile(join(root, 'data/species.yaml'), plan.inputs.find(item => item.path === 'data/species.yaml').before)
  await mkdir(join(root, 'data/groups/a'), { recursive: true })
  await writeFile(join(root, 'data/groups/a/species.0000.yaml'), 'unrelated')
  await assert.rejects(applyContentStructure(root, plan), /Refusing to overwrite unrelated/)
  assert.equal(await readFile(join(root, 'pack.json'), 'utf8'), manifest)
  assert.equal(await readFile(join(root, 'data/groups/a/species.0000.yaml'), 'utf8'), 'unrelated')
})

test('unsafe paths and symlink destinations are rejected', async t => {
  const { root, options } = await fixture(t)
  const plan = planContentStructure(await inventoryContent(options))
  const escaped = structuredClone(plan)
  escaped.writes[0].path = '../outside.yaml'
  await assert.rejects(applyContentStructure(root, escaped), /inside the pack/)
  await symlink(tmpdir(), join(root, 'data/groups'))
  await assert.rejects(applyContentStructure(root, plan), /Symlink/)
})

test('declared cross-group references remain valid and are reported', async t => {
  const { options } = await fixture(t, { owners: { skills: { skill_shared: 'a' } } })
  const inventory = await inventoryContent(options)
  assert.deepEqual(inventory.diagnostics, [])
  assert.equal(inventory.crossGroupReferences.length, 1)
  assert.equal(inventory.crossGroupReferences[0].from, 'pet_b')
  assert.equal(inventory.crossGroupReferences[0].to, 'skill_shared')
})

test('unknown consumers prevent an effect from being proposed as exclusive to a known family', async t => {
  const { root, options } = await fixture(t)
  const marks = YAML.parse(await readFile(join(root, 'data/marks.yaml'), 'utf8'))
  marks[1].effect = ['effect_a']
  await writeFile(join(root, 'data/marks.yaml'), YAML.stringify(marks))
  const inventory = await inventoryContent(options)
  const candidate = inventory.candidates.find(item => item.id === 'effect_a')
  assert.deepEqual(candidate.groups, ['a'])
  assert.equal(candidate.status, 'unresolved-consumers')
})

test('later ownership batches preserve previously migrated paths and global order', async t => {
  const { root, options } = await fixture(t, { owners: { marks: { mark_b: 'b' } } })
  const manifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'))
  const marks = YAML.parse(await readFile(join(root, 'data/marks.yaml'), 'utf8'))
  await writeFile(join(root, 'data/marks.yaml'), YAML.stringify([marks[0]]))
  await writeFile(join(root, 'data/later-marks.yaml'), YAML.stringify([marks[1]]))
  manifest.data.marks.push('later-marks.yaml')
  await writeFile(join(root, 'pack.json'), JSON.stringify(manifest))
  const before = await readData(root)
  await applyContentStructure(root, planContentStructure(await inventoryContent(options)))
  const firstManifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'))
  const migratedPath = firstManifest.data.marks[1]
  const migratedContent = await readFile(join(root, 'data', migratedPath), 'utf8')
  const config = YAML.parse(await readFile(options.groups, 'utf8'))
  config.owners.marks.mark_a = 'a'
  await writeFile(options.groups, YAML.stringify(config))
  const next = planContentStructure(await inventoryContent(options))
  await applyContentStructure(root, next)
  assert.deepEqual(await readData(root), before)
  const finalManifest = JSON.parse(await readFile(join(root, 'pack.json'), 'utf8'))
  assert.equal(finalManifest.data.marks[1], migratedPath)
  assert.equal(await readFile(join(root, 'data', migratedPath), 'utf8'), migratedContent)
  assert.equal((await applyContentStructure(root, next)).changed, false)
})

test('a staging failure leaves all original sources and the manifest intact', async t => {
  const { root, options } = await fixture(t)
  const plan = planContentStructure(await inventoryContent(options))
  const blocked = plan.writes[1].path
  await mkdir(join(root, blocked, '..'), { recursive: true })
  await writeFile(join(root, `${blocked}.migration-${process.pid}-1`), 'unrelated temporary file')
  await assert.rejects(applyContentStructure(root, plan), { code: 'EEXIST' })
  for (const input of plan.inputs) assert.equal(await readFile(join(root, input.path), 'utf8'), input.before)
  for (const output of plan.writes.filter(output => output.path !== plan.manifest))
    await assert.rejects(access(join(root, output.path)), { code: 'ENOENT' })
})
