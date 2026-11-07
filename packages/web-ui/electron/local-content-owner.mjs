import { randomUUID } from 'node:crypto'

/** One resource owner per main-frame document, including crashed/closed documents. */
export function bindLocalContentOwner(contents, releaseOwner) {
  let owner = randomUUID()
  const retire = () => {
    const previous = owner
    owner = randomUUID()
    void Promise.resolve(releaseOwner(previous)).catch(() => {})
  }
  contents.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) retire()
  })
  contents.on('render-process-gone', retire)
  contents.once('destroyed', retire)
  return { current: () => owner }
}
