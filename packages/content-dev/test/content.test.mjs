import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const script = resolve(dirname(fileURLToPath(import.meta.url)), '../src/build-content.mjs')
const build = (cwd, ...args) => exec(process.execPath, [script, ...args], { cwd })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-template-content-'))
  await mkdir(join(root, 'data/skills/nested'), { recursive: true })
  await mkdir(join(root, 'data/species'))
  await writeFile(join(root, 'data/species/pet.json'), JSON.stringify({ id: 'pet', num: 1 }))
  await writeFile(join(root, 'data/skills/strike.yaml'), '# Author comment\nid: strike\npower: 40\n')
  await writeFile(join(root, 'data/skills/nested/rest.json'), JSON.stringify([{ id: 'rest', power: 1 }]))
  return root
}
test('mixed source files build a stable runtime document independently of file names and grouping', async () => {
  const root = await fixture()
  try {
    await build(root, '--check')
    await assert.rejects(access(join(root, 'dist/content.json')))
    await build(root)
    const before = await readFile(join(root, 'dist/content.json'), 'utf8')
    const content = JSON.parse(before)
    assert.deepEqual(content.data.species, [{ id: 'pet', num: 1 }])
    assert.deepEqual(
      content.data.skills.map(record => record.id),
      ['rest', 'strike'],
    )
    assert.deepEqual(content.data.marks, [])
    assert.deepEqual(content.data.behaviors, [])
    await rename(join(root, 'data/skills/strike.yaml'), join(root, 'data/skills/nested/aaa.yml'))
    await writeFile(join(root, 'data/skills/nested/rest.json'), JSON.stringify({ id: 'rest', power: 1 }))
    await build(root)
    assert.equal(await readFile(join(root, 'dist/content.json'), 'utf8'), before)
    assert.match(await readFile(join(root, 'data/skills/nested/aaa.yml'), 'utf8'), /# Author comment/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
for (const [name, source, expected] of [
  ['duplicate', 'id: strike\npower: 9\n', /Duplicate skills id strike/],
  ['missing-id', 'power: 9\n', /needs an id/],
  ['syntax', 'id: [', /Invalid content/],
  ['non-finite', 'id: bad\npower: .inf', /finite JSON-compatible/],
]) {
  test(`${name} source fails with its file path and preserves the previous build`, async () => {
    const root = await fixture()
    try {
      await build(root)
      const before = await readFile(join(root, 'dist/content.json'), 'utf8')
      await writeFile(join(root, 'data/skills/bad.yaml'), source)
      await assert.rejects(build(root), error => expected.test(error.stderr) && /bad\.yaml/.test(error.stderr))
      assert.equal(await readFile(join(root, 'dist/content.json'), 'utf8'), before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('builds separate media/locales metadata without fetching any HTTP source', async () => {
  const root = await fixture()
  try {
    const image = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    )
    await mkdir(join(root, 'assets/pets'), { recursive: true })
    await mkdir(join(root, 'locales/zh-CN'), { recursive: true })
    await writeFile(join(root, 'assets/pets/icon.png'), image)
    await writeFile(
      join(root, 'locales/zh-CN/species.yaml'),
      'pet:\n  name: 火猫\n  description: 当前体力 <heal>{hp}</heal>\n',
    )
    await mkdir(join(root, 'data/presentations'))
    await mkdir(join(root, 'data/resources'))
    await writeFile(
      join(root, 'data/resources/media.json'),
      JSON.stringify([
        { id: 'icon', kind: 'image', source: 'assets/pets/icon.png' },
        { id: 'swf', kind: 'swf', source: 'http://127.0.0.1:1/never-download.swf' },
      ]),
    )
    await writeFile(
      join(root, 'data/presentations/pet.json'),
      JSON.stringify({
        id: 'pet-display',
        target: { kind: 'species', id: 'pet' },
        icon: 'icon',
        battle: { renderer: 'seer2-swf', source: 'swf', fallback: 'icon' },
      }),
    )
    await build(root)
    const result = JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8'))
    assert.equal(result.resources.length, 2)
    assert.equal(result.resources[0].bytes, image.length)
    assert.deepEqual(result.resources[1], {
      kind: 'http',
      id: 'swf',
      source: 'http://127.0.0.1:1/never-download.swf',
      mime: 'application/x-shockwave-flash',
    })
    assert.equal(result.locales['zh-CN'].species.pet.name, '火猫')
    assert.equal(
      JSON.parse(await readFile(join(root, 'dist/content.json'), 'utf8')).data.species[0].presentation,
      undefined,
    )
    assert.equal(result.bindings[0].battle.source, 'swf')
    await build(root, '--check')
    await writeFile(
      join(root, 'data/presentations/pet.json'),
      JSON.stringify({ id: 'pet-display', target: { kind: 'species', id: 'pet' }, icon: 'missing' }),
    )
    await assert.rejects(build(root), error => /pet.json.*Missing resource/.test(error.stderr))
    assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8')), result)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('resource relocation changes display metadata only and inline legacy fields are rejected', async () => {
  const root = await fixture()
  try {
    for (const directory of ['data/resources', 'data/presentations', 'art'])
      await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, 'art/icon.png'), Buffer.from('image'))
    await writeFile(join(root, 'data/resources/icon.yaml'), 'id: icon\nkind: image\nsource: art/icon.png\n')
    await writeFile(
      join(root, 'data/presentations/pet.yaml'),
      'id: pet-display\ntarget: {kind: species, id: pet}\nicon: icon\n',
    )
    await build(root)
    const before = await readFile(join(root, 'dist/content.json'), 'utf8')
    const binding = JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8')).bindings
    await rename(join(root, 'art/icon.png'), join(root, 'art/moved.png'))
    await writeFile(join(root, 'data/resources/icon.yaml'), 'id: icon\nkind: image\nsource: art/moved.png\n')
    await build(root)
    assert.equal(await readFile(join(root, 'dist/content.json'), 'utf8'), before)
    assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8')).bindings, binding)
    await writeFile(join(root, 'data/species/pet.json'), JSON.stringify({ id: 'pet', assetRef: 'old' }))
    await assert.rejects(build(root), error => /Move presentation/.test(error.stderr))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
