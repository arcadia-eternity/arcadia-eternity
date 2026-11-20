import { getDesktopApi } from '@/utils/env'
import { validateEnvironmentContent } from './serverContentValidation'
import { hasPreparedWebEnvironment, readBuiltinWebEnvironment, readPreparedWebRuntime } from './preparedWebEnvironment'

/** A captured local selection. Each consumer owns its own resource lifetime. */
export async function acquireLocalContent(environmentId?: string, refresh = false) {
  const api = getDesktopApi()
  if (!api) {
    if (!environmentId || !hasPreparedWebEnvironment()) return undefined
    const catalog = await readBuiltinWebEnvironment(environmentId, refresh)
    return {
      environmentId,
      environmentName: catalog.environmentName,
      gameplayRevision: catalog.gameplayRevision,
      content: catalog.content,
      rules: catalog.rules,
      resources: catalog.resources,
      readRuntime: () => readPreparedWebRuntime(undefined, catalog.material),
      release: async () => {},
    }
  }
  if (!api.prepareLocalContent || !api.releaseLocalContent) throw new Error('本地内容服务不可用，请重启客户端')
  const result = await api.prepareLocalContent(environmentId)
  let runtime: ReturnType<NonNullable<typeof api.readLocalRuntime>> | undefined
  let released = false
  const release = async () => {
    if (released) return
    released = true
    await api.releaseLocalContent!(result.token)
  }
  try {
    validateEnvironmentContent(result.content)
    return {
      environmentId: result.environmentId,
      environmentName: result.environmentName,
      gameplayRevision: result.gameplayRevision,
      content: result.content,
      rules: result.rules,
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
