import type { Server, Socket } from 'socket.io'
import type { EventsMap } from '@socket.io/component-emitter'

export class ClientRealtimeGateway<
  ListenEvents extends EventsMap = EventsMap,
  EmitEvents extends EventsMap = EventsMap,
  InterServerEvents extends EventsMap = EventsMap,
  SocketData = unknown,
> {
  constructor(private readonly io: Server<ListenEvents, EmitEvents, InterServerEvents, SocketData>) {}

  use(
    middleware: (
      socket: Socket<ListenEvents, EmitEvents, InterServerEvents, SocketData>,
      next: (err?: Error) => void,
    ) => void | Promise<void>,
  ): void {
    this.io.use(middleware)
  }

  onConnection(
    handler: (socket: Socket<ListenEvents, EmitEvents, InterServerEvents, SocketData>) => void | Promise<void>,
  ): void {
    this.io.on('connection', handler)
  }

  emit<EventName extends keyof EmitEvents & string>(
    event: EventName,
    ...args: EmitEvents[EventName] extends (...params: infer Params) => void ? Params : never
  ): void {
    ;(this.io.emit as (event: string, ...args: unknown[]) => boolean)(event, ...args)
  }

  emitToRoom<EventName extends keyof EmitEvents & string>(
    roomId: string,
    event: EventName,
    ...args: EmitEvents[EventName] extends (...params: infer Params) => void ? Params : never
  ): void {
    ;(this.io.to(roomId).emit as (event: string, ...args: unknown[]) => boolean)(event, ...args)
  }

  getRoomSocketIds(roomId: string): string[] {
    return Array.from(this.io.sockets.adapter.rooms.get(roomId) ?? [])
  }

  getSocket(socketId: string): Socket<ListenEvents, EmitEvents, InterServerEvents, SocketData> | undefined {
    return this.io.sockets.sockets.get(socketId)
  }

  getSocketById(socketId: string): Socket<ListenEvents, EmitEvents, InterServerEvents, SocketData> | undefined {
    return this.getSocket(socketId)
  }

  onEngineClose(handler: () => void): void {
    this.io.engine.on('close', handler)
  }

  close(): void {
    this.io.close()
  }

  raw(): Server<ListenEvents, EmitEvents, InterServerEvents, SocketData> {
    return this.io
  }
}
