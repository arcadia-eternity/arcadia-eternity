import { getDesktopApi } from '@/utils/env'
import { validateEnvironmentContent } from './serverContentValidation'

/** A captured desktop selection. Each consumer owns its own resource lifetime. */
export async function acquireLocalContent() {
  const api = getDesktopApi()
  if (!api) return undefined
  if (!api.prepareLocalContent || !api.releaseLocalContent) throw new Error('本地内容服务不可用，请重启客户端')
  const result = await api.prepareLocalContent()
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
      content: result.content,
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
