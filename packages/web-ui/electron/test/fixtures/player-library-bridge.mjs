import { createServer } from 'node:http'
import { playerLibraryRoute, registerPlayerLibrary } from '../../player-library-bridge.mjs'

/** Stand in for the player's existing loopback resource server in Node integration tests. */
export async function startTestPlayerLibraryBridge(options) {
  let registration
  const server = createServer((request, response) => {
    if (request.url === playerLibraryRoute && registration) void registration.handle(request, response)
    else response.writeHead(404).end()
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const stop = () =>
    new Promise(resolve => {
      server.close(resolve)
      server.closeAllConnections()
    })
  try {
    registration = await registerPlayerLibrary({ ...options, port: server.address().port })
  } catch (error) {
    await stop()
    throw error
  }
  return {
    async close() {
      await registration.close()
      registration = undefined
      await stop()
    },
  }
}
