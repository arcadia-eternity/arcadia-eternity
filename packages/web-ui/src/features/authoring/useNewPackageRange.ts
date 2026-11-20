import { computed, ref } from 'vue'
import { validRange } from 'semver'
import { getVersionInfo } from '@/utils/version'

export function arcadiaRangeError(value: string) {
  return value.trim() && (value.length > 256 || !validRange(value.trim())) ? '请输入有效的 Arcadia 版本范围。' : ''
}

export function useNewPackageRange() {
  const defaultRange = '^' + getVersionInfo().version
  const arcadiaRange = ref(defaultRange)
  const rangeError = computed(() => arcadiaRangeError(arcadiaRange.value))
  return { arcadiaRange, defaultRange, rangeError }
}
