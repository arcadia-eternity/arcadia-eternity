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
    await writeFile(
      join(root, 'data/species/pet.json'),
      JSON.stringify({
        id: 'pet',
        presentation: {
          icon: 'assets/pets/icon.png',
          battle: {
            renderer: 'seer2-swf',
            source: 'http://127.0.0.1:1/never-download.swf',
            fallback: 'assets/pets/icon.png',
          },
        },
      }),
    )
    await build(root)
    const result = JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8'))
    assert.equal(result.resources.length, 2)
    assert.equal(result.resources[0].bytes, image.length)
    assert.deepEqual(result.resources[1], {
      kind: 'http',
      id: 'http://127.0.0.1:1/never-download.swf',
      source: 'http://127.0.0.1:1/never-download.swf',
      mime: 'application/x-shockwave-flash',
    })
    assert.equal(result.locales['zh-CN'].species.pet.name, '火猫')
    assert.equal(
      JSON.parse(await readFile(join(root, 'dist/content.json'), 'utf8')).data.species[0].presentation.battle.renderer,
      'seer2-swf',
    )
    await build(root, '--check')
    await writeFile(
      join(root, 'data/species/pet.json'),
      JSON.stringify({ id: 'pet', presentation: { icon: 'assets/missing.png' } }),
    )
    await assert.rejects(build(root), error => /pet.json.*Missing resource/.test(error.stderr))
    assert.deepEqual(JSON.parse(await readFile(join(root, 'dist/presentation.json'), 'utf8')), result)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
