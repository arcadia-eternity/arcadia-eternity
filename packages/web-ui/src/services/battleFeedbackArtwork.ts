import { battleUiUrl, loadMedia } from './mediaLoader'

const roles = [
  ...Array.from({ length: 10 }, (_, digit) => 'digit:' + digit),
  'digit:minus',
  'miss',
  'absorb',
  'damage:normal',
  'damage:red',
  'damage:blue',
]

// Keep one decoded image per source for the lifetime of the battle, including between hits.
export function createBattleFeedbackArtwork() {
  let attempt: AbortController | undefined
  let artwork: ReadonlyMap<string, HTMLImageElement> = new Map()

  function release() {
    attempt?.abort()
    artwork = new Map()
  }

  async function prepare() {
    release()
    const controller = new AbortController()
    attempt = controller
    const sources = roles.map(role => [role, battleUiUrl(role)] as const)
    const images = new Map<string, HTMLImageElement>()
    controller.signal.addEventListener(
      'abort',
      () => {
        for (const image of images.values()) URL.revokeObjectURL(image.src)
      },
      { once: true },
    )
    const loaded = new Map<string, HTMLImageElement>()
    const results = await Promise.allSettled(
      [...new Set(sources.map(([, url]) => url))].map(async url => {
        const blob = await loadMedia('image', url, controller.signal)
        controller.signal.throwIfAborted()
        const image = new Image()
        image.src = URL.createObjectURL(blob)
        images.set(url, image)
        await image.decode()
        loaded.set(url, image)
      }),
    )
    controller.signal.throwIfAborted()
    const available = new Map<string, HTMLImageElement>()
    for (const [role, url] of sources) {
      const image = loaded.get(url)
      if (image) available.set(role, image)
    }
    artwork = available
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  return {
    prepare,
    release,
    get images() {
      return artwork
    },
  }
}
