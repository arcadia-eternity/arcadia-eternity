/** Inspect image signatures and declared dimensions before handing bytes to the browser decoder. */
export function imageResourceBlob(bytes: Uint8Array): Blob {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let width = 0,
    height = 0,
    mime = ''
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length))
  if (bytes.length >= 24 && ascii(1, 3) === 'PNG' && bytes[0] === 137 && ascii(12, 4) === 'IHDR') {
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
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime })
}
