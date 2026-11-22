// Shared by the renderer, Electron host and offline asset builder.
export const mediaLimits = Object.freeze({ image: 64 * 1024 * 1024, audio: 16 * 1024 * 1024, swf: 16 * 1024 * 1024 })
const maxExpandedSwf = 64 * 1024 * 1024
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
const fileTypes = new Map(
  Object.entries({
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    swf: 'application/x-shockwave-flash',
  }),
)
const supportedTypes = new Set(fileTypes.values())
export function mediaMimeForFile(file) {
  const extension = /\.([^.\/]+)$/.exec(file.split(/[?#]/, 1)[0])?.[1]
  return fileTypes.get(extension?.toLowerCase())
}
export function mediaKindForMime(mime) {
  if (!supportedTypes.has(mime)) return undefined
  if (mime === 'application/x-shockwave-flash') return 'swf'
  return mime.startsWith('image/') ? 'image' : 'audio'
}
export function mediaKindForResource({ kind, mime, source, tags }) {
  if (kind === 'image' || kind === 'audio' || kind === 'swf') return kind
  return (
    mediaKindForMime(mime) ??
    (tags?.includes('music')
      ? 'audio'
      : tags?.includes('background')
        ? 'image'
        : mediaKindForMime(mediaMimeForFile(source)))
  )
}
/** Inspect image signatures and declared dimensions before handing bytes to the browser decoder. */
function imageMime(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0,
    height = 0,
    mime = ''
  const ascii = (start, length) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (bytes.length >= 24 && pngSignature.every((byte, i) => bytes[i] === byte) && ascii(12, 4) === 'IHDR') {
    width = view.getUint32(16)
    height = view.getUint32(20)
    mime = 'image/png'
  } else if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const format = ascii(12, 4)
    if (format === 'VP8X' && bytes.length >= 30) {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
      // Animated images require separate frame/total-work limits; reject this optional format here.
      if (bytes[20] & 2) throw new Error('不支持的动画图片')
    } else if (format === 'VP8 ' && bytes.length >= 30 && ascii(23, 3) === '\x9d\x01\x2a') {
      width = view.getUint16(26, true) & 0x3fff
      height = view.getUint16(28, true) & 0x3fff
    } else if (format === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true)
      width = (bits & 0x3fff) + 1
      height = ((bits >>> 14) & 0x3fff) + 1
    }
    mime = 'image/webp'
  } else if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    mime = 'image/jpeg'
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break
      while (bytes[offset] === 0xff) offset++
      const marker = bytes[offset++]
      if (marker === 0xda || marker === 0xd9) break
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue
      if (offset + 2 > bytes.length) break
      const size = view.getUint16(offset)
      if (size < 2 || offset + size > bytes.length) break
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) &&
        size >= 7
      ) {
        height = view.getUint16(offset + 3)
        width = view.getUint16(offset + 5)
        break
      }
      offset += size
    }
  }
  if (!mime || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_777_216)
    throw new Error('图片格式或尺寸超过限制')
  // Reject APNG's extra frames before the decoder can expand them.
  if (mime === 'image/png') {
    let offset = 8
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset)
      if (ascii(offset + 4, 4) === 'acTL') throw new Error('不支持的动画图片')
      if (size > bytes.length - offset - 12) break
      offset += size + 12
    }
  }
  return mime
}

function audioMime(bytes) {
  const ogg = String.fromCharCode(...bytes.subarray(0, 4)) === 'OggS'
  const mp3 =
    String.fromCharCode(...bytes.subarray(0, 3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (!ogg && !mp3) throw new Error('不支持的音频格式')
  return ogg ? 'audio/ogg' : 'audio/mpeg'
}

export function inspectMedia(kind, bytes) {
  if (!bytes.byteLength || bytes.byteLength > mediaLimits[kind]) throw new Error('资源大小超过限制')
  if (kind === 'image') return imageMime(bytes)
  if (kind === 'audio') return audioMime(bytes)
  if (kind !== 'swf') throw new Error('不支持的媒体类型')
  if (bytes.byteLength < 8) throw new Error('SWF file exceeds playback limits')
  const signature = String.fromCharCode(...bytes.subarray(0, 3))
  if (signature !== 'FWS' && signature !== 'CWS') throw new Error('Unsupported SWF format')
  const expected = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  if (expected < 8 || expected > maxExpandedSwf) throw new Error('SWF expanded size exceeds playback limits')
  if (signature === 'FWS' && bytes.byteLength !== expected) throw new Error('SWF size mismatch')
  return 'application/x-shockwave-flash'
}

// Inspect the actual deflate stream before passing a movie to the player.
export async function validateSwfFile(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new Error('Invalid SWF bytes')
  const bytes = new Uint8Array(buffer)
  inspectMedia('swf', bytes)
  if (bytes[0] === 70) return
  const expected = new DataView(buffer).getUint32(4, true)
  const reader = new Blob([bytes.subarray(8)]).stream().pipeThrough(new DecompressionStream('deflate')).getReader()
  let size = 8
  try {
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      size += result.value.byteLength
      if (size > expected) throw new Error('SWF expanded size exceeds playback limits')
    }
  } finally {
    await reader.cancel()
  }
  if (size !== expected) throw new Error('SWF expanded size mismatch')
}
