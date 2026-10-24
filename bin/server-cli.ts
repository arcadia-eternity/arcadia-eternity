import 'dotenv/config'
import { Command, CommanderError, InvalidArgumentError } from 'commander'
import { createSingleProcessApp } from '@arcadia-eternity/server'

function portNumber(value: string): number {
  const port = Number(value)
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new InvalidArgumentError('Port must be an integer between 0 and 65535')
  return port
}

export async function runServerCli(args: string[]): Promise<number> {
  const program = new Command('arcadia server')
    .description('Single-process battle server. Rooms and sessions expire when this process stops.')
    .exitOverride()
    .option('-p, --port <number>', 'HTTP and Socket.IO port', portNumber, portNumber(process.env.PORT || '8102'))
    .option('--host <address>', 'Listen address', process.env.HOST || '0.0.0.0')
    .option('--server-id <id>', 'Stable identity of this server', process.env.SERVER_ID || 'arcadia-local')
    .option(
      '--cors-origin <origins>',
      'Allowed browser origins, separated by commas',
      process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173',
    )
  try {
    await program.parseAsync(args, { from: 'user' })
    const options = program.opts<{ port: number; host: string; serverId: string; corsOrigin: string }>()
    const server = createSingleProcessApp({
      port: options.port,
      host: options.host,
      serverId: options.serverId,
      corsOrigins: options.corsOrigin
        .split(',')
        .map(value => value.trim())
        .filter(Boolean),
    })
    await server.start()
    let closing = false
    const stop = () => {
      if (closing) return
      closing = true
      console.log('Stopping server; all rooms and sessions are being discarded.')
      void server
        .stop()
        .catch(error => {
          console.error(error instanceof Error ? error.message : error)
          process.exitCode = 1
        })
        .finally(() => {
          process.removeListener('SIGINT', stop)
          process.removeListener('SIGTERM', stop)
        })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    const address = server.httpServer.address()
    console.log(
      `Battle server ${options.serverId} listening on port ${typeof address === 'object' ? address?.port : options.port}`,
    )
    console.log('Rooms and sessions are held in memory. Restarting abandons all rooms.')
    return 0
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0
    console.error(error instanceof Error ? error.message : error)
    return 1
  }
}
