import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'

/** One resource owner per main-frame document, including crashed/closed documents. */
export function bindLocalContentOwner(
  contents: Pick<WebContents, 'on' | 'once'>,
  releaseOwner: (owner: string) => void | Promise<void>,
) {
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
