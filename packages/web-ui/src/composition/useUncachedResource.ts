import { computed, shallowRef, watch } from 'vue'
import { readResourceBytes } from '@/services/resourceTransport'
import { imageResourceBlob } from '@/services/imageResource'
import unknownPet from '@/assets/images/unknown-pet.svg'

/** A mounted consumer owns its media bytes. No shared map, persistent store or prefetch. */
export function useUncachedResource(source: () => string, enabled: () => boolean) {
  const url = shallowRef('')
  const error = shallowRef<Error | null>(null)
  watch(
    () => [source(), enabled()] as const,
    ([value, active], _previous, cleanup) => {
      url.value = ''
      error.value = null
      // This exact bundled placeholder is application code, including on arcadia-client://app.
      if (!active || !value || value === unknownPet) return
      const controller = new AbortController()
      let objectUrl: string | undefined
      cleanup(() => {
        controller.abort()
        if (objectUrl) URL.revokeObjectURL(objectUrl)
      })
      void (async () => {
        const bytes = await readResourceBytes(value, { signal: controller.signal })
        const blob = imageResourceBlob(bytes)
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        url.value = objectUrl
      })().catch(reason => {
        if (!controller.signal.aborted) error.value = reason instanceof Error ? reason : new Error(String(reason))
      })
    },
    { immediate: true },
  )
  return { url: computed(() => (enabled() && source() !== unknownPet ? url.value : source())), error }
}
