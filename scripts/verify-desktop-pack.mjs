import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

// The normal Builder configuration always uses these strict hooks.
export async function beforePack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged)
}

export async function afterPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  await verifyDesktopRuntime(join(resources, 'arcadia-server'))
}

// Preview builds explicitly use separate hooks; integrity and copied resources
// are still checked, while the manifest records the incomplete notices.
export async function beforePreviewPack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged, { allowIncompleteNotices: true })
}

export async function afterPreviewPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  await verifyDesktopRuntime(join(resources, 'arcadia-server'), { allowIncompleteNotices: true })
}

export function previewBuilderConfiguration() {
  const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
  return {
    appId: 'com.arcadia.eternity.preview',
    productName: 'Arcadia Eternity Preview',
    directories: { output: 'release-preview' },
    // The preview targets this host, using the same installed, locked Electron
    // runtime checked by staging instead of downloading a second copy.
    electronDist: join(dirname(require.resolve('electron/package.json')), 'dist'),
    beforePack: beforePreviewPack,
    afterPack: afterPreviewPack,
    publish: null,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--preview') {
    console.error('Usage: node scripts/verify-desktop-pack.mjs --preview')
    process.exitCode = 1
  } else {
    const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
    const { build } = require('electron-builder')
    let finished = false
    let verified = false
    // Some Builder child-process failures can leave its promise unsettled even
    // after all handles close. Such a build must never report success.
    process.once('beforeExit', () => {
      if (!finished) {
        console.error('Preview build ended before the packaged runtime was verified')
        process.exitCode = 1
      }
    })
    build({
      dir: true,
      publish: 'never',
      config: {
        ...previewBuilderConfiguration(),
        afterPack: async context => {
          await afterPreviewPack(context)
          verified = true
        },
      },
    })
      .then(() => {
        if (!verified) throw new Error('Preview build did not verify the packaged runtime')
        finished = true
      })
      .catch(error => {
        finished = true
        console.error(error)
        process.exitCode = 1
      })
  }
}
