interface OnlineRoomSession {
  isConnected: () => boolean
  isOnlineRoute: () => boolean
  connect: () => Promise<void>
  checkCurrentRoom: () => Promise<unknown>
  resumeActiveBattle: () => Promise<void>
}

export async function connectAndResumeOnlineRoom(session: OnlineRoomSession): Promise<void> {
  if (!session.isConnected()) await session.connect()
  // Slow connection or room requests must not replace a local battle opened
  // while waiting. Returning to an online page still checks an existing socket.
  if (!session.isOnlineRoute()) return
  const room = await session.checkCurrentRoom()
  if (room && session.isOnlineRoute()) await session.resumeActiveBattle()
}
