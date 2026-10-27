import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyDesktopRuntime } from './stage-desktop-runtime.mjs'

// These hooks never accept the test-only incomplete-notices override.
export async function beforePack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged)
}

export async function afterPack(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  await verifyDesktopRuntime(join(resources, 'arcadia-server'))
}
