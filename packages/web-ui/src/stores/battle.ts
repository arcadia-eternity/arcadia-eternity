import { defineStore } from 'pinia'
import { battleClient } from '../utils/battleClient'
import type { BattleState, BattleMessage } from '@test-battle/const'
import type { Player, PlayerSelection } from '@test-battle/schema'
import type { ErrorResponse, SuccessResponse } from '@test-battle/protocol'
import { useRouter } from 'vue-router'

export const useBattleStore = defineStore('battle', {
  state: () => ({
    battleSessionId: null as string | null,
    state: null as BattleState | null,
    log: [] as BattleMessage[],
    availableActions: [] as PlayerSelection[],
    isMatching: false,
    errorMessage: null as string | null,
  }),

  actions: {
    async init() {
      try {
        battleClient.on('battleEvent', (msg: BattleMessage) => {
          this.log.push(msg)
          if (msg.type === 'BATTLE_STATE') this.state = msg.data
        })

        battleClient.on(
          'matchSuccess',
          (
            res: SuccessResponse<{
              roomId: string
              opponent: { id: string; name: string }
            }>,
          ) => {
            if (res.status === 'SUCCESS') {
              this.handleMatchFound(res.data.roomId)
            }
          },
        )

        battleClient.on('matchmakingError', (err: ErrorResponse) => {
          this.errorMessage = err.details || '匹配服务错误'
        })
      } catch (err) {
        this.errorMessage = (err as Error).message || '连接服务器失败'
      }
    },

    async joinMatchmaking(playerData: Player) {
      try {
        this.isMatching = true
        this.errorMessage = null

        // 先注册匹配成功监听
        const matchPromise = new Promise<string>((resolve, reject) => {
          const successHandler = (res: SuccessResponse<{ roomId: string; opponent: { id: string; name: string } }>) => {
            if (res.status === 'SUCCESS') {
              resolve(res.data.roomId)
              this.handleMatchFound(res.data.roomId)
            }
          }

          const errorHandler = (err: ErrorResponse) => {
            reject(new Error(err.details || '匹配失败'))
          }

          // 使用once避免重复监听
          battleClient.once('matchSuccess', successHandler)
          battleClient.once('matchmakingError', errorHandler)

          // 设置超时
          setTimeout(() => {
            battleClient.off('matchSuccess', successHandler)
            battleClient.off('matchmakingError', errorHandler)
            reject(new Error('匹配超时'))
          }, 30000)
        })

        // 发起匹配请求（不等待立即返回的ACK）
        await battleClient.joinMatchmaking(playerData)

        // 等待匹配成功事件
        const roomId = await matchPromise
        await this.initSession(roomId)
      } catch (err) {
        this.errorMessage = (err as Error).message || '匹配失败'
        this.isMatching = false
        throw err // 抛出错误供上层处理
      }
    },

    async cancelMatchmaking() {
      if (this.battleSessionId) {
        await battleClient.cancelMatchmaking()
        this.isMatching = false
        this.resetBattle()
      }
    },

    async initSession(roomId: string) {
      this.battleSessionId = roomId
      const router = useRouter()
      router.push({ path: '/battle', query: { roomId } }) // 添加类型安全跳转
    },

    handleMatchFound(roomId: string) {
      this.battleSessionId = roomId
      this.isMatching = false
    },

    resetBattle() {
      battleClient.disconnect()
      this.battleSessionId = null
      this.state = null
      this.log = []
      this.availableActions = []
      this.isMatching = false
    },
  },
})
