import { computed, onMounted, shallowRef, ref } from 'vue'
import { getDesktopDownloads, getDownloadSources } from '@/config/downloadSources'
import { getPlatformInfo } from '@/utils/platformDetection'
import { version } from '../../package.json'

export function useSmartDownload() {
  const sources = getDownloadSources(version)
  const source = ref(sources[0]!.base)
  const downloads = computed(() => getDesktopDownloads(version, source.value))
  const platform = shallowRef<Awaited<ReturnType<typeof getPlatformInfo>>>()
  onMounted(async () => {
    platform.value = await getPlatformInfo()
  })
  const recommended = computed(() =>
    downloads.value.find(
      item => item.platform === platform.value?.platform && item.architecture === platform.value?.architecture,
    ),
  )
  return { version, sources, source, downloads, platform, recommended }
}
