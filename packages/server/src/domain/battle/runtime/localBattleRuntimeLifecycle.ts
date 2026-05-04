import type { Logger } from 'pino'

import type { LocalBattleRuntimeInstance, LocalBattleRoomData } from './battleRuntimeHost'

export async function startLocalBattleRuntime(
  logger: Logger,
  roomId: string,
  localRoom: LocalBattleRoomData,
  waitForResourcesReady: () => Promise<void>,
): Promise<void> {
  if (localRoom.status !== 'active') {
    logger.warn(
      { roomId, currentStatus: localRoom.status },
      'Room status changed before battle start, aborting battle start',
    )
    return
  }

  logger.info({ roomId }, 'Starting battle asynchronously')

  try {
    logger.info({ roomId }, 'Waiting for game resources to be ready...')
    await waitForResourcesReady()
    logger.info({ roomId }, 'Game resources are ready, proceeding with battle start')
  } catch (error) {
    logger.error({ error, roomId }, 'Failed to load game resources, battle cannot start')
    throw new Error(`游戏资源加载失败: ${error instanceof Error ? error.message : error}`)
  }

  await localRoom.battle.ready()
  logger.info({ roomId }, 'Battle loop started successfully')
}

export async function cleanupLocalBattleRuntime(
  localRoom: LocalBattleRoomData | LocalBattleRuntimeInstance,
): Promise<void> {
  if ('cleanup' in localRoom) {
    await localRoom.cleanup()
    return
  }
  await localRoom.battle.cleanup()
}
