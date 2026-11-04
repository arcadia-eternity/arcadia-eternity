/** The trusted renderer chooses a resource, never credentials or another endpoint. */
export function managementRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('管理请求无效')
  const { method, path, body, headers = {} } = input
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new Error('管理操作无效')
  if (typeof path !== 'string' || path.length > 4096 || !path.startsWith('/') || path.startsWith('//'))
    throw new Error('管理资源路径无效')
  let decoded
  try {
    decoded = decodeURIComponent(path.split('?')[0])
  } catch {
    throw new Error('管理资源路径无效')
  }
  if (
    decoded.includes('\\') ||
    decoded.includes('//') ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    decoded.split('/').some(part => part === '.' || part === '..')
  )
    throw new Error('管理资源路径无效')
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) throw new Error('管理请求头无效')
  const normalized = {}
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase()
    if (
      !['if-match', 'idempotency-key'].includes(key) ||
      typeof value !== 'string' ||
      value.length > 256 ||
      /[\r\n]/.test(value)
    )
      throw new Error('管理请求不能设置身份或连接信息')
    normalized[key] = value
  }
  if (method === 'GET' && body !== undefined) throw new Error('读取操作不能带请求正文')
  const result = { method, path, ...(body === undefined ? {} : { body }), headers: normalized }
  const encoded = JSON.stringify(result)
  const isImport = method === 'POST' && /^(?:\/api\/management\/v1)?\/workspaces\/[^/]+\/import$/.test(decoded)
  const limit = (isImport ? 130 : 2) * 1024 * 1024
  if (Buffer.byteLength(encoded) > limit) throw new Error('管理请求过大')
  return JSON.parse(encoded)
}
