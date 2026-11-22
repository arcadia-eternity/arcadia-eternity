import { contentTaskError } from '@/utils/contentTaskMessages'

interface ApplyTask {
  status: string
  error?: unknown
}

export async function waitForEnvironmentApply<T extends ApplyTask>(
  readTask: () => Promise<T | undefined>,
  isCurrent: () => boolean,
) {
  while (isCurrent()) {
    const task = await readTask()
    if (!isCurrent()) return
    if (!task) throw new Error('找不到保存任务，请刷新环境列表。')
    if (task.status === 'succeeded') return task
    if (task.status !== 'queued' && task.status !== 'running') {
      throw new Error(contentTaskError(task.error) || (task.status === 'cancelled' ? '保存已取消。' : '环境保存失败。'))
    }
    await new Promise(resolve => setTimeout(resolve, 750))
  }
}
