import { open } from 'node:fs/promises'
import { validResourceId } from './lib/presentation.mjs'
import { WorkspaceError } from './workspace.mjs'

export const imageByteLimit = 2 * 1024 * 1024
const dimensionLimit = 8192
const pixelLimit = 16 * 1024 * 1024
const headerLimit = 256 * 1024
const fail = (code, message) => {
  throw new WorkspaceError(code, message)
}

function imageHeader(bytes) {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.readUInt32BE(8) === 13 &&
    bytes.toString('ascii', 12, 16) === 'IHDR'
  )
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  if (bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6)))
    return { mimeType: 'image/gif', width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  if (bytes.length >= 25 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('ascii', 12, 16)
    if (chunk === 'VP8X' && bytes.length >= 30)
      return { mimeType: 'image/webp', width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
      return { mimeType: 'image/webp', width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
    if (chunk === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21)
      return { mimeType: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8)
        return { mimeType: 'image/jpeg', width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) }
      offset += length
    }
  }
}
function mediaMime(bytes) {
  if (bytes.toString('ascii', 0, 4) === 'OggS') return 'audio/ogg'
  if (bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (['FWS', 'CWS', 'ZWS'].includes(bytes.toString('ascii', 0, 3))) return 'application/x-shockwave-flash'
  return 'application/octet-stream'
}
function completeContainer(bytes, mimeType) {
  if (mimeType === 'image/png')
    return bytes.length >= 45 && bytes.toString('ascii', bytes.length - 8, bytes.length - 4) === 'IEND'
  if (mimeType === 'image/jpeg')
    return bytes.length >= 4 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217
  if (mimeType === 'image/gif') return bytes[bytes.length - 1] === 59
  return bytes.readUInt32LE(4) + 8 === bytes.length
}

/** Read declared local resources only; remote URLs remain metadata and are never fetched. */
export async function inspectAsset(workspace, { id, includeImage = false } = {}) {
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
  const handle = await open(path, 'r')
  let size, bytes
  try {
    const info = await handle.stat()
    if (!info.isFile()) fail('RESOURCE_INVALID', '资源必须是普通文件')
    size = info.size
    bytes = Buffer.alloc(Math.min(size, headerLimit))
    const read = await handle.read(bytes, 0, bytes.length, 0)
    bytes = bytes.subarray(0, read.bytesRead)
  } finally {
    await handle.close()
  }
  const header = imageHeader(bytes)
  if (kind === 'image' && (!header || !header.width || !header.height))
    fail('RESOURCE_IMAGE_INVALID', '图片头无效或格式不支持；支持 PNG、JPEG、WebP、GIF')
  if (kind !== 'image' && header) fail('RESOURCE_KIND_MISMATCH', '声明的资源类型与图片内容不同')
  const reason =
    kind !== 'image'
      ? 'NOT_IMAGE'
      : size > imageByteLimit
        ? 'IMAGE_TOO_LARGE'
        : header.width > dimensionLimit || header.height > dimensionLimit || header.width * header.height > pixelLimit
          ? 'IMAGE_DIMENSIONS_EXCEEDED'
          : undefined
  const result = {
    metadata: {
      ...metadata,
      remote: false,
      bytes: size,
      mimeType: header?.mimeType ?? mediaMime(bytes),
      ...(header ? { width: header.width, height: header.height } : {}),
      imageAvailable: !reason,
      ...(reason ? { reason } : {}),
      imageByteLimit,
    },
  }
  if (!includeImage) return result
  if (reason) fail(reason, '此资源不能直接返回图片；请读取元数据或在页面查看')
  const asset = await workspace.asset(source)
  if (asset.bytes.length > imageByteLimit) fail('IMAGE_TOO_LARGE', '图片超过 2 MiB')
  const actual = imageHeader(asset.bytes)
  if (
    !actual ||
    actual.mimeType !== header.mimeType ||
    actual.width !== header.width ||
    actual.height !== header.height
  )
    fail('RESOURCE_CHANGED', '读取期间资源已改变，请重试')
  if (!completeContainer(asset.bytes, actual.mimeType)) fail('RESOURCE_IMAGE_INVALID', '图片容器不完整')
  result.metadata.bytes = asset.bytes.length
  result.metadata.version = asset.version
  result.image = { type: 'image', mimeType: actual.mimeType, data: asset.bytes.toString('base64') }
  return result
}
