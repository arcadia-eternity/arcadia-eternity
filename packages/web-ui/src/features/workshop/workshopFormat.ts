import type { WorkshopProject, WorkshopRevocation } from '@arcadia-eternity/pack-loader/workshop'

const dateFormat = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatDate = (value?: string) => (value ? dateFormat.format(new Date(value)) : '')
export const formatTime = (value?: string) => (value ? timeFormat.format(new Date(value)) : '')
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
export const kindLabel = (kind: string) => (kind === 'environment' ? '环境' : '内容包')
/** `official` is shown as a badge, so it is not repeated as a tag. */
export const visibleTags = (project: WorkshopProject) => project.tags.filter(tag => tag.toLowerCase() !== 'official')

export function revocation(revocations: readonly WorkshopRevocation[], npm: string, version: string) {
  return revocations.find(item => item.npm === npm && (item.version === '*' || item.version === version))
}
