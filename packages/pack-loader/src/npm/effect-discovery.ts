import { watch, mkdtempSync, writeFileSync, rmSync, realpathSync, type FSWatcher } from 'node:fs'
import { tmpdir } from 'node:os'
import { readdir, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, join } from 'node:path'
import type { Plugin } from 'rolldown'

/** Static filesystem discovery only: author modules are never imported by the build host. */
export function effectDiscoveryPlugin(
  root: string,
  directories: readonly string[] = ['src/effects'],
  catalog = false,
): Plugin {
  const entry = '\0arcadia-discovered-effects'
  let watchDirectory: string | undefined
  let watchRevision = 0
  const watchers: FSWatcher[] = []
  const closeWatchers = () => {
    for (const watcher of watchers.splice(0)) watcher.close()
  }
  return {
    name: 'arcadia-effect-discovery',
    closeWatcher() {
      closeWatchers()
      if (watchDirectory) rmSync(watchDirectory, { recursive: true, force: true })
      watchDirectory = undefined
    },
    resolveId(id) {
      if (id === 'virtual:arcadia-effects') return entry
    },
    async transform(code, id) {
      if (!id.endsWith('.ts') || !code.includes('@')) return
      const { default: ts } = await import('typescript')
      const result = ts.transpileModule(code, {
        fileName: id,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          sourceMap: true,
          experimentalDecorators: false,
          verbatimModuleSyntax: true,
        },
      })
      const errors = result.diagnostics?.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
      if (errors.length)
        throw new Error(
          ts.formatDiagnosticsWithColorAndContext(errors, {
            getCanonicalFileName: file => file,
            getCurrentDirectory: () => root,
            getNewLine: () => '\n',
          }),
        )
      return { code: result.outputText, map: result.sourceMapText }
    },
    async load(id) {
      if (id !== entry) return
      // Rolldown watches files, but directory membership alone does not invalidate a virtual entry.
      // A private watched file bridges native directory rename events into its module graph.
      closeWatchers()
      let marker: string | undefined
      if (this.meta.watchMode) {
        if (!watchDirectory) {
          watchDirectory = mkdtempSync(join(realpathSync(tmpdir()), 'arcadia-effect-watch-'))
          writeFileSync(join(watchDirectory, 'revision'), String(watchRevision))
        }
        marker = join(watchDirectory, 'revision')
        this.addWatchFile(marker)
      }
      const boundary = await realpath(root),
        files: string[] = []
      const inside = async (path: string) => {
        const canonical = await realpath(path),
          rel = relative(boundary, canonical)
        if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel))
          throw new Error('Effect source escapes package')
        return canonical
      }
      const walk = async (directory: string) => {
        directory = await inside(directory)
        this.addWatchFile(directory)
        if (marker) {
          const notify = marker
          const watcher = watch(directory, event => {
            if (event === 'rename') {
              try {
                writeFileSync(notify, String(++watchRevision))
              } catch (error) {
                this.warn(error instanceof Error ? error.message : 'Effect watcher failed')
              }
            }
          })
          watcher.on('error', error => this.warn(error.message))
          watchers.push(watcher)
        }
        for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
          a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
        )) {
          if (item.isSymbolicLink()) throw new Error(`Effect source symlink: ${item.name}`)
          const path = resolve(directory, item.name)
          if (item.isDirectory()) await walk(path)
          else if (item.isFile() && /\.effect\.ts$/.test(item.name)) {
            files.push(await inside(path))
            if (files.length > 1024) throw new Error('Too many effect source files')
            this.addWatchFile(path)
          }
        }
      }
      for (const directory of directories) await walk(resolve(boundary, directory))
      const unique = [...new Set(files)].sort()
      return [
        "import {loadEffectGroups, loadCodeEffects} from '@arcadia-eternity/battle/effect-loading';",
        ...unique.map((file, index) => `import * as m${index} from ${JSON.stringify(file)};`),
        `export const effectSources = [${unique.map((file, index) => `{file:${JSON.stringify(relative(boundary, file).replace(/\\/g, '/'))},exports:m${index}}`).join(',')}];`,
        'export const createCatalog = marks => loadEffectGroups(effectSources, marks);',
        `export const createEffects = context => loadCodeEffects(effectSources, context, ${catalog});`,
      ].join('\n')
    },
  }
}
