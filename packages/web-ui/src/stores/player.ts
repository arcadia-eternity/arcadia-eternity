import { defineStore } from 'pinia'
import { z } from 'zod'
import { PlayerSchema, type Player } from '@test-battle/schema'
import { nanoid } from 'nanoid'
import { usePetStorageStore } from './petStorage'
import { ElMessage } from 'element-plus'

// 定义状态类型
interface PlayerState {
  id: string
  name: string
}

export const usePlayerStore = defineStore('player', {
  state: (): PlayerState => ({
    id: '',
    name: '',
  }),

  persist: {
    // 插件配置
    key: 'player-data',
    pick: ['id', 'name'],
    beforeHydrate: ctx => {
      if (!ctx.store.$state.id) {
        const newId = nanoid()
        ctx.store.$patch({
          // @ts-ignore
          id: newId,
          name: `训练师-${newId.slice(0, 4)}`,
        })
      }
    },
  },

  actions: {
    saveToLocal() {
      try {
        // 使用Zod验证数据格式
        const validated = PlayerSchema.pick({
          id: true,
          name: true,
        }).parse({
          id: this.id,
          name: this.name,
        })

        localStorage.setItem('player', JSON.stringify(validated))
      } catch (err) {
        console.error('保存玩家数据失败:', err)
        if (err instanceof z.ZodError) {
          ElMessage.error('玩家数据格式错误，保存失败')
        }
      }
    },

    loadFromLocal() {
      try {
        const saved = localStorage.getItem('player')
        if (!saved) return

        // 解析时进行严格验证
        const parsed = PlayerSchema.pick({
          id: true,
          name: true,
        }).parse(JSON.parse(saved))

        this.id = parsed.id
        this.name = parsed.name
      } catch (err) {
        console.error('读取玩家数据失败:', err)
        localStorage.removeItem('player')
        ElMessage.error('本地玩家数据损坏，已重置')
      }
    },

    setName(newName: string) {
      if (!newName.trim()) {
        ElMessage.warning('玩家名称不能为空')
        return
      }
      if (newName.length > 30) {
        ElMessage.warning('名称长度不能超过20个字符')
        return
      }
      this.name = newName
      this.saveToLocal()
    },

    generateNewId() {
      this.id = nanoid() // 生成固定长度的ID
      this.saveToLocal()
      ElMessage.success('已生成新的玩家ID')
    },
  },

  getters: {
    player: (state): Player => {
      const petStorage = usePetStorageStore()
      try {
        // 验证队伍数据有效性
        const team = petStorage.getCurrentTeam()
        return PlayerSchema.parse({
          ...state,
          team,
        })
      } catch (err) {
        console.error('玩家数据验证失败:', err)
        ElMessage.error('队伍数据异常，请检查精灵配置')
        return {
          ...state,
          team: [], // 返回空队伍防止崩溃
        }
      }
    },
  },
})
