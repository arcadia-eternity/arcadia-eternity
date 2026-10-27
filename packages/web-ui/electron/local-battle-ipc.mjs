/** Only the current desktop main frame may select a project or manage its host. */
export function isTrustedDesktopRequest(event, webContents, rendererUrl) {
  if (!webContents || event.sender !== webContents || event.senderFrame !== webContents.mainFrame) return false
  try {
    const actual = new URL(event.senderFrame.url)
    const expected = new URL(rendererUrl)
    if (expected.protocol === 'file:') return actual.protocol === 'file:' && actual.pathname === expected.pathname
    return ['http:', 'https:'].includes(expected.protocol) && actual.origin === expected.origin
  } catch {
    return false
  }
}
