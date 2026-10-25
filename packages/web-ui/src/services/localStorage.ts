import { ref } from 'vue'

// Keep the warning for this page session: another successful small write does not
// mean that a failed team or settings write was saved.
export const localStorageUnavailable = ref(false)

export function readLocalData(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    localStorageUnavailable.value = true
    return null
  }
}

export function writeLocalData(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value)
    return true
  } catch {
    localStorageUnavailable.value = true
    return false
  }
}
