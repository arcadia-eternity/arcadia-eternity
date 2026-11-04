import { getDesktopApi } from '@/utils/env'
import { validateEnvironmentContent } from './serverContentValidation'

/** A captured desktop selection. Each consumer owns its own resource lifetime. */
export async function acquireLocalContent() {
  const api = getDesktopApi()
  if (!api) return undefined
  if (!api.prepareLocalContent || !api.releaseLocalContent) throw new Error('本地内容服务不可用，请重启客户端')
  const result = await api.prepareLocalContent()
  let released = false
  const release = async () => {
    if (released) return
    released = true
    await api.releaseLocalContent!(result.token)
  }
  try {
    validateEnvironmentContent(result.content)
    return { ...result, release }
  } catch (error) {
    await release()
    throw error
  }
}
