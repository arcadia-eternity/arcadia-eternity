import { createServer } from 'node:http'
import { playerLibraryRoute, registerPlayerLibrary } from '../../player-library-bridge.ts'

/** Stand in for the player's existing loopback resource server in Node integration tests. */
export async function startTestPlayerLibraryBridge(options: Omit<Parameters<typeof registerPlayerLibrary>[0], 'port'>) {
  let registration: Awaited<ReturnType<typeof registerPlayerLibrary>> | undefined
  const server = createServer((request, response) => {
    if (request.url === playerLibraryRoute && registration) void registration.handle(request, response)
    else response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const stop = () =>
    new Promise<void>(resolve => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  try {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Player library test server did not bind to a TCP port')
    registration = await registerPlayerLibrary({ ...options, port: address.port })
  } catch (error) {
    await stop()
    throw error
  }
  return {
    async close() {
      await registration?.close()
      registration = undefined
      await stop()
    },
  }
}
