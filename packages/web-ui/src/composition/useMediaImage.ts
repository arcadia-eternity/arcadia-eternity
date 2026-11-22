import { computed, getCurrentInstance, onBeforeUnmount, shallowRef, watch } from 'vue'
import { mediaEnvironment, loadMedia, mediaSourceKey, type DraftMediaSource } from '@/services/mediaLoader'
import unknownPet from '@/assets/images/unknown-pet.svg'

/** Decoded bytes may be shared. Each mounted image owns its object URL until its DOM is removed. */
export function useMediaImage(
  source: () => string | DraftMediaSource | undefined,
  enabled: () => boolean = () => true,
) {
  const url = shallowRef('')
  const ready = shallowRef<Promise<void>>(Promise.resolve())
  const error = shallowRef<Error | null>(null)
  const owner = getCurrentInstance()
  let unmounting = false
  if (owner)
    onBeforeUnmount(() => {
      unmounting = true
    })
  const release = (objectUrl: string) => {
    const element = unmounting ? (owner?.subTree.el as Node | undefined) : undefined
    const Observer = element?.ownerDocument?.defaultView?.MutationObserver
    if (!element?.isConnected || !Observer) {
      URL.revokeObjectURL(objectUrl)
      return
    }
    // Vue stops child scopes before an ancestor's leave animation removes its
    // DOM. Keep that consumer's image valid until the retained DOM is detached.
    const observer = new Observer(() => {
      if (element.isConnected) return
      observer.disconnect()
      URL.revokeObjectURL(objectUrl)
    })
    observer.observe(element.ownerDocument!, { childList: true, subtree: true })
  }
  watch(
    [
      () => {
        const value = source()
        return value && mediaSourceKey(value)
      },
      enabled,
      () => (typeof source() === 'string' ? mediaEnvironment().scope : undefined),
    ],
    (_, _previous, cleanup) => {
      const value = source()
      ready.value = Promise.resolve()
      url.value = ''
      error.value = null
      // This exact bundled placeholder is application code, including on arcadia-client://app.
      if (!enabled() || !value || value === unknownPet) return
      const controller = new AbortController()
      let objectUrl: string | undefined
      cleanup(() => {
        controller.abort()
        if (objectUrl) release(objectUrl)
      })
      ready.value = (async () => {
        const blob = await loadMedia('image', value, controller.signal)
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        url.value = objectUrl
      })().catch(reason => {
        if (!controller.signal.aborted) error.value = reason instanceof Error ? reason : new Error(String(reason))
      })
    },
    { immediate: true },
  )
  return { ready, url: computed(() => (source() === unknownPet ? unknownPet : url.value)), error }
}
