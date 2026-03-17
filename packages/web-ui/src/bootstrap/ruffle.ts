const RUFFLE_SCRIPT_SELECTOR = 'script[data-arcadia-ruffle]'

let loadPromise: Promise<void> | null = null

function getRuffleScriptUrl(): string {
  if (window.location.protocol === 'file:') {
    return new URL('./ruffle/ruffle.js', window.location.href).toString()
  }
  return `${import.meta.env.BASE_URL}ruffle/ruffle.js`
}

function hasRufflePlayer(): boolean {
  return typeof (window as Window & { RufflePlayer?: unknown }).RufflePlayer !== 'undefined'
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
