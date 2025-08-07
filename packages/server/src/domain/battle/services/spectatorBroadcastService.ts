import { injectable, inject } from 'inversify';
import pino from 'pino';
import type { RedisClientManager as RedisManager } from '../../../cluster/redis/redisClient';
import { TYPES } from '../../../types';
import type { ClusterStateManager } from '../../../cluster/core/clusterStateManager';
import type { SocketManager } from '../../../cluster/communication/socketManager';
import type { BattleMessage } from '@arcadia-eternity/const';

const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
});

@injectable()
export class SpectatorBroadcastService {
  private subscriber;
  private isSubscribed = false;

  constructor(
    @inject(TYPES.RedisManager) private readonly redisManager: RedisManager,
    @inject(TYPES.ClusterStateManager) private readonly stateManager: ClusterStateManager,
    @inject(TYPES.SocketManager) private readonly socketManager: SocketManager,
  ) {
    this.subscriber = this.redisManager.getSubscriber();
  }

  public async initialize(): Promise<void> {
    if (this.isSubscribed) {
      logger.warn('SpectatorBroadcastService is already initialized.');
      return;
    }

    try {
      await this.subscriber.psubscribe('battle-spectators:*');
      this.subscriber.on('pmessage', this.handleMessage.bind(this));
      this.isSubscribed = true;
      logger.info('SpectatorBroadcastService initialized and subscribed to battle-spectators:*');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize SpectatorBroadcastService');
    }
  }

  private async handleMessage(pattern: string, channel: string, message: string): Promise<void> {
    const roomId = channel.split(':')[1];
    if (!roomId) return;

    try {
      const roomState = await this.stateManager.getRoomState(roomId);
      // We don't check for instanceId here, because the message is for all instances.
      // Each instance will check its local SocketManager.
      if (!roomState) return;

      const battleMessage = JSON.parse(message) as BattleMessage;

      for (const spectator of roomState.spectators) {
        const socket = this.socketManager.getSocket(spectator.sessionId);
        if (socket) {
          // This socket is connected to the current instance, so we send the message.
          socket.emit('battleEvent', battleMessage);
        }
      }
    } catch (error) {
      logger.error({ error, roomId, channel }, 'Failed to process spectator message');
    }
  }

  public async cleanup(): Promise<void> {
    if (!this.isSubscribed) return;

    try {
      await this.subscriber.punsubscribe('battle-spectators:*');
      this.subscriber.removeAllListeners('pmessage');
      this.isSubscribed = false;
      logger.info('SpectatorBroadcastService cleaned up.');
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup SpectatorBroadcastService');
    }
  }
}