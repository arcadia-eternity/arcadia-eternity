import type { Server, Socket } from 'socket.io'

export class ClientRealtimeGateway<
  ListenEvents extends Record<string, any> = Record<string, any>,
  EmitEvents extends Record<string, any> = Record<string, any>,
  InterServerEvents extends Record<string, any> = Record<string, any>,
  SocketData extends Record<string, any> = Record<string, any>,
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
    ...args: EmitEvents[EventName] extends (...params: infer Params) => any ? Params : never
  ): void {
    ;(this.io.emit as any)(event, ...args)
  }

  emitToRoom<EventName extends keyof EmitEvents & string>(
    roomId: string,
    event: EventName,
    ...args: EmitEvents[EventName] extends (...params: infer Params) => any ? Params : never
  ): void {
    ;(this.io.to(roomId).emit as any)(event, ...args)
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
