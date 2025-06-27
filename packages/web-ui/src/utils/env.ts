// Vite aot optimize
export const isTauri = import.meta.env.VITE_IS_TAURI === 'true'

export function onTauri<T>(cb: () => T) {
  if (isTauri)
    return cb()
}

export function onWeb<T>(cb: () => T) {
  if (!isTauri)
    return cb()
}

export function runInEnv<T>(implementations: { tauri: () => T, web: () => T }): T {
  if (isTauri)
    return implementations.tauri()

  else
    return implementations.web()
}
