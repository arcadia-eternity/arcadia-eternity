import { fileURLToPath } from 'node:url'
import { effectDiscoveryPlugin } from './effect-discovery.ts'
import { readFile, realpath, stat } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { parse } from 'es-module-lexer/minimal/js'
import * as sdk from '@arcadia-eternity/battle/authoring'
import * as core from '@arcadia-eternity/battle/engine'
import type { EffectModuleArtifact } from '@arcadia-eternity/battle/sandbox/effects'

/** Fixed compiler pipeline: parse/bundle author text without evaluating modules or loading author plugins.
 * A trusted host watcher may observe validated source dependencies, including files with syntax errors.
 */
export async function compileEffectModule(
  entry: string,
  root: string,
  packageId: string,
  onDependency?: (file: string) => void,
): Promise<EffectModuleArtifact> {
  const { rolldown } = await import('rolldown')
  const boundary = await realpath(root),
    sourcePath = await realpath(entry)
  const discover = (await stat(sourcePath)).isDirectory()
  const source = discover ? 'virtual:arcadia-effects' : sourcePath
  let bytes = 0,
    files = 0
  const shim = '\0arcadia-effect-sdk'
  const factoryEntry = '\0arcadia-effect-factories'
  const loading = '\0arcadia-effect-loading'
  const contentSdk = '\0arcadia-content-sdk'
  const build = await rolldown({
    cwd: boundary,
    input: factoryEntry,
    platform: 'neutral',
    onLog(level, log, handler) {
      if (log.code === 'IMPORT_IS_UNDEFINED' && log.id === factoryEntry) return
      handler(level, log)
    },
    plugins: [
      effectDiscoveryPlugin(discover ? sourcePath : boundary, discover ? ['.'] : ['src/effects']),
      {
        name: 'arcadia-effect-artifact',
        resolveId(id) {
          if (id === factoryEntry) return factoryEntry
          if (id === '@arcadia-eternity/battle/effect-loading' || id === loading) return loading
          if (id === '@arcadia-eternity/content-sdk' || id === contentSdk) return contentSdk
          if (id === source) return { id: source, moduleSideEffects: true }
          if (['@arcadia-eternity/battle/authoring', '@arcadia-eternity/const'].includes(id)) return shim
          if (id === '@arcadia-eternity/battle/engine') return `${shim}-core`
          if (/^(node:|https?:|data:|file:)/.test(id)) throw Error(`Unsupported effect dependency: ${id}`)
        },
        async load(id) {
          if (id === contentSdk)
            return `export * from '@arcadia-eternity/battle/authoring'; export * from '@arcadia-eternity/battle/effect-loading';`
          if (id === loading)
            return readFile(fileURLToPath(import.meta.resolve('@arcadia-eternity/battle/effect-loading')), 'utf8')
          // Packages publish ordinary modules. Only the author factories enter the VM;
          // reference/metadata helpers remain available to trusted host tooling.
          if (id === factoryEntry)
            // Hoisted bindings keep the emitted ESM valid even when author
            // initialization throws before the factory assignments are reached.
            return `import * as authored from ${JSON.stringify(source)};\nexport var createEffects = authored.createEffects;\nexport var createCatalog = authored.createCatalog;`
          if (id === shim || id === `${shim}-core`) {
            const root = id === shim ? 'sdk' : 'core'
            // Linking accepts the module's declared exports. The VM's SDK adapter
            // still controls access; unused host helpers disappear during bundling.
            const names = Object.keys(root === 'core' ? core : sdk)
            return (
              `const lookup = key => globalThis.${root}[key];\n` +
              names
                .filter(name => /^[a-zA-Z_$][\w$]*$/.test(name))
                .map(name => `export const ${name} = /* @__PURE__ */ lookup(${JSON.stringify(name)});`)
                .join('\n')
            )
          }
          if (id.startsWith('\0')) return
          const path = await realpath(id),
            location = relative(boundary, path),
            info = await stat(path)
          if (
            location === '..' ||
            location.startsWith('../') ||
            location.startsWith('..\\') ||
            isAbsolute(location) ||
            !info.isFile()
          )
            throw Error('Effect dependency escapes captured installation')
          onDependency?.(path)
          bytes += info.size
          if (++files > 1024 || info.size > 4 * 1024 * 1024 || bytes > 16 * 1024 * 1024)
            throw Error('Effect dependency graph exceeds compilation limits')
          // Author package sideEffects metadata must not suppress VM initialization.
          return { code: await readFile(path, 'utf8'), moduleSideEffects: true }
        },
      },
    ],
  })
  try {
    const { output } = await build.generate({ format: 'esm', codeSplitting: false, minify: true })
    if (
      output.length !== 1 ||
      output[0].type !== 'chunk' ||
      output[0].imports.length ||
      output[0].dynamicImports.length ||
      new TextEncoder().encode(output[0].code).byteLength > 4 * 1024 * 1024
    )
      throw Error('Effect module must have a bounded, closed dependency graph')
    if (parse(output[0].code)[0].some(entry => entry.d !== -2))
      throw Error('Runtime imports are not supported in effect artifacts')
    return Object.freeze({ format: 'arcadia.effect-module', version: 1, sdkApi: 2, packageId, source: output[0].code })
  } finally {
    await build.close()
  }
}
