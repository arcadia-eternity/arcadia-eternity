import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { validateDesktopRuntimeFiles, stageDesktopRuntime, verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

// File-layout fixture only. Real native execution has a separate Electron smoke.
async function nativeLayout(runtime) {
  const module = join(runtime, 'node_modules/better-sqlite3')
  await mkdir(join(module, 'build/Release'), { recursive: true })
  await writeFile(join(module, 'package.json'), JSON.stringify({ name: 'better-sqlite3', version: '12.11.1' }))
  await writeFile(join(module, 'build/Release/better_sqlite3.node'), 'layout-fixture')
  const file = join(runtime, 'arcadia-desktop-runtime.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.electron = { version: '41.10.7', abi: '145', platform: process.platform, arch: process.arch }
  manifest.nativeModules = [
    {
      name: 'better-sqlite3',
      version: '12.11.1',
      electronVersion: '41.10.7',
      abi: '145',
      platform: process.platform,
      arch: process.arch,
      verified: true,
      smoke: 'write-close-reopen',
    },
  ]
  await writeFile(file, JSON.stringify(manifest))
}

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

test('native gate requires a target, consistent metadata and copied runtime entries', async () => {
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
    await assert.rejects(afterPack(context), /explicit supported platform/)
    await assert.rejects(verifyDesktopRuntime(runtime, { requireNative: true }), /SQLite target is missing/)
    await nativeLayout(runtime)
    await verifyDesktopRuntime(runtime, { requireNative: true })
    await assert.rejects(
      verifyDesktopRuntime(runtime, { requireNative: true, platform: 'wrong-platform' }),
      /SQLite target is missing/,
    )
    const manifestFile = join(runtime, 'arcadia-desktop-runtime.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    manifest.nativeModules[0].version = '0.0.0'
    await writeFile(manifestFile, JSON.stringify(manifest))
    await assert.rejects(verifyDesktopRuntime(runtime, { requireNative: true }), /recorded package version/)
    await nativeLayout(runtime)
    await rm(join(runtime, 'cli.js'))
    await assert.rejects(verifyDesktopRuntime(runtime, { requireNative: true }), /ENOENT/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('preview configuration uses actual package hooks and local validation permits incomplete notices', async () => {
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
    await nativeLayout(runtime)
    const context = { appOutDir: root, packager: { getResourcesDir: () => root } }
    const config = previewBuilderConfiguration()
    assert.match(config.productName, /Preview/)
    assert.equal(config.afterPack, afterPreviewPack)
    assert.equal(config.publish, null)
    const isolated = previewBuilderConfiguration({ webDist: join(root, 'web'), runtime })
    await mkdir(join(root, 'web'))
    await writeFile(join(root, 'web/index.html'), '<!doctype html>')
    assert.equal(isolated.files[0].from, join(root, 'web'))
    assert.equal(isolated.extraResources[0].from, runtime)
    await isolated.beforePack()
    await assert.rejects(requireCompleteNotices(runtime), /cannot be released/)
    await assert.rejects(afterPack(context), /explicit supported platform/)
    await assert.rejects(afterPreviewPack(context), /explicit supported platform/)
    await verifyDesktopRuntime(runtime, { requireNative: true, allowIncompleteNotices: true })
    await writeFile(join(runtime, 'cli.js'), 'changed')
    await verifyDesktopRuntime(runtime, { requireNative: true, allowIncompleteNotices: true })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('isolated renderer input is copied into a disposable application directory and rejects links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'arcadia-preview-input-'))
  try {
    const source = join(root, 'source'),
      temporaryParent = join(root, 'application')
    await mkdir(source)
    await writeFile(join(source, 'index.html'), '<!doctype html><title>final snapshot</title>')
    const { preparePreviewInputs } = await import('./verify-desktop-pack.mjs')
    const prepared = await preparePreviewInputs({ webDist: source, runtime: '/selected/runtime' }, { temporaryParent })
    assert.ok(prepared.inputs.webDist.startsWith(temporaryParent))
    assert.equal(prepared.inputs.runtime, '/selected/runtime')
    assert.equal(
      await readFile(join(prepared.inputs.webDist, 'index.html'), 'utf8'),
      await readFile(join(source, 'index.html'), 'utf8'),
    )
    await prepared.cleanup()
    await assert.rejects(readFile(join(prepared.inputs.webDist, 'index.html')), { code: 'ENOENT' })
    await symlink(join(source, 'index.html'), join(source, 'linked.html'), 'file')
    await assert.rejects(preparePreviewInputs({ webDist: source }, { temporaryParent }), /not symbolic links/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
