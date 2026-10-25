import { describe, expect, it, vi } from 'vitest'
import { connectAndResumeOnlineRoom } from '../onlineSession'

describe('online room recovery across local navigation', () => {
  it('checks and restores on returning online after a connection completed on a local page', async () => {
    let connected = false
    let onlineRoute = true
    let finishConnection!: () => void
    const connecting = new Promise<void>(resolve => {
      finishConnection = () => {
        connected = true
        resolve()
      }
    })
    const session = {
      isConnected: () => connected,
      isOnlineRoute: () => onlineRoute,
      connect: vi.fn(() => connecting),
      checkCurrentRoom: vi.fn(async () => ({ roomCode: 'existing-room' })),
      resumeActiveBattle: vi.fn(async () => {}),
    }

    const firstVisit = connectAndResumeOnlineRoom(session)
    onlineRoute = false
    finishConnection()
    await firstVisit
    expect(session.checkCurrentRoom).not.toHaveBeenCalled()
    expect(session.resumeActiveBattle).not.toHaveBeenCalled()

    onlineRoute = true
    await connectAndResumeOnlineRoom(session)
    expect(session.connect).toHaveBeenCalledTimes(1)
    expect(session.checkCurrentRoom).toHaveBeenCalledTimes(1)
    expect(session.resumeActiveBattle).toHaveBeenCalledTimes(1)
  })

  it('does not redirect a local page when an already connected room lookup completes late', async () => {
    let onlineRoute = true
    let finishLookup!: (room: object) => void
    const pendingRoom = new Promise<object>(resolve => {
      finishLookup = resolve
    })
    const session = {
      isConnected: () => true,
      isOnlineRoute: () => onlineRoute,
      connect: vi.fn(async () => {}),
      checkCurrentRoom: vi.fn(() => pendingRoom),
      resumeActiveBattle: vi.fn(async () => {}),
    }

    const recovery = connectAndResumeOnlineRoom(session)
    onlineRoute = false
    finishLookup({ roomCode: 'existing-room' })
    await recovery

    expect(session.connect).not.toHaveBeenCalled()
    expect(session.resumeActiveBattle).not.toHaveBeenCalled()
  })
})
