import { WebSocketServer, type WebSocket } from 'ws'
import type { PeerTransportMessage } from './peerTransport'

interface WebSocketRelayEnvelope {
  to?: string
  message: PeerTransportMessage
}

export interface WebSocketRelayServerStartOptions {
  host?: string
  port?: number
}

export class WebSocketRelayServer {
  private server?: WebSocketServer
  private readonly rooms = new Map<string, Map<string, WebSocket>>()

  get url(): string {
    const address = this.server?.address()
    if (!address || typeof address === 'string') {
      throw new Error('WebSocket relay server is not listening')
    }
    return `ws://127.0.0.1:${address.port}`
  }

  async start(options: WebSocketRelayServerStartOptions = {}): Promise<string> {
    if (this.server) {
      return this.url
    }

    const host = options.host ?? '127.0.0.1'
    const port = options.port ?? 0

    this.server = new WebSocketServer({ host, port })
    this.server.on('connection', (socket, request) => {
      const requestUrl = new URL(request.url ?? '/', 'ws://127.0.0.1')
      const roomId = requestUrl.searchParams.get('roomId')
      const peerId = requestUrl.searchParams.get('peerId')
      if (!roomId || !peerId) {
        socket.close(1008, 'roomId and peerId are required')
        return
      }

      let room = this.rooms.get(roomId)
      if (!room) {
        room = new Map<string, WebSocket>()
        this.rooms.set(roomId, room)
      }
      room.set(peerId, socket)

      socket.on('message', data => {
        const raw = typeof data === 'string' ? data : data.toString()
        const parsed = JSON.parse(raw) as WebSocketRelayEnvelope
        this.forward(roomId, peerId, parsed)
      })

      socket.on('close', () => {
        const currentRoom = this.rooms.get(roomId)
        currentRoom?.delete(peerId)
        if (currentRoom && currentRoom.size === 0) {
          this.rooms.delete(roomId)
        }
      })
    })

    await new Promise<void>(resolve => {
      this.server!.once('listening', () => resolve())
    })

    return this.url
  }

  async stop(): Promise<void> {
    if (!this.server) return
    for (const room of this.rooms.values()) {
      for (const socket of room.values()) {
        socket.close()
      }
    }
    this.rooms.clear()
    await new Promise<void>((resolve, reject) => {
      this.server!.close(error => {
        if (error) reject(error)
        else resolve()
      })
    })
    this.server = undefined
  }

  private forward(roomId: string, senderPeerId: string, envelope: WebSocketRelayEnvelope): void {
    const room = this.rooms.get(roomId)
    if (!room) return

    if (envelope.to) {
      room.get(envelope.to)?.send(JSON.stringify(envelope.message))
      return
    }

    for (const [peerId, socket] of room.entries()) {
      if (peerId === senderPeerId) continue
      socket.send(JSON.stringify(envelope.message))
    }
  }
}
