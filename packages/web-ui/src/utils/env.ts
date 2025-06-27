// Tauri 环境检测
// 优先使用环境变量，然后检查 window.__TAURI__ 对象
export const isTauri =
  import.meta.env.VITE_IS_TAURI === 'true' ||
  import.meta.env.VITE_IS_TAURI === true ||
  (typeof window !== 'undefined' && '__TAURI__' in window)

export function onTauri<T>(cb: () => T) {
  if (isTauri) return cb()
}

export function onWeb<T>(cb: () => T) {
  if (!isTauri) return cb()
}

export function runInEnv<T>(implementations: { tauri: () => T; web: () => T }): T {
  if (isTauri) return implementations.tauri()
  else return implementations.web()
}
