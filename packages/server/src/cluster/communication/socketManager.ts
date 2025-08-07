import { injectable } from 'inversify';
import type { Socket } from 'socket.io';
import pino from 'pino';

const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'info' : 'debug' });

@injectable()
export class SocketManager {
  private readonly activeSockets = new Map<string, Socket>(); // sessionId -> Socket

  public registerSocket(sessionId: string, socket: Socket): void {
    this.activeSockets.set(sessionId, socket);
    logger.debug({ sessionId, socketId: socket.id }, 'Socket registered in local manager.');
  }

  public unregisterSocket(sessionId: string): void {
    if (this.activeSockets.has(sessionId)) {
      this.activeSockets.delete(sessionId);
      logger.debug({ sessionId }, 'Socket unregistered from local manager.');
    }
  }

  public getSocket(sessionId: string): Socket | undefined {
    return this.activeSockets.get(sessionId);
  }

  public getActiveSocketCount(): number {
    return this.activeSockets.size;
  }
}
