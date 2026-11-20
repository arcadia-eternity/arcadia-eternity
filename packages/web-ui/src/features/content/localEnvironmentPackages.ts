import { authorCall, type AuthorJob } from '@/features/authoring/types'
import { contentTaskError } from '@/utils/contentTaskMessages'
import { createLocalContentLibraryClient } from './contentLibraryClient'

export async function localEnvironmentRequest<T>(input: Record<string, unknown>): Promise<T> {
  const api = window.arcadiaDesktop?.localEnvironment
  if (!api) throw new Error('离线环境库需要桌面客户端')
  const response = await api(input)
  if (response.error) throw new Error(contentTaskError(response.error))
  return response.result as T
}

export async function installProjectBuild(id: string) {
  const jobs = () => authorCall<AuthorJob[]>({ action: 'jobs', id })
  let job = (await jobs()).find(item => item.kind === 'pack' || item.kind === 'release')
  if (!job || job.stale || !['succeeded', 'queued', 'running'].includes(job.state))
    job = await authorCall<AuthorJob>({ action: 'start', kind: 'pack', id })
  const jobId = job.jobId
  while (job && ['queued', 'running'].includes(job.state)) {
    await new Promise(resolve => setTimeout(resolve, 1000))
    job = (await jobs()).find(item => item.jobId === jobId)
  }
  if (job?.state !== 'succeeded' || job.stale)
    throw new Error(job?.diagnostics?.[0]?.message || '构建未完成或已过期，请在创作工作台查看任务。')
  const result = await authorCall<{ packageId: string }>({ action: 'install-built-author-pack', id, jobId })
  const snapshot = await createLocalContentLibraryClient(window.arcadiaDesktop)?.list()
  const pkg = snapshot?.packages.find(pkg => pkg.id === result.packageId && !pkg.error)
  if (!pkg) throw new Error('找不到刚安装的内容包。')
  return pkg
}
