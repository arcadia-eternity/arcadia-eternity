import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'rolldown'
import { compileEffectModule } from '../packages/pack-loader/src/npm/effect-artifact.ts'

/** Host build adapter. Packages only publish ordinary effect modules. */
export function effectModulePlugin(
  entries: Readonly<Record<string, { entry: string; packageId: string }>>,
  root: string,
): Plugin {
  const modules = new Map(Object.entries(entries).map(([request, entry]) => [`\0effect-module:${request}`, entry]))
  return {
    name: 'arcadia-host-effect-modules',
    resolveId(request, importer) {
      const resolved = request.startsWith('.') && importer ? resolve(dirname(importer), request) : request
      const key = entries[resolved] ? resolved : entries[`${resolved}.ts`] ? `${resolved}.ts` : request
      const id = `\0effect-module:${key}`
      if (modules.has(id)) return id
    },
    async load(id) {
      const module = modules.get(id) ?? entries[id]
      if (!module) return
      // Only explicit watch builds and Vite's development server track edits.
      const onDependency = this.meta.watchMode ? (file: string) => this.addWatchFile(file) : undefined
      // Keep the entry watched even if compilation fails before reporting dependencies.
      onDependency?.(module.entry)
      const artifact = await compileEffectModule(module.entry, root, module.packageId, onDependency)
      return `export default ${JSON.stringify(artifact)};`
    },
  }
}

export function builtinEffectsPlugin(): Plugin {
  const module = {
    entry: fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/effects')),
    packageId: '@arcadia-eternity/data-pack-base',
  }
  return effectModulePlugin(
    {
      '@arcadia-eternity/data-pack-base/effects?effect-module': module,
      [`${module.entry}?effect-module`]: module,
      [fileURLToPath(new URL('../packages/cli/src/application/effect-module.ts', import.meta.url))]: module,
      [fileURLToPath(new URL('../packages/server/src/standalone/effect-module.ts', import.meta.url))]: module,
    },
    fileURLToPath(new URL('../', import.meta.url)),
  )
}
