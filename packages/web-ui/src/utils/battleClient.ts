import { BattleClient } from '@test-battle/client' // 调整路径到你的client.ts位置
import { reactive } from 'vue'

// 单例模式封装
class BattleClientSingleton {
  private static instance: BattleClient
  private static serverUrl = import.meta.env.VITE_WS_URL

  public static getInstance(): BattleClient {
    if (!BattleClientSingleton.instance) {
      BattleClientSingleton.instance = new BattleClient({
        serverUrl: BattleClientSingleton.serverUrl,
      })
    }
    return BattleClientSingleton.instance
  }
}

export const battleClient = reactive(BattleClientSingleton.getInstance())
