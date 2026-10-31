import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
const exec = promisify(execFile)
const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url))
test('CLI checks, builds and packs from the caller directory, with type errors failing the command', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-content-cli-'))
  try {
    await mkdir(join(root, 'data/skills'), { recursive: true })
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'data/skills/one.yaml'), 'id: one\n')
    await writeFile(join(root, 'src/effects.ts'), 'export const amount: number = 25\n')
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          types: [],
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: '@test/content-tool', version: '1.0.0', files: ['data', 'dist', 'src'] }),
    )
    const run = (...args) => exec(process.execPath, [cli, ...args], { cwd: root })
    await run('check')
    await assert.rejects(readFile(join(root, 'dist/effects.js')))
    await run('build')
    assert.match(await readFile(join(root, 'dist/effects.js'), 'utf8'), /amount = 25/)
    assert.equal(JSON.parse(await readFile(join(root, 'dist/content.json'), 'utf8')).data.skills[0].id, 'one')
    await run('pack')
    assert.ok((await readFile(join(root, 'test-content-tool-1.0.0.tgz'))).length > 0)
    await writeFile(join(root, 'src/effects.ts'), 'export const amount: number = "invalid"\n')
    await assert.rejects(run('check'), error => /TS2322/.test(error.stdout))
    await assert.rejects(run('build'), error => /TS2322/.test(error.stdout))
    await assert.rejects(run('pack'), error => /TS2322/.test(error.stdout))
    await assert.rejects(run('build', '--unknown'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('pack checks the generated presentation entry and refuses missing npm media files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-content-media-pack-'))
  try {
    await mkdir(join(root, 'data/species'), { recursive: true })
    await mkdir(join(root, 'assets'))
    await mkdir(join(root, 'locales/zh-CN'), { recursive: true })
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'src/index.ts'), 'export {}\n')
    await writeFile(
      join(root, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          outDir: 'dist',
          rootDir: 'src',
          strict: true,
          types: [],
        },
        include: ['src/**/*.ts'],
      }),
    )
    await writeFile(join(root, 'assets/icon.png'), Buffer.from('image'))
    await writeFile(join(root, 'data/species/pet.yaml'), 'id: pet\n')
    await mkdir(join(root, 'data/presentations'))
    await mkdir(join(root, 'data/resources'))
    await writeFile(
      join(root, 'data/presentations/pet.yaml'),
      'id: pet-display\ntarget: {kind: species, id: pet}\nicon: icon\n',
    )
    await writeFile(join(root, 'data/resources/icon.yaml'), 'id: icon\nkind: image\nsource: assets/icon.png\n')
    await writeFile(join(root, 'locales/zh-CN/species.yaml'), 'pet:\n  name: 精灵\n')
    const manifest = {
      name: '@test/media-pack',
      version: '1.0.0',
      files: ['dist'],
      arcadia: { formatVersion: 1, projectId: 'media', namespace: 'media', content: 'dist/content.json' },
    }
    const save = () => writeFile(join(root, 'package.json'), JSON.stringify(manifest))
    const run = (...args) => exec(process.execPath, [cli, ...args], { cwd: root })
    await save()
    await assert.rejects(run('pack'), error => /arcadia.presentation/.test(error.stderr))
    manifest.arcadia.presentation = 'dist/presentation.json'
    await save()
    await assert.rejects(run('pack'), error => /omits required.*assets\/icon.png/.test(error.stderr))
    manifest.files.push('assets', 'locales')
    await save()
    await run('pack')
    assert.ok((await readFile(join(root, 'test-media-pack-1.0.0.tgz'))).length > 0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
