/** Relay only the bound project's invalidation, never generic author data or IPC access. */
export function notifyAuthorPreviewChange(windows, projects, event) {
  for (const window of windows) {
    if (window.isDestroyed() || projects.get(window.webContents) !== event.id) continue
    window.webContents.send('author-preview:changed', {
      type: event.type,
      ...(typeof event.file === 'string' ? { file: event.file } : {}),
    })
  }
}
