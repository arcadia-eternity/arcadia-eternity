const RUFFLE_SCRIPT_SELECTOR = 'script[data-arcadia-ruffle]'

let loadPromise: Promise<void> | null = null

function getBaseUrlPath(): string {
  const baseUrl = import.meta.env.BASE_URL || '/'
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function getRufflePublicPath(): string {
  if (window.location.protocol === 'file:') {
    return new URL('./ruffle/', window.location.href).toString()
  }
  return `${getBaseUrlPath()}ruffle/`
}

function getRuffleScriptUrl(): string {
  const scriptVersionRaw =
    (import.meta.env.VITE_COMMIT_HASH as string | undefined)
    || (import.meta.env.VITE_BUILD_TIME as string | undefined)
    || ''
  const scriptVersion = scriptVersionRaw.trim()
  const suffix = scriptVersion ? `?v=${encodeURIComponent(scriptVersion)}` : ''
  return `${getRufflePublicPath()}ruffle.js${suffix}`
}

function ensureRuffleConfig(): void {
  const globalWithRuffle = window as Window & {
    RufflePlayer?: {
      config?: Record<string, unknown>
      newest?: () => unknown
    }
  }
  const publicPath = getRufflePublicPath()
  const current = globalWithRuffle.RufflePlayer

  if (!current || typeof current !== 'object') {
    globalWithRuffle.RufflePlayer = { config: { publicPath } }
    return
  }

  current.config = {
    ...(current.config ?? {}),
    publicPath,
  }
  globalWithRuffle.RufflePlayer = current
}

function hasRufflePlayer(): boolean {
  const rufflePlayer = (window as Window & {
    RufflePlayer?: {
      newest?: () => unknown
    }
  }).RufflePlayer
  return typeof rufflePlayer?.newest === 'function'
}

function waitForScriptLoad(script: HTMLScriptElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      script.dataset.arcadiaRuffleLoaded = 'true'
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      script.remove()
      reject(new Error(`Ruffle load failed: ${script.src}`))
    }
    const cleanup = () => {
      script.removeEventListener('load', onLoad)
      script.removeEventListener('error', onError)
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
  })
}

async function loadRuffleScript(): Promise<void> {
  ensureRuffleConfig()

  if (hasRufflePlayer()) return

  const existing = document.querySelector(RUFFLE_SCRIPT_SELECTOR)
  if (existing instanceof HTMLScriptElement) {
    if (existing.dataset.arcadiaRuffleLoaded === 'true' || hasRufflePlayer()) return
    await waitForScriptLoad(existing)
    return
  }

  const script = document.createElement('script')
  script.src = getRuffleScriptUrl()
  script.async = true
  script.dataset.arcadiaRuffle = 'true'
  const waitPromise = waitForScriptLoad(script)
  document.head.appendChild(script)
  await waitPromise
}

export async function ensureRuffleRuntime(): Promise<void> {
  if (hasRufflePlayer()) return
  if (!loadPromise) {
    loadPromise = loadRuffleScript().catch(error => {
      loadPromise = null
      throw error
    })
  }
  await loadPromise
}
