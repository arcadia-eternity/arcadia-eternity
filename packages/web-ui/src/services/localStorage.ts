import { ref } from 'vue'

// Keep the warning for this page session: another successful small write does not
// mean that a failed team or settings write was saved.
export const localStorageUnavailable = ref(false)

export function readLocalData(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    localStorageUnavailable.value = true
    return null
  }
}

export function writeLocalData(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch {
    localStorageUnavailable.value = true
    return false
  }
}

// The Pinia plugin must receive this object rather than reading the browser's
// storage getter while it parses persistence options outside its error handler.
export const localDataStorage = { getItem: readLocalData, setItem: writeLocalData }
