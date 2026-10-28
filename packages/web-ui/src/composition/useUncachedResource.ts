import { computed, shallowRef, watch } from 'vue'

/** A mounted consumer owns its media bytes. No shared map, persistent store or prefetch. */
export function useUncachedResource(source: () => string, enabled: () => boolean) {
  const url = shallowRef('')
  const error = shallowRef<Error | null>(null)
  watch(
    () => [source(), enabled()] as const,
    ([value, active], _previous, cleanup) => {
      url.value = ''
      error.value = null
      if (!active || !value) return
      const controller = new AbortController()
      let objectUrl: string | undefined
      cleanup(() => {
        controller.abort()
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      })
      void (async () => {
        const response = await fetch(value, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
        if (!response.ok) throw new Error(`资源加载失败 (${response.status})`)
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        url.value = objectUrl
      })().catch(reason => {
        if (!controller.signal.aborted) error.value = reason instanceof Error ? reason : new Error(String(reason))
      })
    },
    { immediate: true },
  )
  return { url: computed(() => (enabled() ? url.value : source())), error }
}
