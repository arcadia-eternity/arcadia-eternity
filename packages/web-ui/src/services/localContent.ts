import { localMediaScope, registerMediaEnvironment } from './mediaLoader'
import { getDesktopApi } from '@/utils/env'
import { validateEnvironmentContent } from './serverContentValidation'
import {
  hasPreparedWebEnvironment,
  readBuiltinWebEnvironment,
  readPreparedWebCatalog,
  readPreparedWebRuntime,
} from './preparedWebEnvironment'

/** A captured local selection. Each consumer owns its own resource lifetime. */
export async function acquireLocalContent(environmentId?: string, refresh = false) {
  const api = getDesktopApi()
  if (!api) {
    if (!hasPreparedWebEnvironment()) return undefined
    const selected = environmentId ? await readBuiltinWebEnvironment(environmentId, refresh) : undefined
    const catalog = selected ?? (await readPreparedWebCatalog(refresh))
    const selectedId = environmentId ?? catalog.defaultEnvironment
    return {
      environmentId: selectedId,
      environmentName: selected?.environmentName ?? catalog.builtins?.find(doc => doc.id === selectedId)?.name,
      gameplayRevision: catalog.gameplayRevision,
      draftRevision: undefined,
      content: catalog.content,
      rules: catalog.rules,
      effectMarkRelations: catalog.effectMarkRelations,
      resources: catalog.resources,
      readRuntime: (signal?: AbortSignal) =>
        readPreparedWebRuntime(signal, selected?.material, catalog.runtimeRevision),
      release: async () => {},
    }
  }
  if (!api.prepareLocalContent || !api.releaseLocalContent) throw new Error('本地内容服务不可用，请重启客户端')
  const result = await api.prepareLocalContent(environmentId)
  let runtime: ReturnType<NonNullable<typeof api.readLocalRuntime>> | undefined
  let releaseMedia: (() => void) | undefined
  let released = false
  const release = async () => {
    if (released) return
    released = true
    releaseMedia?.()
    await api.releaseLocalContent!(result.token)
  }
  try {
    validateEnvironmentContent(result.content)
    releaseMedia = registerMediaEnvironment(
      result.content,
      localMediaScope(['desktop', result.environmentId, result.gameplayRevision], result.packages, result.resources),
      result.resources,
      true,
    )
    return {
      environmentId: result.environmentId,
      environmentName: result.environmentName,
      gameplayRevision: result.gameplayRevision,
      draftRevision: result.draftRevision,
      content: result.content,
      rules: result.rules,
      effectMarkRelations: undefined,
      resources: result.resources ?? [],
      async readRuntime() {
        if (released) throw new Error('本地内容会话已释放')
        if (result.environment) return result.environment
        if (!api.readLocalRuntime) throw new Error('本地运行材料服务不可用，请重启客户端')
        return (runtime ??= api.readLocalRuntime(result.token).catch(error => {
          runtime = undefined
          throw error
        }))
      },
      release,
    }
  } catch (error) {
    await release()
    throw error
  }
}
