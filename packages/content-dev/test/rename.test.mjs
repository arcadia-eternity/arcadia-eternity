import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import YAML from 'yaml'
const exec = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '../src/rename.mjs')
const files = ['package.json', 'data/skills/strike.yaml', 'data/skills/nested/rest.json']

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'arcadia-template-rename-'))
  await mkdir(join(dir, 'data/skills/nested'), { recursive: true })
  const manifest = {
    name: '@template/pack',
    private: true,
    arcadia: { projectId: 'old-pack', namespace: 'old-pack' },
  }
  const skill = id => ({
    id,
    behaviors: [
      { definitionId: { $ref: { projectId: 'old-pack', kind: 'behavior', id: 'apply-slow' } } },
      { definitionId: { $ref: { projectId: 'another-pack', kind: 'behavior', id: 'external' } } },
    ],
  })
  await writeFile(join(dir, files[0]), JSON.stringify(manifest))
  await writeFile(
    join(dir, files[1]),
    '# Keep this author comment.\n' +
      YAML.stringify(skill('strike')).replace('projectId: old-pack', 'projectId: old-pack # local identity'),
  )
  await writeFile(join(dir, files[2]), JSON.stringify([skill('rest')]))
  return dir
}
const readAll = dir => Promise.all(files.map(file => readFile(join(dir, file), 'utf8')))

test('renaming rewrites split JSON/YAML references, preserves comments and leaves foreign identities unchanged', async () => {
  const dir = await fixture()
  try {
    await exec(process.execPath, [script, '--name', '@me/frost', '--project-id', 'my-frost', '--namespace', 'frost'], {
      cwd: dir,
    })
    const [packageText, yamlText, jsonText] = await readAll(dir)
    const manifest = JSON.parse(packageText)
    assert.equal(manifest.name, '@me/frost')
    assert.equal(manifest.arcadia.projectId, 'my-frost')
    assert.equal(manifest.arcadia.namespace, 'frost')
    assert.equal(manifest.private, true)
    for (const skill of [YAML.parse(yamlText), ...JSON.parse(jsonText)])
      assert.deepEqual(
        skill.behaviors.map(b => b.definitionId.$ref.projectId),
        ['my-frost', 'another-pack'],
      )
    assert.match(yamlText, /# Keep this author comment\./)
    assert.match(yamlText, /projectId: my-frost # local identity/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
for (const namespace of ['base', '../outside', 'Invalid']) {
  test(`invalid namespace ${namespace} fails before modifying source files`, async () => {
    const dir = await fixture()
    try {
      const before = await readAll(dir)
      await assert.rejects(
        exec(process.execPath, [script, '--name', '@me/frost', '--project-id', 'my-frost', '--namespace', namespace], {
          cwd: dir,
        }),
      )
      assert.deepEqual(await readAll(dir), before)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
test('a malformed source file leaves the package identity and all valid sources untouched', async () => {
  const dir = await fixture()
  try {
    const before = await readAll(dir)
    await writeFile(join(dir, 'data/skills/broken.yaml'), 'id: [')
    await assert.rejects(
      exec(process.execPath, [script, '--name', '@me/frost', '--project-id', 'my-frost', '--namespace', 'frost'], {
        cwd: dir,
      }),
      /broken\.yaml/,
    )
    assert.deepEqual(await readAll(dir), before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('shared YAML anchors do not change content IDs or unrelated fields during project renaming', async () => {
  const dir = await fixture()
  try {
    await writeFile(
      join(dir, files[1]),
      `id: &local old-pack # keep identity note
reference: &reference
  projectId: *local
  kind: behavior
  id: apply-slow
behaviors:
  - definitionId:
      $ref: *reference
`,
    )
    await exec(process.execPath, [script, '--name', '@me/frost', '--project-id', 'my-frost', '--namespace', 'frost'], {
      cwd: dir,
    })
    const text = await readFile(join(dir, files[1]), 'utf8')
    const record = YAML.parse(text)
    assert.equal(record.behaviors[0].definitionId.$ref.projectId, 'my-frost')
    assert.equal(record.id, 'old-pack')
    assert.equal(record.reference.projectId, 'old-pack')
    assert.match(text, /# keep identity note/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test(
  'renaming a real template updates portable team references and keeps foreign references and comments',
  { timeout: 30000 },
  async t => {
    const { createSourceProject } = await import('../src/author-api.mjs')
    const { prepareContentPack } = await import('../src/testing.mjs')
    const { setGlobalLogger } = await import('@arcadia-eternity/battle/v4')
    setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} })
    const root = await mkdtemp(join(tmpdir(), 'arcadia-team-rename-'))
    const project = join(root, 'project')
    let prepared
    t.after(async () => {
      await prepared?.dispose()
      await rm(root, { recursive: true, force: true })
    })
    await createSourceProject(project, 'before-rename')
    const blue = YAML.parse(await readFile(join(project, 'debug/teams/blue.yaml'), 'utf8'))
    const custom = structuredClone(blue)
    custom.id = 'foreign-references'
    custom.team[0].name = 'before-rename:pet'
    custom.team[0].skills.push('foreign:skill')
    custom.team[0].ability = 'foreign:trait'
    custom.team[0].emblem = 'before-rename:emblem'
    const customFile = join(project, 'debug/teams/foreign-references.yaml')
    await writeFile(customFile, '# keep team comment\n' + YAML.stringify(custom))
    await exec(
      process.execPath,
      [script, '--name', '@me/renamed', '--project-id', 'renamed', '--namespace', 'renamed'],
      { cwd: project },
    )
    const renamed = YAML.parse(await readFile(customFile, 'utf8'))
    assert.match(await readFile(customFile, 'utf8'), /# keep team comment/)
    assert.equal(renamed.id, custom.id)
    assert.equal(renamed.team[0].name, 'before-rename:pet')
    assert.equal(renamed.team[0].species, 'renamed:pet')
    assert.deepEqual(renamed.team[0].skills, ['renamed:strike', 'renamed:rest', 'foreign:skill'])
    assert.equal(renamed.team[0].ability, 'foreign:trait')
    assert.equal(renamed.team[0].emblem, 'renamed:emblem')
    await exec(process.execPath, [fileURLToPath(new URL('../src/cli.mjs', import.meta.url)), 'build'], { cwd: project })
    prepared = await prepareContentPack(project)
    assert.equal(prepared.defaultPlayers()[0].team[0].species, 'renamed:pet')
    await prepared.createBattle('renamed-team')
  },
)
