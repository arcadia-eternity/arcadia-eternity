import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import fs, { mkdtemp, mkdir, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import os, { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { validateDesktopRuntimeFiles, stageDesktopRuntime, verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

// File-layout fixture only. Real native execution has a separate Electron smoke.
async function nativeLayout(runtime, { platform = process.platform, arch = process.arch } = {}) {
  const module = join(runtime, 'node_modules/better-sqlite3')
  await mkdir(join(module, 'build/Release'), { recursive: true })
  await writeFile(join(module, 'package.json'), JSON.stringify({ name: 'better-sqlite3', version: '12.11.1' }))
  await writeFile(join(module, 'build/Release/better_sqlite3.node'), 'layout-fixture')
  const file = join(runtime, 'arcadia-desktop-runtime.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.electron = { version: '41.10.7', abi: '145', platform, arch }
  manifest.nativeModules = [
    {
      name: 'better-sqlite3',
      version: '12.11.1',
      electronVersion: '41.10.7',
      abi: '145',
      platform,
      arch,
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
      temporaryParent = join(root, 'application'),
      selectedRuntime = join(root, 'selected', 'runtime')
    await mkdir(source)
    await writeFile(join(source, 'index.html'), '<!doctype html><title>final snapshot</title>')
    const { preparePreviewInputs, writePreviewConfiguration } = await import('./verify-desktop-pack.mjs')
    const prepared = await preparePreviewInputs({ webDist: source, runtime: selectedRuntime }, { temporaryParent })
    assert.ok(prepared.inputs.webDist.startsWith(temporaryParent))
    assert.equal(resolve(prepared.inputs.runtime), resolve(selectedRuntime))
    const configuration = await writePreviewConfiguration(prepared)
    const { default: complete } = await import(pathToFileURL(configuration).href)
    assert.equal(complete.extraResources.length, 2, 'complete config does not append inherited runtime copies')
    assert.equal(complete.extraResources[0].from, resolve(selectedRuntime))
    assert.equal(complete.files.length, 3, 'complete config replaces the default renderer input')
    assert.equal(complete.files[0].from, prepared.inputs.webDist)
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

async function copiedWindowsRuntime(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'arcadia-builder-links-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'staged')
  const appOutDir = join(root, 'application')
  const runtime = join(appOutDir, 'resources', 'arcadia-server')
  const packagePath = 'node_modules/.pnpm/css-calc@2.1.4/node_modules/@csstools/css-calc'
  const linkPath = 'node_modules/.pnpm/css-color@3.2.0/node_modules/@csstools/css-calc'
  await mkdir(join(source, packagePath), { recursive: true })
  await mkdir(dirname(join(source, linkPath)), { recursive: true })
  await mkdir(join(source, 'licenses'))
  await writeFile(join(source, packagePath, 'index.js'), 'package-local material')
  await writeFile(join(source, 'cli.js'), 'export {}')
  await writeFile(join(source, 'licenses/notice.json'), JSON.stringify({ missing: [] }))
  await writeFile(
    join(source, 'arcadia-desktop-runtime.json'),
    JSON.stringify({ format: 'arcadia.desktop-runtime', version: 1, releaseReady: true, missingLicenseTexts: [] }),
  )
  await nativeLayout(source, { platform: 'win32', arch: 'x64' })
  await symlink(relative(dirname(join(source, linkPath)), join(source, packagePath)), join(source, linkPath), 'dir')
  await verifyDesktopRuntime(source, { requireNative: true })

  const webRequire = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
  const builderRequire = createRequire(webRequire.resolve('electron-builder'))
  const appRequire = createRequire(builderRequire.resolve('app-builder-lib'))
  const { copyDir } = appRequire('builder-util/out/fs.js')
  const nativeSymlink = fs.symlink
  // Exercise the installed Builder copier, including its actual win32 branch.
  // On Windows this uses real NTFS junctions. On POSIX simulate only Node's
  // preprocessSymlinkDestination: junction targets resolve at the link parent.
  const platformMock = mock.method(os, 'platform', () => 'win32')
  const junctionMock =
    process.platform === 'win32'
      ? undefined
      : mock.method(fs, 'symlink', (target, path, type) => {
          assert.equal(type, 'junction')
          return nativeSymlink(resolve(path, '..', target), path, 'dir')
        })
  try {
    await copyDir(source, runtime, { isUseHardLink: () => false })
  } finally {
    junctionMock?.mock.restore()
    platformMock.mock.restore()
  }
  return { root, source, appOutDir, runtime, packagePath, linkPath }
}

test('Windows Builder junction copies keep package-local targets and survive source removal and package relocation', async t => {
  const { root, source, appOutDir, runtime, packagePath, linkPath } = await copiedWindowsRuntime(t)
  const link = join(runtime, linkPath)
  assert.equal(isAbsolute(await readlink(join(source, linkPath))), false)
  assert.equal(isAbsolute(await readlink(link)), true)
  assert.equal(await realpath(link), await realpath(join(runtime, packagePath)))
  assert.notEqual(await realpath(link), await realpath(join(source, packagePath)))
  await assert.rejects(verifyDesktopRuntime(runtime, { requireNative: true }), /escapes staged root/)
  const { verifyPackagedRuntimeFiles } = await import('./verify-desktop-pack.mjs')
  await verifyPackagedRuntimeFiles(runtime, {
    platform: 'win32',
    arch: 'x64',
    appOutDir: process.platform === 'win32' ? appOutDir.toUpperCase() : appOutDir,
  })
  assert.equal(isAbsolute(await readlink(link)), false)
  assert.equal(await realpath(link), await realpath(join(runtime, packagePath)))
  assert.equal(await readFile(join(source, packagePath, 'index.js'), 'utf8'), 'package-local material')
  const moved = join(root, 'relocated-application')
  await rm(source, { recursive: true })
  await rename(appOutDir, moved)
  await assert.rejects(readFile(join(source, packagePath, 'index.js')), { code: 'ENOENT' })
  await assert.rejects(readFile(join(runtime, packagePath, 'index.js')), { code: 'ENOENT' })
  const relocated = join(moved, 'resources', 'arcadia-server')
  assert.equal(await readFile(join(relocated, linkPath, 'index.js'), 'utf8'), 'package-local material')
  await verifyDesktopRuntime(relocated, { requireNative: true })
})

test('Windows copied links to staging or missing targets reject before any valid junction changes', async t => {
  const { source, appOutDir, runtime, packagePath, linkPath } = await copiedWindowsRuntime(t)
  const original = await readlink(join(runtime, linkPath))
  const unsafe = join(runtime, 'z-unsafe')
  const { verifyPackagedRuntimeFiles } = await import('./verify-desktop-pack.mjs')
  for (const [target, code] of [
    [join(source, packagePath), 'RUNTIME_LINK_ESCAPE'],
    [join(runtime, 'missing-package'), 'RUNTIME_LINK_UNRESOLVED'],
  ]) {
    await symlink(target, unsafe, process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(verifyPackagedRuntimeFiles(runtime, { platform: 'win32', arch: 'x64', appOutDir }), { code })
    assert.equal(await readlink(join(runtime, linkPath)), original)
    assert.equal(await readFile(join(source, packagePath, 'index.js'), 'utf8'), 'package-local material')
    await rm(unsafe)
  }
})

test('Windows package roots and parents cannot redirect normalization outside application output', async t => {
  const { root, appOutDir, runtime, linkPath } = await copiedWindowsRuntime(t)
  const original = await readlink(join(runtime, linkPath))
  const { verifyPackagedRuntimeFiles } = await import('./verify-desktop-pack.mjs')
  const alias = join(root, 'linked-application')
  await symlink(appOutDir, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    verifyPackagedRuntimeFiles(join(alias, 'resources', 'arcadia-server'), {
      platform: 'win32',
      arch: 'x64',
      appOutDir: alias,
    }),
    /parents must be physical directories/,
  )
  const direct = join(appOutDir, 'linked-runtime')
  await symlink(runtime, direct, process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(
    verifyPackagedRuntimeFiles(direct, { platform: 'win32', arch: 'x64', appOutDir }),
    /parents must be physical directories/,
  )
  const redirectedApp = join(root, 'redirected-application')
  await mkdir(redirectedApp)
  await symlink(
    join(appOutDir, 'resources'),
    join(redirectedApp, 'resources'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  await assert.rejects(
    verifyPackagedRuntimeFiles(join(redirectedApp, 'resources', 'arcadia-server'), {
      platform: 'win32',
      arch: 'x64',
      appOutDir: redirectedApp,
    }),
    /parents must be physical directories/,
  )
  await assert.rejects(
    verifyPackagedRuntimeFiles(runtime, { platform: 'win32', arch: 'x64', appOutDir: join(root, 'other-app') }),
    /inside the application output directory/,
  )
  assert.equal(await readlink(join(runtime, linkPath)), original, 'no external junction was rewritten')
})

test('a configured output may have an alias above its trusted physical boundary', async t => {
  const { root, runtime, linkPath } = await copiedWindowsRuntime(t)
  const alias = join(root, 'parent-alias')
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir')
  const appOutDir = join(alias, 'application')
  const { verifyPackagedRuntimeFiles } = await import('./verify-desktop-pack.mjs')
  await verifyPackagedRuntimeFiles(join(appOutDir, 'resources', 'arcadia-server'), {
    platform: 'win32',
    arch: 'x64',
    appOutDir,
  })
  assert.equal(isAbsolute(await readlink(join(runtime, linkPath))), false)
  assert.equal(await readFile(join(runtime, linkPath, 'index.js'), 'utf8'), 'package-local material')
})

test(
  'POSIX packaged verification rejects absolute links without rewriting them',
  { skip: process.platform === 'win32' },
  async t => {
    const { runtime, linkPath } = await copiedWindowsRuntime(t)
    const original = await readlink(join(runtime, linkPath))
    const { verifyPackagedRuntimeFiles } = await import('./verify-desktop-pack.mjs')
    await assert.rejects(
      verifyPackagedRuntimeFiles(runtime, { platform: process.platform, arch: process.arch }),
      /escapes staged root/,
    )
    assert.equal(await readlink(join(runtime, linkPath)), original)
  },
)
