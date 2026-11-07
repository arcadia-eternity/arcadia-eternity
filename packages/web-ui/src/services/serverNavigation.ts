import { ElMessageBox } from 'element-plus'
import { authorizeLocalBackend } from '@/bootstrap/deployment'
import { useBattleClientStore } from '@/stores/battleClient'
import { usePrivateRoomStore } from '@/stores/privateRoom'

/** Switching play is explicit; inspecting or managing a server never calls this. */
export async function enterLocalServer(): Promise<boolean> {
  const client = useBattleClientStore()
  const rooms = usePrivateRoomStore()
  const status = await window.arcadiaDesktop?.getLocalBattleStatus?.()
  if (status?.status !== 'running') throw new Error('本机服务器尚未启动')
  if (client.serverUrl !== status.url) {
    if (rooms.currentRoom) {
      try {
        await ElMessageBox.confirm(
          rooms.currentRoom.status === 'started'
            ? '进入本机服务器会离开当前房间并终止正在进行的对局。'
            : '进入本机服务器会离开当前房间。',
          '切换游玩服务器',
          { confirmButtonText: '离开并切换', cancelButtonText: '留在当前房间', type: 'warning' },
        )
      } catch {
        return false
      }
    }
    await authorizeLocalBackend()
    await rooms.switchServer(status.url)
  } else if (!client.isConnected) await client.connect()
  return true
}

export function serverOrigin(value: string): string {
  const url = new URL(value.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('请输入完整的 HTTP 或 HTTPS 主机地址')
  return url.origin
}
