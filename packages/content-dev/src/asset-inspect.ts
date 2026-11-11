import { stat } from 'node:fs/promises'
import { lookup } from 'mime-types'
import { validResourceId } from './lib/presentation.ts'
import { WorkspaceError } from './workspace.ts'

export const imageByteLimit = 2 * 1024 * 1024
const fail = (code, message) => {
  throw new WorkspaceError(code, message)
}

/** Read declared local resources only; remote URLs remain metadata and are never fetched. */
export async function inspectAsset(
  workspace: any,
  { id, includeImage = false }: { id?: string; includeImage?: boolean } = {},
) {
  if (!validResourceId(id)) fail('RESOURCE_INVALID', '需要已声明资源的稳定 ID')
  if (typeof includeImage !== 'boolean') fail('RESOURCE_INVALID', 'includeImage 必须是布尔值')
  const snapshot = await workspace.snapshot()
  const resources = snapshot.records.filter(row => row.kind === 'resources' && row.record.id === id)
  if (!resources.length) fail('RESOURCE_UNKNOWN', '此项目没有声明该资源')
  if (resources.length !== 1) fail('RESOURCE_AMBIGUOUS', '资源 ID 不唯一，请先修复重复声明')
  const definition = resources[0]
  const { kind, source } = definition.record
  if (typeof source !== 'string') fail('RESOURCE_INVALID', '资源缺少有效位置')
  const metadata = { id, kind, source, definition: definition.file, definitionVersion: definition.version }
  if (/^https?:\/\//.test(source)) {
    let url
    try {
      url = new URL(source)
    } catch {
      fail('RESOURCE_INVALID', '资源 URL 无效')
    }
    if (url.username || url.password) fail('RESOURCE_INVALID', '资源 URL 不能含有凭据')
    return { metadata: { ...metadata, remote: true, imageAvailable: false, reason: 'REMOTE_NOT_FETCHED' } }
  }
  const path = await workspace.path(source)
  const info = await stat(path)
  if (!info.isFile()) fail('RESOURCE_INVALID', '资源必须是普通文件')
  // Follow the source filename, as the authoring resource pipeline does. Decoding belongs to the client.
  const mimeType = lookup(source) || 'application/octet-stream'
  if (kind !== 'image' && mimeType.startsWith('image/'))
    fail('RESOURCE_KIND_MISMATCH', '声明的资源类型与图片文件名不同')
  const reason =
    kind !== 'image'
      ? 'NOT_IMAGE'
      : !mimeType.startsWith('image/')
        ? 'IMAGE_FORMAT_UNKNOWN'
        : info.size > imageByteLimit
          ? 'IMAGE_TOO_LARGE'
          : undefined
  const result: any = {
    metadata: {
      ...metadata,
      remote: false,
      bytes: info.size,
      mimeType,
      imageAvailable: !reason,
      ...(reason ? { reason } : {}),
      imageByteLimit,
    },
  }
  if (!includeImage) return result
  if (reason) fail(reason, '此资源不能直接返回图片；请读取元数据或在页面查看')
  const asset = await workspace.asset(source)
  if (asset.bytes.length > imageByteLimit) fail('IMAGE_TOO_LARGE', '图片超过 2 MiB')
  result.metadata.bytes = asset.bytes.length
  result.metadata.version = asset.version
  result.image = { type: 'image', mimeType, data: asset.bytes.toString('base64') }
  return result
}
