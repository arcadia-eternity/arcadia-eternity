<template>
  <div class="local-battle-container">
    <h1>本地对战测试</h1>

    <!-- 对战控制区域 -->
    <div class="battle-control">
      <button @click="startLocalBattle" class="start-button" :disabled="isLoading">
        {{ isLoading ? '资源加载中...' : '开始本地对战' }}
      </button>

      <!-- 错误提示 -->
      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBattleStore } from '@/stores/battle'
import { usePlayerStore } from '@/stores/player'
import { LocalBattleSystem } from '@test-battle/local-adapter'
import { HttpLoader } from '@test-battle/httploader'
import { AIPlayer, Battle, Player } from '@test-battle/battle'
import { PlayerParser } from '@test-battle/parser'
import { nanoid } from 'nanoid'

const router = useRouter()
const battleStore = useBattleStore()
const playerStore = usePlayerStore()
const errorMessage = ref<string | null>(null)
const isLoading = ref(true)

// 生成镜像队伍
const createMirrorTeam = () => {
  const originalPlayer = playerStore.player
  return {
    ...originalPlayer,
    name: '镜像对手',
    id: nanoid(),
    team: originalPlayer.team.map(pet => ({
      ...pet,
      name: `${pet.name}-镜像`,
      id: nanoid(),
    })),
  }
}

// 初始化HTTP加载器
onMounted(async () => {
  try {
    const loader = new HttpLoader({
      baseUrl: import.meta.env.VITE_DATA_API_URL || '/data',
    })
    await loader.loadGameData()
  } catch (error) {
    errorMessage.value = `资源加载失败: ${(error as Error).message}`
  } finally {
    isLoading.value = false
  }
})

const startLocalBattle = async () => {
  try {
    const createAIPlayer = (basePlayer: Player) => new AIPlayer(basePlayer.name, basePlayer.id, basePlayer.team)
    const player1 = PlayerParser.parse(playerStore.player)
    const player2 = createAIPlayer(PlayerParser.parse(createMirrorTeam()))

    const battle = new Battle(player1, player2, {
      allowFaintSwitch: true,
    })
    const localSystem = new LocalBattleSystem(battle)
    localSystem.init()
    await battleStore.initBattle(localSystem, player1.id)
    router.push('/battle')
  } catch (error) {
    errorMessage.value = (error as Error).message
    setTimeout(() => (errorMessage.value = null), 3000)
  }
}
</script>

<style scoped>
.local-battle-container {
  max-width: 800px;
  margin: 2rem auto;
  padding: 20px;
  text-align: center;
}

.start-button {
  padding: 12px 24px;
  font-size: 1.1rem;
  background-color: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.3s;
}

.start-button:hover {
  background-color: #1976d2;
}

.error-message {
  color: #ff4444;
  margin-top: 15px;
  padding: 10px;
  border: 1px solid #ff4444;
  border-radius: 4px;
  background-color: #ffe6e6;
}
</style>
