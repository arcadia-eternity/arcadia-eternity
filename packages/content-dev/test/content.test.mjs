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
