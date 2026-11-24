import type { BrowserWindow, WebContents } from 'electron'

export interface AuthorChangeEvent {
  id: string
  type: string
  file?: string
}

/** Relay only the bound project's invalidation, never generic author data or IPC access. */
export function notifyAuthorPreviewChange(
  windows: Iterable<BrowserWindow>,
  projects: WeakMap<WebContents, string>,
  event: AuthorChangeEvent,
) {
  for (const window of windows) {
    if (window.isDestroyed() || projects.get(window.webContents) !== event.id) continue
    window.webContents.send('author-preview:changed', {
      type: event.type,
      ...(typeof event.file === 'string' ? { file: event.file } : {}),
    })
  }
}
