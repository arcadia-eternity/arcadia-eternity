import * as sdk from '../../v4-authoring'
import { createContentCatalog } from '../v4/content/definition-catalog'
import { ArenaEffectModule } from './effect-module'
import { SandboxFault, sandboxPolicy } from './contracts'
import type { SandboxEnvironment } from './runtime'

/** Create executable content for one battle only. Dispose after its kernel has cleaned up.
 * Normal games call this inside their Worker; trusted introspection tests may opt in explicitly.
 */
export async function prepareSandboxContent(environment: SandboxEnvironment) {
  if (!Array.isArray(environment.modules) || environment.modules.length > sandboxPolicy.packagesPerBattle)
    throw new SandboxFault('artifact', 'battle', 'Invalid packages')
  const modules: ArenaEffectModule[] = [],
    names = new Set<string>()
  const dispose = () => {
    let failure: unknown
    for (const module of modules.splice(0)) {
      try {
        module.dispose()
      } catch (error) {
        failure ??= error
      }
    }
    if (failure) throw failure
  }
  try {
    for (const entry of environment.modules) {
      if (
        names.has(entry.artifact.packageId) ||
        !['catalog', 'behaviors'].includes(entry.role) ||
        typeof entry.namespace !== 'string'
      )
        throw new SandboxFault('artifact', 'battle', 'Duplicate or invalid package')
      names.add(entry.artifact.packageId)
      modules.push(await ArenaEffectModule.prepare(entry.artifact))
    }
    const usedExports = new Set(
      (environment.data.behaviors ?? []).map(
        raw => (raw as { implementation: { exportId: string } }).implementation.exportId,
      ),
    )
    const content = createContentCatalog(
      environment.data,
      environment.revision,
      marks => {
        const effects = new Map(),
          parameters = new Map()
        for (const [i, entry] of environment.modules.entries())
          if (entry.role === 'catalog') {
            const catalog = modules[i].createCatalog(marks)
            for (const [id, effect] of catalog.effects) {
              if (effects.has(id))
                throw new SandboxFault('artifact', entry.artifact.packageId, `Duplicate effect ${id}`)
              effects.set(id, effect)
            }
            for (const [id, parameter] of catalog.parameters) parameters.set(id, parameter)
          }
        return { effects, parameters }
      },
      ({ marks }) => ({
        nativeExports: environment.modules.flatMap((entry, index) => {
          if (entry.role === 'behaviors' && ![...usedExports].some(id => id.startsWith(`${entry.namespace}:`)))
            return []
          const exports = modules[index].createEffects({
            sdk,
            marks,
            id: local => {
              if (typeof local !== 'string' || !/^[a-zA-Z0-9_./-]+$/.test(local))
                throw new SandboxFault('artifact', entry.artifact.packageId, 'Invalid local ID')
              return entry.namespace ? `${entry.namespace}:${local}` : local
            },
          })
          if (entry.role === 'catalog') return exports
          if (!Array.isArray(exports) || exports.length > 5000)
            throw new SandboxFault('artifact', entry.artifact.packageId, 'Expected a bounded array of code effects')
          const seen = new Set<string>()
          for (const effect of exports) {
            if (
              typeof effect?.id !== 'string' ||
              !effect.id.startsWith(`${entry.namespace}:`) ||
              seen.has(effect.id) ||
              !effect.parameters ||
              typeof effect.parameters !== 'object' ||
              Object.keys(effect.parameters).length
            )
              throw new SandboxFault(
                'artifact',
                entry.artifact.packageId,
                'Unknown, duplicated or incompatible code effect export',
              )
            seen.add(effect.id)
          }
          return exports.filter(effect => usedExports.has(effect.id))
        }),
      }),
    )
    for (const module of modules) module.assertHealthy()
    return {
      content,
      packageCount: modules.length,
      assertHealthy() {
        for (const module of modules) module.assertHealthy()
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
export type SandboxContent = Awaited<ReturnType<typeof prepareSandboxContent>>
