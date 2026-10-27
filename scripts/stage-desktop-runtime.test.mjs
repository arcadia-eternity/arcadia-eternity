import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { desktopRuntimeDigest, stageDesktopRuntime, verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

test('runtime identity is relocation-independent and catches edits and escaping links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-stage-test-'))
  try {
    const first = join(root, 'a'),
      second = join(root, 'b')
    await mkdir(join(first, 'deps'), { recursive: true })
    await writeFile(join(first, 'deps/value.js'), 'export const value = 1')
    await symlink('deps/value.js', join(first, 'entry.js'))
    await cp(first, second, { recursive: true, verbatimSymlinks: true })
    const digest = await desktopRuntimeDigest(first)
    assert.equal(await desktopRuntimeDigest(second), digest)
    await writeFile(join(second, 'deps/value.js'), 'export const value = 2')
    assert.notEqual(await desktopRuntimeDigest(second), digest)
    await symlink('../../outside', join(second, 'escape'))
    await assert.rejects(desktopRuntimeDigest(second), /escapes staged root/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('staging never replaces an existing destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-stage-test-'))
  try {
    const output = join(root, 'existing')
    await mkdir(output)
    await writeFile(join(output, 'keep.txt'), 'keep')
    await assert.rejects(stageDesktopRuntime({ output }), /Output already exists/)
    assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'keep')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('release verification rejects missing notices and any change after staging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-stage-test-'))
  try {
    await mkdir(join(root, 'licenses'))
    const missing = [{ name: 'example', version: '1.0.0' }]
    await writeFile(join(root, 'licenses/notice.json'), JSON.stringify({ missing }))
    await writeFile(join(root, 'cli.js'), 'export {}')
    const manifest = {
      format: 'arcadia.desktop-runtime',
      version: 1,
      releaseReady: false,
      missingLicenseTexts: missing,
      runtimeDigest: await desktopRuntimeDigest(root),
    }
    await writeFile(join(root, 'arcadia-desktop-runtime.json'), JSON.stringify(manifest))
    await assert.rejects(verifyDesktopRuntime(root), /cannot be released/)
    assert.equal((await verifyDesktopRuntime(root, { allowIncompleteNotices: true })).releaseReady, false)
    await writeFile(join(root, 'cli.js'), 'changed')
    await assert.rejects(verifyDesktopRuntime(root, { allowIncompleteNotices: true }), /differ/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('after-pack gate rejects missing or changed copied runtime files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-pack-test-'))
  try {
    const runtime = join(root, 'arcadia-server')
    await mkdir(join(runtime, 'licenses'), { recursive: true })
    await writeFile(join(runtime, 'licenses/notice.json'), JSON.stringify({ missing: [] }))
    await writeFile(join(runtime, 'cli.js'), 'export {}')
    await writeFile(
      join(runtime, 'arcadia-desktop-runtime.json'),
      JSON.stringify({
        format: 'arcadia.desktop-runtime',
        version: 1,
        releaseReady: true,
        missingLicenseTexts: [],
        runtimeDigest: await desktopRuntimeDigest(runtime),
      }),
    )
    const { afterPack } = await import('./verify-desktop-pack.mjs')
    const context = { appOutDir: root, packager: { getResourcesDir: () => root } }
    await afterPack(context)
    await rm(join(runtime, 'cli.js'))
    await assert.rejects(afterPack(context), /differ/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
