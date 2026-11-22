export function audioResourceBlob(bytes: Uint8Array) {
  const ogg = String.fromCharCode(...bytes.subarray(0, 4)) === 'OggS'
  const mp3 =
    String.fromCharCode(...bytes.subarray(0, 3)) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (!ogg && !mp3) throw new Error('不支持的音频格式')
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: ogg ? 'audio/ogg' : 'audio/mpeg' })
}
