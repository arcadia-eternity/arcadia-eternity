interface OfflineFile {
  path: string
  size: number
  sha256: string
}
export interface OfflineManifest {
  version: string
  worker: string
  bytes: number
  files: OfflineFile[]
}

const root = () => new URL(import.meta.env.BASE_URL || './', location.href)
const prefix = () => `arcadia-static:${root().pathname}:`
const readyUrl = () => new URL('__offline_ready__', root()).href

export function offlineSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window
}

export async function loadOfflineManifest(): Promise<OfflineManifest> {
  const response = await fetch(new URL('offline-manifest.json', root()), { cache: 'no-cache' })
  if (!response.ok) throw new Error('离线资源清单加载失败，请联网后重试。')
  return response.json()
}

export async function hasOfflineResources(): Promise<boolean> {
  for (const name of await caches.keys()) {
    if (name.startsWith(prefix()) && (await (await caches.open(name)).match(readyUrl()))) return true
  }
  return false
}

export async function saveOfflineResources(
  manifest: OfflineManifest,
  progress: (completed: number) => void,
): Promise<void> {
  const estimate = await navigator.storage?.estimate?.()
  if (estimate?.quota !== undefined && manifest.bytes > estimate.quota - (estimate.usage ?? 0)) {
    throw new Error('浏览器空间不足，无法保存离线资源。请释放空间后重试；仍可直接开始本地对战。')
  }
  const name = `${prefix()}${manifest.version}`
  const cache = await caches.open(name)
  const alreadyReady = Boolean(await cache.match(readyUrl()))
  try {
    if (!alreadyReady) {
      let completed = 0
      let next = 0
      let failure: unknown
      await Promise.all(
        Array.from({ length: 4 }, async () => {
          while (!failure && next < manifest.files.length) {
            const file = manifest.files[next++]
            try {
              const url = new URL(file.path, root())
              if (url.origin !== root().origin || !url.pathname.startsWith(root().pathname)) {
                throw new Error('离线资源路径无效。')
              }
              const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(60_000) })
              if (!response.ok) throw new Error(`资源下载失败：${file.path} (${response.status})`)
              const data = await response.clone().arrayBuffer()
              const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), byte =>
                byte.toString(16).padStart(2, '0'),
              ).join('')
              if (data.byteLength !== file.size || hash !== file.sha256)
                throw new Error('资源版本已更新，请刷新页面后重新保存。')
              await cache.put(url.href, response)
              progress(++completed)
            } catch (error) {
              failure = error
            }
          }
        }),
      )
      if (failure) throw failure
      await cache.put(readyUrl(), new Response(manifest.version))
    }
    const registration = await navigator.serviceWorker.register(new URL(manifest.worker, root()), {
      scope: root().pathname,
    })
    const worker = registration.installing ?? registration.waiting ?? registration.active
    if (!worker) throw new Error('离线功能启动失败，请重试。')
    if (worker.state !== 'activated') {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          worker.removeEventListener('statechange', changed)
          reject(new Error('离线功能启动超时，请重试。'))
        }, 30_000)
        function changed() {
          if (worker!.state === 'activated' || worker!.state === 'redundant') {
            clearTimeout(timer)
            worker!.removeEventListener('statechange', changed)
            if (worker!.state === 'activated') resolve()
            else reject(new Error('离线功能启动失败，请重试。'))
          }
        }
        worker.addEventListener('statechange', changed)
        changed()
      })
    }
    // Remove only previous complete builds for this mount, after the new one is usable.
    for (const old of await caches.keys()) if (old.startsWith(prefix()) && old !== name) await caches.delete(old)
  } catch (error) {
    if (!alreadyReady) await caches.delete(name)
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new Error('浏览器空间不足，离线资源未保存。仍可直接开始本地对战。')
    }
    throw error
  }
}
