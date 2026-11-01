import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateDesktopRuntimeFiles, stageDesktopRuntime, verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

test('runtime layout permits edits and rejects escaping links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-stage-test-'))
  try {
    await writeFile(join(root, 'cli.js'), 'export const value = 1')
    await validateDesktopRuntimeFiles(root)
    await writeFile(join(root, 'cli.js'), 'export const value = 2')
    await validateDesktopRuntimeFiles(root)
    await symlink('../outside', join(root, 'escape'))
    await assert.rejects(validateDesktopRuntimeFiles(root), /escapes staged root/)
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

test('release verification rejects missing notices and permits local edits', async () => {
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
    }
    await writeFile(join(root, 'arcadia-desktop-runtime.json'), JSON.stringify(manifest))
    await assert.rejects(verifyDesktopRuntime(root), /cannot be released/)
    assert.equal((await verifyDesktopRuntime(root, { allowIncompleteNotices: true })).releaseReady, false)
    await writeFile(join(root, 'cli.js'), 'changed')
    await verifyDesktopRuntime(root, { allowIncompleteNotices: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('after-pack gate rejects a missing copied runtime entry', async () => {
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
      }),
    )
    const { afterPack } = await import('./verify-desktop-pack.mjs')
    const context = { appOutDir: root, packager: { getResourcesDir: () => root } }
    await afterPack(context)
    await rm(join(runtime, 'cli.js'))
    await assert.rejects(afterPack(context), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('local and preview hooks allow incomplete notices but require runtime files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-preview-pack-test-'))
  try {
    const runtime = join(root, 'arcadia-server')
    await mkdir(join(runtime, 'licenses'), { recursive: true })
    const missing = [{ name: 'example', version: '1.0.0' }]
    await writeFile(join(runtime, 'licenses/notice.json'), JSON.stringify({ missing }))
    await writeFile(join(runtime, 'cli.js'), 'export {}')
    await writeFile(
      join(runtime, 'arcadia-desktop-runtime.json'),
      JSON.stringify({
        format: 'arcadia.desktop-runtime',
        version: 1,
        releaseReady: false,
        missingLicenseTexts: missing,
      }),
    )
    const { afterPack, afterPreviewPack, previewBuilderConfiguration, requireCompleteNotices } =
      await import('./verify-desktop-pack.mjs')
    const context = { appOutDir: root, packager: { getResourcesDir: () => root } }
    const config = previewBuilderConfiguration()
    assert.match(config.productName, /Preview/)
    assert.equal(config.afterPack, afterPreviewPack)
    assert.equal(config.publish, null)
    await assert.rejects(requireCompleteNotices(runtime), /cannot be released/)
    await afterPack(context)
    await afterPreviewPack(context)
    await writeFile(join(runtime, 'cli.js'), 'changed')
    await afterPack(context)
    await afterPreviewPack(context)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
