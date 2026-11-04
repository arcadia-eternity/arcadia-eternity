import { realpath, stat } from 'node:fs/promises'
import { relative, isAbsolute } from 'node:path'
import { parse } from 'es-module-lexer/minimal/js'
import * as sdk from '@arcadia-eternity/battle/v4/authoring'
import type { EffectModuleArtifact } from '@arcadia-eternity/battle/v4/sandbox/effects'

/** Fixed compiler pipeline: parse/bundle author text without evaluating modules or loading author plugins. */
export async function compileEffectModule(
  entry: string,
  root: string,
  packageId: string,
): Promise<EffectModuleArtifact> {
  const { rolldown } = await import('rolldown')
  const boundary = await realpath(root),
    source = await realpath(entry)
  let bytes = 0,
    files = 0
  const shim = '\0arcadia-effect-sdk'
  const build = await rolldown({
    cwd: boundary,
    input: source,
    platform: 'neutral',
    plugins: [
      {
        name: 'arcadia-effect-artifact',
        resolveId(id) {
          if (['@arcadia-eternity/battle/v4/authoring', '@arcadia-eternity/const'].includes(id)) return shim
          if (id === '@arcadia-eternity/battle/v4') return `${shim}-core`
          if (/^(node:|https?:|data:|file:)/.test(id)) throw Error(`Unsupported effect dependency: ${id}`)
        },
        async load(id) {
          if (id === shim || id === `${shim}-core`) {
            const root = id === shim ? 'sdk' : 'core'
            const names = [
              ...Object.keys(sdk),
              ...(root === 'core'
                ? ['defineNativeBehavior', 'normalizeBehaviorDefinitions', 'BehaviorCompilationError']
                : []),
            ]
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
          bytes += info.size
          if (++files > 1024 || info.size > 4 * 1024 * 1024 || bytes > 16 * 1024 * 1024)
            throw Error('Effect dependency graph exceeds compilation limits')
        },
      },
    ],
  })
  try {
    const { output } = await build.generate({ format: 'esm', codeSplitting: false })
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
