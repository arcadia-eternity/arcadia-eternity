<script setup lang="ts">
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import SimpleBattleTimer from '@/components/SimpleBattleTimer.vue'
import DeveloperPanel from '@/components/battle/DeveloperPanel.vue'
import Mark from '@/components/battle/Mark.vue'
import PetButton from '@/components/battle/PetButton.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import { useBattleAnimations } from '@/composition/useBattleAnimations'
import { useMusic } from '@/composition/music'
import { useSound } from '@/composition/sound'
import { useBattleStore } from '@/stores/battle'
import { useBattleReportStore } from '@/stores/battleReport'
import { useGameDataStore } from '@/stores/gameData'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { logMessagesKey, markMapKey, petMapKey, playerMapKey, skillMapKey } from '@/symbol/battlelog'
import {
  BattleMessageType,
  Category,
  type BattleMessage,
  type petId,
  type PetSwitchMessage,
  type skillId,
  type SkillMessage,
  type SkillUseEndMessage,
} from '@arcadia-eternity/const'
import gsap from 'gsap'
import i18next from 'i18next'
import mitt from 'mitt'
import {
  catchError,
  concatMap,
  filter,
  finalize,
  from,
  mergeMap,
  of,
  startWith,
  take,
  takeUntil,
  tap,
  toArray,
} from 'rxjs'
import { ActionState } from 'seer2-pet-animator'
import {
  computed,
  onMounted,
  onUnmounted,
  provide,
  ref,
  useTemplateRef,
  nextTick,
  watch,
  withDefaults,
  unref,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useBattleViewStore } from '@/stores/battleView'
import { useMobile } from '@/composition/useMobile'
import { Z_INDEX, Z_INDEX_CLASS } from '@/constants/zIndex'
import { DArrowLeft, DArrowRight, VideoPause, VideoPlay, Film, FullScreen, Aim, Warning } from '@element-plus/icons-vue'

// Props 定义
interface Props {
  replayMode?: boolean
  battleRecordId?: string
  localReportId?: string
  enableDeveloperMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  replayMode: false,
  battleRecordId: undefined,
  localReportId: undefined,
  enableDeveloperMode: false,
})

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}
const panelState = ref<PanelState>(PanelState.SKILLS)

// 定义一个更精确的类型，用于 handleCombatEventMessage，确保消息有 target
type CombatEventMessageWithTarget = Extract<
  BattleMessage,
  | { type: BattleMessageType.SkillMiss; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.Damage; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.DamageFail; data: { target: petId; [key: string]: any } }
  | { type: BattleMessageType.Heal; data: { target: petId; [key: string]: any } }
>

type AnimationEvents = {
  'attack-hit': 'left' | 'right'
  'animation-complete': 'left' | 'right'
}

const emitter = mitt<AnimationEvents>()

const route = useRoute()
const router = useRouter()
const store = useBattleStore()
const battleReportStore = useBattleReportStore()
const gameDataStore = useGameDataStore()
const resourceStore = useResourceStore()
const gameSettingStore = useGameSettingStore()
const battleViewStore = useBattleViewStore()

// 自适应缩放相关
const battleContainerRef = useTemplateRef('battleContainerRef')
let resizeObserver: ResizeObserver | null = null

// 移动端检测
const { isMobile, isPortrait } = useMobile()

// 全屏相关
const isFullscreen = ref(false)
const showOrientationHint = computed(() => isMobile.value && isPortrait.value && !isFullscreen.value)

// 自定义确认对话框（用于全屏模式）
const showCustomConfirm = ref(false)
const customConfirmTitle = ref('')
const customConfirmMessage = ref('')
const customConfirmResolve = ref<((value: boolean) => void) | null>(null)

// 自定义确认对话框方法
const showCustomConfirmDialog = (title: string, message: string): Promise<boolean> => {
  return new Promise(resolve => {
    customConfirmTitle.value = title
    customConfirmMessage.value = message
    customConfirmResolve.value = resolve
    showCustomConfirm.value = true
  })
}

// 处理自定义确认对话框的确认
const handleCustomConfirm = (confirmed: boolean) => {
  showCustomConfirm.value = false
  if (customConfirmResolve.value) {
    customConfirmResolve.value(confirmed)
    customConfirmResolve.value = null
  }
}

// 进入全屏模式
const enterFullscreen = async () => {
  try {
    const element = battleContainerRef.value
    if (!element) return

    // 请求全屏
    if (element.requestFullscreen) {
      await element.requestFullscreen()
    } else if ((element as any).webkitRequestFullscreen) {
      await (element as any).webkitRequestFullscreen()
    } else if ((element as any).msRequestFullscreen) {
      await (element as any).msRequestFullscreen()
    }

    isFullscreen.value = true

    // 尝试锁定屏幕方向为横屏
    if (screen.orientation && (screen.orientation as any).lock) {
      try {
        await (screen.orientation as any).lock('landscape')
      } catch (error) {
        console.warn('无法锁定屏幕方向:', error)
      }
    }
  } catch (error) {
    console.error('进入全屏失败:', error)
  }
}

// 退出全屏模式
const exitFullscreen = async () => {
  try {
    if (document.exitFullscreen) {
      await document.exitFullscreen()
    } else if ((document as any).webkitExitFullscreen) {
      await (document as any).webkitExitFullscreen()
    } else if ((document as any).msExitFullscreen) {
      await (document as any).msExitFullscreen()
    }

    isFullscreen.value = false

    // 解锁屏幕方向
    if (screen.orientation && (screen.orientation as any).unlock) {
      try {
        ;(screen.orientation as any).unlock()
      } catch (error) {
        console.warn('无法解锁屏幕方向:', error)
      }
    }
  } catch (error) {
    console.error('退出全屏失败:', error)
  }
}

// 切换全屏模式
const toggleFullscreen = () => {
  if (isFullscreen.value) {
    exitFullscreen()
  } else {
    enterFullscreen()
  }
}

// 监听全屏状态变化
const handleFullscreenChange = () => {
  const isCurrentlyFullscreen = !!(
    document.fullscreenElement ||
    (document as any).webkitFullscreenElement ||
    (document as any).msFullscreenElement
  )
  isFullscreen.value = isCurrentlyFullscreen
}

useMusic()

provide(logMessagesKey, store.log)
provide(markMapKey, store.markMap)
provide(skillMapKey, store.skillMap)
provide(petMapKey, store.petMap)
provide(playerMapKey, store.playerMap)
const battleViewRef = useTemplateRef('battleViewRef')
const leftPetRef = useTemplateRef('leftPetRef')
const rightPetRef = useTemplateRef('rightPetRef')
const leftStatusRef = useTemplateRef('leftStatusRef')
const rightStatusRef = useTemplateRef('rightStatusRef')
// 移除了 useElementBounding 相关代码，现在使用固定坐标系统
const isPending = ref(false)
const showBattleEndUI = ref(false)
const showKoBanner = ref(false) // 新增：控制KO横幅显示
const koBannerRef = useTemplateRef('koBannerRef') // 新增：KO横幅的模板引用

// 使用battleView store中的缩放
const battleViewScale = computed(() => battleViewStore.scale)

// 开发者模式配置
const developerModeConfig = computed(() => {
  return {
    // 基础条件检查
    isExplicitlyEnabled: props.enableDeveloperMode === true,
    isDevelopmentEnv: import.meta.env.DEV,

    // 模式排除检查
    isNotReplayMode: !isReplayMode.value && !props.replayMode,
    isNotBattleReport: !props.battleRecordId && !props.localReportId,

    // 获取当前模式描述
    get currentMode() {
      if (props.replayMode || isReplayMode.value) return 'replay'
      if (props.battleRecordId) return 'battle-report'
      if (props.localReportId) return 'local-battle-report'
      if (props.enableDeveloperMode) return 'local-battle'
      return 'normal-battle'
    },

    // 检查是否应该启用开发者模式
    get shouldEnable() {
      return this.isExplicitlyEnabled && this.isNotReplayMode && this.isDevelopmentEnv && this.isNotBattleReport
    },
  }
})

// 开发者模式检测
const isDeveloperMode = computed(() => {
  const config = developerModeConfig.value

  // 在开发环境下提供调试信息
  if (import.meta.env.DEV && props.enableDeveloperMode) {
    console.debug('Developer mode check:', {
      mode: config.currentMode,
      enabled: config.shouldEnable,
      conditions: {
        isExplicitlyEnabled: config.isExplicitlyEnabled,
        isNotReplayMode: config.isNotReplayMode,
        isDevelopmentEnv: config.isDevelopmentEnv,
        isNotBattleReport: config.isNotBattleReport,
      },
    })
  }

  return config.shouldEnable
})

// 开发者面板状态
const isDeveloperPanelOpen = ref(false)

// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.battleState?.marks ?? [])
const currentTurn = computed(() => store.battleState?.currentTurn ?? 0)

const {
  showMissMessage,
  showAbsorbMessage,
  showDamageMessage,
  showHealMessage,
  showUseSkillMessage,
  cleanup: cleanupBattleAnimations,
} = useBattleAnimations(battleViewRef as Ref<HTMLElement | null>, store, currentPlayer, opponentPlayer, battleViewScale)

const leftPetSpeciesNum = computed(
  () =>
    gameDataStore.getSpecies(
      currentPlayer.value?.team?.filter(p => p.id === currentPlayer.value!.activePet)[0]?.speciesID ?? '',
    )?.num ?? 0,
)
const rightPetSpeciesNum = computed(
  () =>
    gameDataStore.getSpecies(
      opponentPlayer.value?.team?.filter(p => p.id === opponentPlayer.value!.activePet)[0]?.speciesID ?? '',
    )?.num ?? 0,
)

const allTeamMemberSpritesNum = computed<number[]>(() => {
  const allMembers = [...(currentPlayer.value?.team || []), ...(opponentPlayer.value?.team || [])]
  return allMembers.map(pet => gameDataStore.getSpecies(pet.speciesID)?.num || 0)
})

// 侧栏精灵列表
const leftPlayerPets = computed(() => currentPlayer.value?.team || [])
const rightPlayerPets = computed(() => opponentPlayer.value?.team || [])

const allSkillId = computed(() => {
  if (!store.battleState?.players) return []
  return store.battleState.players
    .map(p => p.team)
    .flat()
    .filter(p => p !== undefined)
    .map(p => p.skills ?? [])
    .flat()
    .map(s => s.baseId)
})
const { playSkillSound, playPetSound, playVictorySound } = useSound(allSkillId, allTeamMemberSpritesNum)

const background = computed(() => {
  if (gameSettingStore.background === 'random') {
    return Object.values(resourceStore.background.byId)[
      Math.floor(Math.random() * resourceStore.background.allIds.length)
    ]
  }
  return (
    resourceStore.getBackGround(gameSettingStore.background) ??
    'https://seer2-resource.yuuinih.com/png/battleBackground/grass.png'
  )
})

const availableSkills = computed<SkillMessage[]>(() => {
  if (!currentPlayer.value?.activePet) return []
  return store.getPetById(currentPlayer.value.activePet)?.skills?.filter(skill => !skill.isUnknown) ?? []
})

const handleSkillClick = (skillId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handlePetSelect = (petId: string) => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'switch-pet' && a.pet === petId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handleEscape = async () => {
  if (isPending.value) return
  const action = store.availableActions.find(a => a.type === 'surrender')
  if (!action) return

  try {
    // 统一使用自定义确认对话框
    const confirmed = await showCustomConfirmDialog(
      i18next.t('surrender-confirm-title', {
        ns: 'battle',
        defaultValue: '确认投降',
      }),
      i18next.t('surrender-confirm-message', {
        ns: 'battle',
        defaultValue: '确定要投降吗？投降后将直接结束战斗。',
      }),
    )

    // 用户确认投降，执行投降操作
    if (confirmed) {
      store.sendplayerSelection(action)
    }
  } catch {
    // 用户取消投降，不执行任何操作
  }
}

const battleResult = computed(() => {
  if (!store.isBattleEnd) return ''
  return store.victor === store.playerId ? '胜利！' : store.victor ? '失败...' : '平局'
})

const isSkillAvailable = (skillId: skillId) => {
  return store.availableActions?.some(a => a.type === 'use-skill' && a.skill === skillId) ?? false
}

const isPetSwitchable = (petId: petId) => {
  return store.availableActions?.some(a => a.type === 'switch-pet' && a.pet === petId) ?? false
}

// 回放模式相关
const isReplayMode = computed(() => props.replayMode)
const currentReplayTurn = computed(() => store.currentReplayTurn)
const totalReplayTurns = computed(() => store.totalReplayTurns)
// 用于显示的回合数（从1开始）
const currentReplayTurnNumber = computed(() => store.currentReplayTurnNumber)
const totalReplayTurnNumber = computed(() => store.totalReplayTurnNumber)

// 自动播放相关
const isPlaying = ref(false)
let playbackTimer: ReturnType<typeof setTimeout> | null = null
const isPlayingAnimations = ref(false) // 是否正在播放动画
const pendingPause = ref(false) // 是否有待执行的暂停

// 综合加载状态管理
const isReplayDataLoaded = computed(() => {
  if (!isReplayMode.value) return true
  return !battleReportStore.loading.battleRecord && battleReportStore.currentBattleRecord !== null
})

// 检查petSprite是否准备完毕的Promise函数
const checkPetSpritesReady = async (): Promise<boolean> => {
  if (!isReplayMode.value) return true

  const leftPet = petSprites.value.left
  const rightPet = petSprites.value.right

  if (!leftPet || !rightPet) {
    return false
  }

  try {
    // 等待两个petSprite的ready promise完成
    const promises = []
    if (leftPet.ready) {
      promises.push(leftPet.ready)
    }
    if (rightPet.ready) {
      promises.push(rightPet.ready)
    }

    if (promises.length === 0) {
      return false
    }

    await Promise.all(promises)
    return true
  } catch (error) {
    console.error('Error waiting for pet sprites to be ready:', error)
    return false
  }
}

const isReplayFullyLoaded = ref(false)

// 检查回放是否完全加载完毕
const checkReplayLoadingStatus = async () => {
  if (!isReplayMode.value) {
    isReplayFullyLoaded.value = true
    return
  }

  try {
    // 等待数据加载完成
    if (!isReplayDataLoaded.value) {
      isReplayFullyLoaded.value = false
      return
    }

    // 等待petSprite准备完成
    const spritesReady = await checkPetSpritesReady()
    if (!spritesReady) {
      isReplayFullyLoaded.value = false
      return
    }

    // 等待store初始化完成
    if (store.replaySnapshots.length === 0) {
      isReplayFullyLoaded.value = false
      return
    }

    isReplayFullyLoaded.value = true
    console.debug('Replay fully loaded!')
  } catch (error) {
    console.error('Error checking replay loading statusb:', error)
    isReplayFullyLoaded.value = false
  }
}

const goBackFromReplay = () => {
  stopPlayback()
  store.exitReplayMode()

  // 根据当前路由判断返回到哪里
  if (props.localReportId) {
    // 本地战报回放，返回到本地战报管理页面
    router.push('/local-battle-reports')
  } else if (props.battleRecordId || route.params.id) {
    // 在线战报回放，返回到战报详情页面
    const battleId = props.battleRecordId || route.params.id
    router.push(`/battle-reports/${battleId}`)
  } else {
    // 其他情况，返回到战报列表
    router.push('/battle-reports')
  }
}

const nextTurn = () => {
  store.nextReplayTurn()
}

const previousTurn = () => {
  store.previousReplayTurn()
}

// 时间轴点击处理
const handleTimelineClick = (event: MouseEvent) => {
  if (isPlaying.value || !isReplayFullyLoaded.value) return

  const target = event.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const clickX = event.clientX - rect.left
  const width = rect.width

  // 计算点击位置对应的快照索引（从左到右，0到totalReplayTurns）
  // totalReplayTurns 实际上是 totalSnapshots，索引范围是 0 到 totalReplayTurns
  const percentage = Math.max(0, Math.min(1, clickX / width)) // 确保在0-1范围内
  const targetSnapshotIndex = Math.round(percentage * totalReplayTurns.value)
  const clampedIndex = Math.max(0, Math.min(totalReplayTurns.value, targetSnapshotIndex))

  console.debug(
    `Timeline click: percentage=${percentage.toFixed(3)}, targetIndex=${targetSnapshotIndex}, clampedIndex=${clampedIndex}, totalSnapshots=${totalReplayTurns.value}`,
  )
  store.setReplayTurn(clampedIndex)
}

// 播放控制
const togglePlayback = async () => {
  // 如果还未完全加载，不允许播放
  if (!isReplayFullyLoaded.value) {
    return
  }

  if (isPlaying.value) {
    // 如果正在播放动画，设置待暂停标志，否则立即暂停
    if (isPlayingAnimations.value) {
      pendingPause.value = true
    } else {
      stopPlayback()
    }
  } else {
    await startPlayback()
  }
}

const startPlayback = async () => {
  if (currentReplayTurn.value >= totalReplayTurns.value) {
    // 如果已经在最后一回合，从头开始
    store.setReplayTurn(0)
    // 等待一个tick确保状态更新完成
    await nextTick()
  }

  isPlaying.value = true
  scheduleNextTurn()
}

const stopPlayback = () => {
  isPlaying.value = false
  pendingPause.value = false // 清除待暂停标志
  if (playbackTimer) {
    clearTimeout(playbackTimer)
    playbackTimer = null
  }
}

const scheduleNextTurn = async () => {
  if (!isPlaying.value) return

  // 播放当前回合的动画（自动播放模式，不自动推进）
  await playCurrentTurnAnimations(false)

  // 检查是否在动画播放期间被停止
  if (!isPlaying.value) return

  playbackTimer = setTimeout(() => {
    if (currentReplayTurn.value < totalReplayTurns.value) {
      store.nextReplayTurn()

      // 检查是否有待暂停标志，如果有则在推进状态后暂停
      if (pendingPause.value) {
        stopPlayback() // 执行待暂停操作
        return
      }

      scheduleNextTurn() // 继续下一回合
    } else {
      // 播放完毕，停止播放
      stopPlayback()
    }
  }, 1000)
}

// 播放当前回合的动画（通过消息订阅系统）
const playCurrentTurnAnimations = async (autoAdvance = false) => {
  if (!isReplayMode.value || isPlayingAnimations.value) return

  isPlayingAnimations.value = true

  try {
    // 开始播放当前回合的动画
    await store.playReplayTurnAnimations(currentReplayTurn.value)

    // 只有在手动播放（非自动播放）时才自动推进到下一个快照
    if (autoAdvance && currentReplayTurn.value < totalReplayTurns.value) {
      store.nextReplayTurn()
    }
  } catch (error) {
    console.error('Error playing turn animations:', error)
  } finally {
    isPlayingAnimations.value = false
  }
}

async function animatePetTransition(
  petSprite: InstanceType<typeof PetSprite> | null,
  targetX: number,
  targetOpacity: number,
  duration: number,
  ease: string,
  onCompleteCallback?: () => void,
) {
  if (petSprite && petSprite.$el && (targetOpacity === 0 ? petSprite.$el.offsetParent !== null : true)) {
    return gsap.to(petSprite.$el, {
      x: targetX,
      opacity: targetOpacity,
      duration,
      ease,
      onComplete: onCompleteCallback,
    })
  }
  return Promise.resolve()
}

async function switchPetAnimate(toPetId: petId, side: 'left' | 'right', petSwitchMessage: PetSwitchMessage) {
  const oldPetSprite = petSprites.value[side]
  const battleViewWidth = 1600 // 固定的战斗视图宽度
  const isLeft = side === 'left'
  const offScreenX = isLeft ? -battleViewWidth / 2 - 100 : battleViewWidth / 2 + 100
  const animationDuration = 1

  // 开始动画追踪（仅在非回放模式下）
  let animationId: string | null = null
  if (!props.replayMode && store.battleInterface) {
    try {
      const ownerId = currentPlayer.value?.id
      if (!ownerId) {
        console.warn('No current player ID available for animation tracking')
        return
      }
      animationId = await store.battleInterface.startAnimation(toPetId, animationDuration * 1000 * 2, ownerId) // 切换动画预期时长
    } catch (error) {
      console.warn('Failed to start switch animation tracking:', error)
    }
  }

  await animatePetTransition(oldPetSprite, offScreenX, 0, animationDuration, 'power2.in')

  // 统一使用 applyStateDelta，回放模式下跳过重复检查
  await store.applyStateDelta(petSwitchMessage)
  await nextTick()

  const newPetSprite = petSprites.value[side]
  if (!newPetSprite || !newPetSprite.$el) {
    console.warn(`New PetSprite on side ${side} not found after state update for pet ${toPetId}`)
    return
  }

  const newPetReadyPromise = newPetSprite.ready
  if (newPetReadyPromise) {
    await newPetReadyPromise
  }

  gsap.set(newPetSprite.$el, { x: offScreenX, opacity: 0 })
  const newPetInfo = store.getPetById(toPetId)
  const newPetSpeciesNum = gameDataStore.getSpecies(newPetInfo?.speciesID ?? '')?.num ?? 0
  if (newPetSpeciesNum !== 0) {
    playPetSound(newPetSpeciesNum)
  }
  await animatePetTransition(newPetSprite, 0, 1, animationDuration, 'power2.out')

  // 结束动画追踪（仅在非回放模式下）
  if (!props.replayMode && store.battleInterface && animationId) {
    try {
      await store.battleInterface.endAnimation(animationId)
    } catch (error) {
      console.warn('Failed to end switch animation tracking:', error)
    }
  }
}

const petSprites = computed(() => {
  return {
    left: leftPetRef.value!,
    right: rightPetRef.value!,
  }
})

async function useSkillAnimate(messages: BattleMessage[]): Promise<void> {
  const useSkill = messages.filter(m => m.type === BattleMessageType.SkillUse)[0]
  if (!useSkill) return

  // 统一使用 applyStateDelta，回放模式下跳过重复检查
  await store.applyStateDelta(useSkill)

  const baseSkillId = useSkill.data.baseSkill
  const baseSkillData = gameDataStore.getSkill(baseSkillId)
  // 优先从 gameDataStore 获取技能类别，回退到 store.skillMap
  const category = baseSkillData?.category || store.skillMap.get(useSkill.data.skill)?.category || Category.Physical
  const side = getTargetSide(useSkill.data.user)
  let source = petSprites.value[side]

  if (!source) {
    throw new Error('找不到精灵组件')
  }

  // 根据技能类别设置预期动画时长：climax技能20秒，其他技能5秒
  const expectedDuration = category === Category.Climax ? 20000 : 5000

  // 开始动画追踪（仅在非回放模式下）
  let animationId: string | null = null
  if (!props.replayMode && store.battleInterface) {
    try {
      const ownerId = currentPlayer.value?.id
      if (!ownerId) {
        console.warn('No current player ID available for animation tracking')
        return
      }
      animationId = await store.battleInterface.startAnimation(baseSkillId, expectedDuration, ownerId)
    } catch (error) {
      console.warn('Failed to start animation tracking:', error)
    }
  }

  // 等待PetSprite完全初始化 - 使用nextTick确保获取到最新的组件实例
  let availableState = unref(source.availableState)

  if (!availableState || availableState.length === 0) {
    let retryCount = 0
    const maxRetries = 20

    while ((!availableState || availableState.length === 0) && retryCount < maxRetries) {
      await nextTick()
      source = petSprites.value[side]

      if (!source) {
        retryCount++
        continue
      }

      // 等待ready Promise，确保组件完全初始化
      if (source.ready) {
        try {
          await source.ready
        } catch (error) {
          console.warn('Error waiting for ready promise:', error)
        }
      }

      // 重新获取最新实例和availableState
      source = petSprites.value[side]
      if (source) {
        availableState = unref(source.availableState)
      }

      retryCount++
    }

    if (!availableState || availableState.length === 0) {
      console.error('PetSprite availableState still not ready after waiting, skipping animation')
      return
    }
  }

  // 最后一次确保我们使用的是最新的source和availableState
  source = petSprites.value[side]
  if (!source) {
    throw new Error('找不到精灵组件')
  }
  availableState = unref(source.availableState)

  const stateMap = new Map<Category, ActionState>([
    [Category.Physical, ActionState.ATK_PHY],
    [Category.Special, ActionState.ATK_SPE],
    [Category.Status, ActionState.ATK_BUF],
    [
      Category.Climax,
      availableState.includes(ActionState.INTERCOURSE) && baseSkillData?.tags?.includes('combination')
        ? ActionState.INTERCOURSE
        : availableState.includes(ActionState.ATK_POW)
          ? ActionState.ATK_POW
          : ActionState.ATK_PHY,
    ],
  ])
  const state = stateMap.get(category) || ActionState.ATK_PHY

  if (!availableState.includes(state)) {
    throw new Error(`无效的动画状态: ${state}`)
  }

  showUseSkillMessage(side, baseSkillId)
  source.$el.style.zIndex = Z_INDEX.DYNAMIC_ANIMATION.toString()
  source.setState(state)
  if (category === 'Climax') playSkillSound(baseSkillId)

  const hitPromise = new Promise<void>(resolve => {
    const handler = (hitSide: 'left' | 'right') => {
      if (hitSide === side) {
        emitter.off('attack-hit', handler)
        resolve()
      }
    }
    setTimeout(async () => {
      if ((await source.getState()) !== ActionState.IDLE) return
      resolve()
    }, expectedDuration)
    emitter.on('attack-hit', handler)
  })

  const animateCompletePromise = new Promise<void>(resolve => {
    const handler = (completeSide: 'left' | 'right') => {
      if (completeSide === side) {
        emitter.off('animation-complete', handler)
        resolve()
      }
    }
    setTimeout(async () => {
      if ((await source.getState()) !== ActionState.IDLE) return
      resolve()
    }, expectedDuration)
    emitter.on('animation-complete', handler)
  })

  await hitPromise
  if (category !== 'Climax' && !messages.some(msg => msg.type === BattleMessageType.SkillMiss))
    playSkillSound(baseSkillId)

  for (const msg of messages) {
    await store.applyStateDelta(msg)
    const combatEventTypes: BattleMessageType[] = [
      BattleMessageType.SkillMiss,
      BattleMessageType.Damage,
      BattleMessageType.DamageFail,
      BattleMessageType.Heal,
    ]
    if (combatEventTypes.includes(msg.type as BattleMessageType)) {
      handleCombatEventMessage(msg as CombatEventMessageWithTarget, true)
    }
  }

  await animateCompletePromise
  source.$el.style.zIndex = ''

  // 结束动画追踪（仅在非回放模式下）
  if (!props.replayMode && store.battleInterface && animationId) {
    try {
      await store.battleInterface.endAnimation(animationId)
    } catch (error) {
      console.warn('Failed to end animation tracking:', error)
    }
  }
}

function handleCombatEventMessage(message: CombatEventMessageWithTarget, isFromSkillSequenceContext: boolean) {
  const targetPetId = message.data.target
  const targetSide = getTargetSide(targetPetId)
  const targetPetSprite = petSprites.value[targetSide]

  if (!targetPetSprite) {
    console.warn(`Target pet sprite not found for side: ${targetSide}`, message)
    return
  }

  switch (message.type) {
    case BattleMessageType.SkillMiss:
      targetPetSprite.setState(ActionState.MISS)
      showMissMessage(targetSide)
      break
    case BattleMessageType.Damage: {
      const damageData = message.data
      if (damageData.damage === 0) {
        targetPetSprite.setState(ActionState.MISS)
        showAbsorbMessage(targetSide)
      } else {
        const targetPetInfo = store.getPetById(damageData.target)
        if (!targetPetInfo) {
          console.warn(`Target pet info not found for ID: ${damageData.target}`, message)
          // 即使找不到宠物信息，也要显示伤害动画
          targetPetSprite.setState(damageData.isCrit ? ActionState.UNDER_ULTRA : ActionState.UNDER_ATK)
          showDamageMessage(
            targetSide,
            damageData.damage,
            damageData.effectiveness > 1 ? 'up' : damageData.effectiveness < 1 ? 'down' : 'normal',
            damageData.isCrit,
          )
          break
        }
        const { currentHp, maxHp } = targetPetInfo
        const { availableState } = targetPetSprite
        const isDead = currentHp <= 0
        const isCriticalHealth = currentHp < maxHp * 0.25
        const shouldSetPetAnimationState =
          !isFromSkillSequenceContext || (isFromSkillSequenceContext && damageData.damageType !== 'Effect')

        if (shouldSetPetAnimationState) {
          if (isDead && availableState.includes(ActionState.DEAD)) {
            targetPetSprite.setState(ActionState.DEAD)
          } else if (isCriticalHealth && availableState.includes(ActionState.ABOUT_TO_DIE)) {
            targetPetSprite.setState(ActionState.ABOUT_TO_DIE)
          } else {
            targetPetSprite.setState(damageData.isCrit ? ActionState.UNDER_ULTRA : ActionState.UNDER_ATK)
          }
        }
        showDamageMessage(
          targetSide,
          damageData.damage,
          damageData.effectiveness > 1 ? 'up' : damageData.effectiveness < 1 ? 'down' : 'normal',
          damageData.isCrit,
        )
      }
      break
    }
    case BattleMessageType.DamageFail:
      targetPetSprite.setState(ActionState.MISS)
      showAbsorbMessage(targetSide)
      break
    case BattleMessageType.Heal:
      showHealMessage(targetSide, message.data.amount)
      break
    default:
      console.warn(
        'Unhandled message type in handleCombatEventMessage (should not happen with CombatEventMessageWithTarget):',
        message,
      )
  }
}

const handleAttackHit = (side: 'left' | 'right') => {
  emitter.emit('attack-hit', side)
}

const handleAnimationComplete = (side: 'left' | 'right') => {
  emitter.emit('animation-complete', side)
}

onUnmounted(() => {
  emitter.all.clear()
})

const getTargetSide = (targetPetId: string): 'left' | 'right' => {
  const isCurrentPlayerPet = currentPlayer.value?.team?.some(p => p.id === targetPetId)
  return isCurrentPlayerPet ? 'left' : 'right'
}

let messageSubscription: { unsubscribe: () => void } | null = null
const animationQueue = store.animateQueue
const animating = ref(false)

const animatesubscribe = animationQueue
  .pipe(
    concatMap(task =>
      from(task()).pipe(
        tap(() => {
          animating.value = true
        }),
        finalize(() => {
          animating.value = false
        }),
        catchError(err => {
          console.error('动画执行失败:', err)
          return of(null)
        }),
      ),
    ),
  )
  .subscribe()

const preloadPetSprites = () => {
  const spriteNums = allTeamMemberSpritesNum.value
  if (!spriteNums || !Array.isArray(spriteNums)) {
    console.debug('Skipping sprite preload: sprite numbers not available yet')
    return
  }
  spriteNums.forEach(num => {
    if (num && num > 0) {
      const img = new Image()
      img.src = `https://seer2-pet-resource.yuuinih.com/public/fight/${num}.swf`
    }
  })
}

async function animatePetEntry(
  petSprite: InstanceType<typeof PetSprite> | null,
  initialX: number,
  targetX: number,
  duration: number,
  onCompleteCallback?: () => void,
) {
  if (petSprite && petSprite.$el) {
    gsap.set(petSprite.$el, { x: initialX, opacity: 0 })
    return animatePetTransition(petSprite, targetX, 1, duration, 'power2.out', onCompleteCallback)
  }
  return Promise.resolve()
}

async function initialPetEntryAnimation() {
  const leftPet = petSprites.value.left
  const rightPet = petSprites.value.right
  const battleViewWidth = 1600 // 固定的战斗视图宽度
  const animationDuration = 1
  const animations = []

  if (leftPet && leftPet.$el) {
    if (leftPetSpeciesNum.value !== 0) {
      playPetSound(leftPetSpeciesNum.value)
    }

    // Check if PRESENT state is available, use setState animation instead of translation
    if (leftPet.availableState.includes(ActionState.PRESENT)) {
      animations.push(leftPet.setState(ActionState.PRESENT))
    } else {
      animations.push(animatePetEntry(leftPet, -battleViewWidth / 2 - 100, 0, animationDuration))
    }
  }
  if (rightPet && rightPet.$el) {
    if (rightPetSpeciesNum.value !== 0) {
      playPetSound(rightPetSpeciesNum.value)
    }

    // Check if PRESENT state is available, use setState animation instead of translation
    if (rightPet.availableState.includes(ActionState.PRESENT)) {
      animations.push(rightPet.setState(ActionState.PRESENT))
    } else {
      animations.push(animatePetEntry(rightPet, battleViewWidth / 2 + 100, 0, animationDuration))
    }
  }
  await Promise.all(animations)
}

// 初始化自适应缩放
const initAdaptiveScaling = () => {
  if (!battleContainerRef.value) return

  // 设置ResizeObserver监听父容器大小变化
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        // 更新battleViewStore中的容器尺寸
        battleViewStore.setContainerSize(width, height)
      }
    })

    // 开始观察父容器
    resizeObserver.observe(battleContainerRef.value)

    // 启用自适应缩放模式
    battleViewStore.setAdaptiveScaling(true)

    // 初始设置容器尺寸
    const rect = battleContainerRef.value.getBoundingClientRect()
    battleViewStore.setContainerSize(rect.width, rect.height)
  }
}

// 清理自适应缩放
const cleanupAdaptiveScaling = () => {
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  // 禁用自适应缩放模式
  battleViewStore.setAdaptiveScaling(false)
}

onMounted(async () => {
  // 初始化自适应缩放
  await nextTick() // 确保DOM已渲染
  initAdaptiveScaling()

  // 添加全屏状态监听器
  document.addEventListener('fullscreenchange', handleFullscreenChange)
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.addEventListener('msfullscreenchange', handleFullscreenChange)

  // 检查是否是回放模式
  if (props.replayMode) {
    let battleRecord = null

    if (props.localReportId) {
      // 本地战报回放模式
      const localReport = battleReportStore.loadLocalBattleReport(props.localReportId)
      if (localReport) {
        battleRecord = localReport.battleRecord
      }
    } else {
      // 在线战报回放模式
      const battleId = props.battleRecordId || (route.params.id as string)
      if (battleId) {
        await battleReportStore.fetchBattleRecord(battleId)
        battleRecord = battleReportStore.currentBattleRecord
      }
    }

    if (battleRecord) {
      store.initReplayMode(
        battleRecord.battle_messages,
        battleRecord.final_state as any,
        battleRecord.player_a_id, // 默认从玩家A视角观看
      )
    }

    // 回放模式也需要消息订阅来处理动画
    await setupMessageSubscription()

    // 等待一小段时间确保订阅完全设置好
    await new Promise(resolve => setTimeout(resolve, 100))

    // 在battleState初始化完成后再预加载精灵
    preloadPetSprites()

    // 检查加载状态
    await checkReplayLoadingStatus()

    // 在回放模式下，不自动播放第0回合动画，保持初始状态
    // 用户可以手动点击播放按钮来开始回放
    return
  }

  // 正常战斗模式
  preloadPetSprites()
  await setupMessageSubscription()
})

// 设置消息订阅
const setupMessageSubscription = async () => {
  messageSubscription = store._messageSubject
    .pipe(
      concatMap(msg => {
        if (msg.type === BattleMessageType.SkillUse) {
          return store._messageSubject.pipe(
            startWith(msg),
            takeUntil(
              store._messageSubject.pipe(
                filter(
                  (endMsg): endMsg is SkillUseEndMessage =>
                    endMsg.type === BattleMessageType.SkillUseEnd && endMsg.data.user === msg.data.user,
                ),
                take(1),
              ),
            ),
            toArray(),
            mergeMap(messages => {
              const task = async () => {
                // 检查是否已经处理过这个技能序列
                if (store.lastProcessedSequenceId >= (msg.sequenceId ?? -1)) return
                await useSkillAnimate(messages)
                // 更新 store 的 lastProcessedSequenceId
                const lastMessage = messages[messages.length - 1]
                if (lastMessage.sequenceId !== undefined) {
                  store.lastProcessedSequenceId = Math.max(store.lastProcessedSequenceId, lastMessage.sequenceId)
                }
              }
              return of(task)
            }),
          )
        }
        const task = async () => {
          // 检查是否已经处理过这个消息（包括回放模式）
          if (store.lastProcessedSequenceId >= (msg.sequenceId ?? -1)) {
            return
          }

          if (msg.type === BattleMessageType.PetSwitch) {
            // 对于 PetSwitch，状态更新由 switchPetAnimate 内部精确控制时机
            await switchPetAnimate(msg.data.toPet, getTargetSide(msg.data.toPet), msg as PetSwitchMessage)
          } else {
            const combatEventTypes: BattleMessageType[] = [
              BattleMessageType.SkillMiss,
              BattleMessageType.Damage,
              BattleMessageType.DamageFail,
              BattleMessageType.Heal,
            ]

            // 回放模式和正常模式使用相同的消息处理逻辑

            // 对于其他所有消息，先应用状态变更
            await store.applyStateDelta(msg)

            // 等待一个 tick 确保状态更新完成
            await nextTick()

            if (combatEventTypes.includes(msg.type as BattleMessageType)) {
              handleCombatEventMessage(msg as CombatEventMessageWithTarget, false)
            } else {
              // 处理其他非战斗事件相关的消息 (PetSwitch 已在上面单独处理)
              switch (msg.type) {
                case BattleMessageType.TurnAction:
                  if (!props.replayMode) panelState.value = PanelState.SKILLS
                  break
                case BattleMessageType.ForcedSwitch:
                  // 确保 msg.data 和 msg.data.player 存在
                  if (
                    msg.data &&
                    'player' in msg.data &&
                    Array.isArray(msg.data.player) &&
                    !msg.data.player.some(p => p === currentPlayer.value?.id)
                  )
                    break
                  if (!props.replayMode) panelState.value = PanelState.PETS
                  break
                case BattleMessageType.FaintSwitch:
                  // 确保 msg.data 和 msg.data.player 存在
                  if (msg.data && 'player' in msg.data && !(msg.data.player === currentPlayer.value?.id)) break
                  if (!props.replayMode) panelState.value = PanelState.PETS
                  break
                // PetSwitch 类型的消息已在外部 if 条件中处理
                default:
                  // 其他消息类型，如果它们不直接触发战斗动画或UI，则仅应用状态（已在上方完成）
                  break
              }
            }
          }
        }
        return of(task)
      }),
    )
    .subscribe(task => animationQueue.next(task))

  const leftReadyPromise = leftPetRef.value?.ready
  const rightReadyPromise = rightPetRef.value?.ready
  const promisesToWaitFor: Promise<void>[] = []
  if (leftReadyPromise) {
    promisesToWaitFor.push(leftReadyPromise.catch(() => {}))
  }
  if (rightReadyPromise) {
    promisesToWaitFor.push(rightReadyPromise.catch(() => {}))
  }
  if (promisesToWaitFor.length > 0) {
    await Promise.all(promisesToWaitFor)
  }

  await store.ready()
  await initialPetEntryAnimation()
}

onUnmounted(() => {
  // 清理播放定时器
  stopPlayback()

  // 清理订阅和动画
  messageSubscription?.unsubscribe()
  animatesubscribe.unsubscribe()
  cleanupBattleAnimations()
  emitter.all.clear()

  // 清理自适应缩放
  cleanupAdaptiveScaling()

  // 清理全屏事件监听器
  document.removeEventListener('fullscreenchange', handleFullscreenChange)
  document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
  document.removeEventListener('msfullscreenchange', handleFullscreenChange)

  // 清理战斗和回放状态
  store.resetBattle()
})

// 监听加载状态变化
watch(
  [() => battleReportStore.loading.battleRecord, () => store.replaySnapshots.length],
  async () => {
    if (isReplayMode.value) {
      await checkReplayLoadingStatus()
    }
  },
  { immediate: true },
)

// 监听petSprite的变化
watch(
  () => [petSprites.value.left, petSprites.value.right],
  async () => {
    if (isReplayMode.value) {
      // 延迟一点时间等待petSprite完全初始化
      await new Promise(resolve => setTimeout(resolve, 200))
      await checkReplayLoadingStatus()
    }
  },
  { deep: true },
)

watch(
  () => store.isBattleEnd,
  async (newVal, oldVal) => {
    if (newVal && !oldVal) {
      const victor = store.victor
      const leftPet = petSprites.value.left
      const rightPet = petSprites.value.right
      const isVictor = store.victor === store.playerId

      if (victor === null) {
        if (leftPet && leftPet.availableState.includes(ActionState.DEAD)) leftPet.setState(ActionState.DEAD)
        if (rightPet && rightPet.availableState.includes(ActionState.DEAD)) rightPet.setState(ActionState.DEAD)
      } else if (isVictor) {
        if (leftPet && leftPet.availableState.includes(ActionState.WIN)) leftPet.setState(ActionState.WIN)
        if (rightPet && rightPet.availableState.includes(ActionState.DEAD)) rightPet.setState(ActionState.DEAD)
      } else {
        if (leftPet && leftPet.availableState.includes(ActionState.DEAD)) leftPet.setState(ActionState.DEAD)
        if (rightPet && rightPet.availableState.includes(ActionState.WIN)) rightPet.setState(ActionState.WIN)
      }

      showKoBanner.value = true
      playVictorySound()
      await nextTick()

      if (koBannerRef.value) {
        const tl = gsap.timeline({
          onComplete: () => {
            showKoBanner.value = false
            // 回放模式下不显示战斗结束UI
            if (!isReplayMode.value) {
              setTimeout(() => {
                showBattleEndUI.value = true
              }, 500)
            }
          },
        })
        gsap.set(koBannerRef.value, { opacity: 0, scale: 0.8, xPercent: -50, yPercent: -50 })
        tl.to(koBannerRef.value, {
          opacity: 1,
          scale: 1,
          xPercent: -50,
          yPercent: -50,
          duration: 0.3,
          ease: 'power2.out',
        })
          .to(koBannerRef.value, { duration: 1.5 })
          .to(koBannerRef.value, {
            opacity: 0,
            scale: 0.8,
            xPercent: -50,
            yPercent: -50,
            duration: 0.3,
            ease: 'power2.in',
          })
      } else {
        // 回放模式下不显示战斗结束UI
        if (!isReplayMode.value) {
          setTimeout(() => {
            showBattleEndUI.value = true
          }, 2000)
        }
      }
    }
  },
)
</script>

<template>
  <div class="h-full w-full relative overflow-hidden">
    <div
      ref="battleContainerRef"
      class="h-full w-full bg-[#1a1a2e] overflow-visible relative flex justify-center items-center"
      :style="{
        '--battle-view-scale': battleViewScale,
      }"
    >
      <!-- 自定义确认对话框（覆盖整个战斗容器） -->
      <Transition name="fade">
        <div
          v-if="showCustomConfirm"
          class="absolute inset-0 bg-black/80 flex items-center justify-center"
          :class="Z_INDEX_CLASS.CUSTOM_CONFIRM_DIALOG"
        >
          <div
            class="bg-gradient-to-br from-[#2a2a4a] to-[#1a1a2e] p-8 rounded-2xl shadow-[0_0_30px_rgba(255,165,0,0.4)] text-center max-w-md mx-4"
          >
            <!-- 警告图标 -->
            <div class="mb-6">
              <el-icon class="text-orange-400 text-6xl" :size="64">
                <Warning />
              </el-icon>
            </div>

            <!-- 对话框标题 -->
            <h2 class="text-3xl mb-4 text-white [text-shadow:_0_0_20px_#fff] font-bold">
              {{ customConfirmTitle }}
            </h2>

            <!-- 对话框内容 -->
            <p class="text-gray-300 text-lg leading-relaxed mb-8">
              {{ customConfirmMessage }}
            </p>

            <!-- 对话框按钮 -->
            <div class="flex gap-4 justify-center">
              <button
                @click="handleCustomConfirm(false)"
                class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
              >
                {{ i18next.t('cancel', { ns: 'battle', defaultValue: '取消' }) }}
              </button>
              <button
                @click="handleCustomConfirm(true)"
                class="px-6 py-3 bg-orange-600 hover:bg-orange-500 rounded-lg text-white font-bold transition-colors shadow-[0_0_15px_rgba(255,165,0,0.3)]"
              >
                {{ i18next.t('surrender-confirm-button', { ns: 'battle', defaultValue: '投降' }) }}
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 移动端横屏提示 -->
      <div
        v-if="showOrientationHint"
        class="absolute inset-0 bg-black/60 flex items-center justify-center"
        :class="Z_INDEX_CLASS.MOBILE_ORIENTATION_HINT"
      >
        <div class="bg-white/90 backdrop-blur-sm rounded-lg p-6 mx-4 text-center max-w-sm">
          <div class="text-2xl mb-4">📱 ➡️ 📱</div>
          <h3 class="text-lg font-bold text-gray-800 mb-2">建议横屏游戏</h3>
          <p class="text-gray-600 text-sm mb-4">为了获得最佳游戏体验，建议将设备旋转至横屏模式</p>
          <p class="text-gray-500 text-xs">或点击右上角的全屏按钮进入全屏模式</p>
        </div>
      </div>

      <!-- 移动端全屏按钮 -->
      <button
        v-if="isMobile && !isReplayMode"
        @click="toggleFullscreen"
        class="absolute top-4 right-4 w-12 h-12 bg-black/50 hover:bg-black/70 backdrop-blur-sm rounded-full flex items-center justify-center text-white transition-all duration-200 active:scale-95"
        :class="Z_INDEX_CLASS.MOBILE_FULLSCREEN_BUTTON"
        :title="isFullscreen ? '退出全屏' : '进入全屏'"
      >
        <el-icon :size="20">
          <FullScreen v-if="!isFullscreen" />
          <Aim v-else />
        </el-icon>
      </button>

      <div
        ref="battleViewRef"
        class="w-[1600px] h-[900px] min-w-[1600px] min-h-[900px] flex-shrink-0 relative flex justify-center items-center object-contain bg-gray-900 transition-transform duration-300 ease-out"
        :style="{
          transform: `scale(${battleViewScale})`,
          transformOrigin: 'center center',
        }"
      >
        <img
          v-show="showKoBanner"
          ref="koBannerRef"
          src="/ko.png"
          alt="KO Banner"
          class="absolute left-1/2 top-1/2 max-w-[80%] max-h-[80%] object-contain"
          :class="Z_INDEX_CLASS.KO_BANNER"
        />
        <div
          class="relative h-full w-full flex flex-col bg-center bg-no-repeat overflow-visible"
          :class="[
            background ? `bg-cover` : 'bg-gray-900',
            'overflow-hidden',
            'transition-all duration-300 ease-in-out',
          ]"
          :style="{
            backgroundImage: background ? `url(${background})` : 'none',
            backgroundSize: background ? 'auto 100%' : 'auto',
          }"
        >
          <div class="flex justify-between p-5">
            <BattleStatus v-if="currentPlayer" ref="leftStatusRef" class="w-1/3" :player="currentPlayer" side="left" />

            <BattleStatus
              v-if="opponentPlayer"
              ref="rightStatusRef"
              class="w-1/3"
              :player="opponentPlayer"
              side="right"
            />
          </div>

          <!-- 回合数和公共印记区域 -->
          <div class="flex flex-col items-center py-2 min-h-[80px]">
            <!-- 回合数和计时器显示 -->
            <div class="grid grid-cols-3 items-center mb-2 min-h-[24px]">
              <!-- 回合时间 - 左侧 -->
              <div class="flex justify-start">
                <SimpleBattleTimer v-if="!isReplayMode" type="turn" :player-id="currentPlayer?.id" />
              </div>

              <!-- 回合数居中显示 - 始终在中间 -->
              <div class="flex justify-center">
                <div class="text-white text-xl font-bold">
                  {{
                    i18next.t('turn', {
                      ns: 'battle',
                    })
                  }}
                  {{ currentTurn || 1 }}
                </div>
              </div>

              <!-- 总时间 - 右侧 -->
              <div class="flex justify-end">
                <SimpleBattleTimer v-if="!isReplayMode" type="total" :player-id="currentPlayer?.id" />
              </div>
            </div>

            <!-- 公共印记（天气）显示 -->
            <div v-if="globalMarks.length > 0" class="flex flex-wrap justify-center gap-2 max-w-md">
              <Mark v-for="mark in globalMarks" :key="mark.id" :mark="mark" />
            </div>
          </div>

          <!-- 精灵容器 - 基于整个对战画面进行绝对定位 -->
          <div class="flex-grow relative">
            <!-- 左侧精灵侧栏 - 绝对定位 -->
            <div
              class="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5"
              :class="Z_INDEX_CLASS.PET_BUTTON_CONTAINER"
            >
              <PetButton
                v-for="pet in leftPlayerPets"
                :key="pet.id"
                :pet="pet"
                :disabled="!isPetSwitchable(pet.id) || isPending"
                :is-active="pet.id === currentPlayer?.activePet"
                position="left"
                @click="handlePetSelect"
              />
            </div>

            <!-- 右侧精灵侧栏 - 绝对定位 -->
            <div
              class="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5"
              :class="Z_INDEX_CLASS.PET_BUTTON_CONTAINER"
            >
              <PetButton
                v-for="pet in rightPlayerPets"
                :key="pet.id"
                :pet="pet"
                :disabled="true"
                :is-active="pet.id === opponentPlayer?.activePet"
                position="right"
              />
            </div>

            <!-- 左侧精灵 - 绝对定位在画面左侧 -->
            <PetSprite
              v-if="leftPetSpeciesNum !== 0"
              ref="leftPetRef"
              :num="leftPetSpeciesNum"
              class="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none"
              :class="Z_INDEX_CLASS.PET_SPRITE"
              @hit="handleAttackHit('left')"
              @animate-complete="handleAnimationComplete('left')"
            />
            <!-- 右侧精灵 - 绝对定位在画面右侧 -->
            <PetSprite
              v-if="rightPetSpeciesNum !== 0"
              ref="rightPetRef"
              :num="rightPetSpeciesNum"
              :reverse="true"
              class="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none"
              :class="Z_INDEX_CLASS.PET_SPRITE"
              @hit="handleAttackHit('right')"
              @animate-complete="handleAnimationComplete('right')"
            />
          </div>

          <!-- 回放模式控制界面 -->
          <div v-if="isReplayMode" class="flex flex-none bg-black/80 h-1/5">
            <div v-if="battleViewStore.showLogPanel" class="w-1/5 h-full p-2">
              <BattleLogPanel />
            </div>

            <div class="flex-1 h-full flex flex-col justify-center p-4">
              <!-- 回放控制按钮 -->
              <div class="flex items-center justify-center space-x-4 mb-4">
                <button
                  @click="goBackFromReplay"
                  class="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-white font-bold"
                >
                  {{ props.localReportId ? '返回本地战报' : '返回详情' }}
                </button>

                <!-- 播放控制 -->
                <button
                  @click="previousTurn"
                  :disabled="currentReplayTurn <= 0 || isPlaying || !isReplayFullyLoaded"
                  class="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-bold flex items-center justify-center"
                >
                  <el-icon><DArrowLeft /></el-icon>
                </button>

                <button
                  @click="togglePlayback"
                  :disabled="!isReplayFullyLoaded"
                  class="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-bold flex items-center space-x-2"
                >
                  <el-icon>
                    <VideoPause v-if="isPlaying" />
                    <VideoPlay v-else />
                  </el-icon>
                  <span>
                    {{
                      !isReplayFullyLoaded ? '加载中...' : isPlaying ? (pendingPause ? '暂停中...' : '暂停') : '播放'
                    }}
                  </span>
                </button>

                <button
                  @click="() => playCurrentTurnAnimations(true)"
                  :disabled="isPlaying || isPlayingAnimations || !isReplayFullyLoaded"
                  class="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-bold flex items-center justify-center"
                  title="播放当前回合动画并推进到下一个快照"
                >
                  <el-icon><Film /></el-icon>
                </button>

                <button
                  @click="nextTurn"
                  :disabled="currentReplayTurn >= totalReplayTurns || isPlaying || !isReplayFullyLoaded"
                  class="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg text-white font-bold flex items-center justify-center"
                >
                  <el-icon><DArrowRight /></el-icon>
                </button>

                <span class="text-white font-bold">
                  回合 {{ currentReplayTurnNumber }} / {{ totalReplayTurnNumber }}
                </span>
              </div>

              <!-- 回合进度条 -->
              <div class="flex items-center space-x-4">
                <span class="text-white text-sm">进度:</span>
                <!-- 时间轴样式进度条 -->
                <div class="flex-1 relative">
                  <div class="timeline-container">
                    <!-- 时间轴背景轨道 -->
                    <div class="timeline-track">
                      <!-- 已完成部分 -->
                      <div
                        class="timeline-fill"
                        :style="{
                          width: `${totalReplayTurns > 0 ? (currentReplayTurn / totalReplayTurns) * 100 : 0}%`,
                        }"
                      ></div>
                      <!-- 刻度点 -->
                      <div
                        v-for="i in Math.min(totalReplayTurns + 1, 11)"
                        :key="i"
                        class="timeline-tick"
                        :class="{ active: i - 1 <= currentReplayTurn }"
                        :style="{ left: `${totalReplayTurns > 0 ? ((i - 1) / totalReplayTurns) * 100 : 0}%` }"
                      ></div>
                    </div>
                    <!-- 可点击区域 -->
                    <div
                      class="timeline-clickable"
                      :class="[
                        Z_INDEX_CLASS.TIMELINE_CLICKABLE,
                        { 'pointer-events-none': isPlaying || !isReplayFullyLoaded },
                      ]"
                      @click="handleTimelineClick"
                    ></div>
                  </div>
                </div>
                <span class="text-white text-sm font-mono"
                  >{{ currentReplayTurnNumber }} / {{ totalReplayTurnNumber }}</span
                >
              </div>
            </div>
          </div>

          <!-- 控制面板（移动端和桌面端完全一样） -->
          <div v-if="!isReplayMode" class="flex h-1/5 flex-none overflow-visible">
            <div v-if="battleViewStore.showLogPanel" class="w-1/5 h-full p-2 max-h-full overflow-hidden">
              <BattleLogPanel />
            </div>

            <div
              class="h-full max-h-full overflow-visible"
              :class="battleViewStore.showLogPanel ? 'flex-1' : 'flex-[4]'"
            >
              <div
                class="h-full max-h-full grid grid-cols-5 gap-4 p-2 overflow-visible"
                v-show="panelState === PanelState.SKILLS"
              >
                <template
                  v-for="(skill, index) in availableSkills.filter(s => s.category !== Category.Climax)"
                  :key="'normal-' + skill.id"
                >
                  <SkillButton
                    :skill="skill"
                    @click="handleSkillClick(skill.id)"
                    :disabled="!isSkillAvailable(skill.id) || isPending"
                    :style="{ 'grid-column-start': index + 1 }"
                  />
                </template>
                <template
                  v-for="(skill, index) in availableSkills.filter(s => s.category === Category.Climax)"
                  :key="'climax-' + skill.id"
                >
                  <SkillButton
                    :skill="skill"
                    @click="handleSkillClick(skill.id)"
                    :disabled="!isSkillAvailable(skill.id) || isPending"
                    :style="{ 'grid-column-start': 5 - index }"
                    class="justify-self-end"
                  />
                </template>
              </div>

              <div
                class="grid grid-cols-6 gap-2 h-full max-h-full overflow-visible"
                v-show="panelState === PanelState.PETS"
              >
                <PetButton
                  v-for="pet in currentPlayer?.team || []"
                  :key="pet.id"
                  :pet="pet"
                  :disabled="!isPetSwitchable(pet.id) || isPending"
                  @click="handlePetSelect"
                  position="bottom"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2 p-2 w-1/5 flex-none h-full">
              <!-- 日志切换按钮 -->
              <button
                class="group relative h-10 p-2 cursor-pointer overflow-visible flex-none"
                @click="battleViewStore.toggleLogPanel()"
              >
                <div
                  class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border border-gray-400/50 group-hover:shadow-[0_0_8px_2px_rgba(156,163,175,0.6)]"
                  :class="
                    battleViewStore.showLogPanel
                      ? 'border-green-400/50 group-hover:shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]'
                      : 'border-gray-400/50'
                  "
                >
                  <div class="bg-gray-900 w-full h-2"></div>
                  <div class="absolute bottom-1 right-1">
                    <div class="flex">
                      <div
                        class="w-2 h-0.5 mt-1"
                        :class="battleViewStore.showLogPanel ? 'bg-green-400' : 'bg-gray-400'"
                      ></div>
                      <div
                        class="w-0.5 h-2"
                        :class="battleViewStore.showLogPanel ? 'bg-green-400' : 'bg-gray-400'"
                      ></div>
                    </div>
                  </div>
                </div>
                <div class="relative flex items-center justify-center h-full pointer-events-none">
                  <div
                    class="text-xs font-bold [text-shadow:_1px_1px_0_black]"
                    :class="battleViewStore.showLogPanel ? 'text-green-400' : 'text-gray-400'"
                  >
                    {{ battleViewStore.showLogPanel ? '隐藏日志' : '显示日志' }}
                  </div>
                </div>
              </button>

              <!-- 开发者面板按钮 -->
              <button
                v-if="isDeveloperMode"
                class="group relative h-10 p-2 cursor-pointer overflow-visible flex-none"
                @click="isDeveloperPanelOpen = !isDeveloperPanelOpen"
              >
                <div
                  class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border border-orange-400/50 group-hover:shadow-[0_0_8px_2px_rgba(251,146,60,0.6)]"
                  :class="
                    isDeveloperPanelOpen
                      ? 'border-orange-400/50 group-hover:shadow-[0_0_8px_2px_rgba(251,146,60,0.6)]'
                      : 'border-orange-400/50'
                  "
                >
                  <div class="bg-gray-900 w-full h-2"></div>
                  <div class="absolute bottom-1 right-1">
                    <div class="flex">
                      <div
                        class="w-2 h-0.5 mt-1"
                        :class="isDeveloperPanelOpen ? 'bg-orange-400' : 'bg-orange-400'"
                      ></div>
                      <div class="w-0.5 h-2" :class="isDeveloperPanelOpen ? 'bg-orange-400' : 'bg-orange-400'"></div>
                    </div>
                  </div>
                </div>
                <div class="relative flex items-center justify-center h-full pointer-events-none">
                  <div
                    class="text-xs font-bold [text-shadow:_1px_1px_0_black]"
                    :class="isDeveloperPanelOpen ? 'text-orange-400' : 'text-orange-400'"
                  >
                    🛠️ 调试
                  </div>
                </div>
              </button>

              <!-- 主要操作按钮区域 -->
              <div class="grid grid-cols-2 gap-2 flex-1">
                <!-- 战斗按钮 -->
                <button
                  class="group relative p-2 cursor-pointer overflow-visible"
                  @click="panelState = PanelState.SKILLS"
                >
                  <div
                    class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border border-sky-400/50 group-hover:shadow-[0_0_8px_2px_rgba(56,189,248,0.6)]"
                  >
                    <div class="bg-gray-900 w-full h-3"></div>
                    <div class="absolute bottom-1 right-1">
                      <div class="flex">
                        <div class="bg-sky-400 w-3 h-0.5 mt-3"></div>
                        <div class="bg-sky-400 w-0.5 h-3.5"></div>
                      </div>
                    </div>
                  </div>
                  <div class="relative flex items-center justify-center h-full pointer-events-none">
                    <div class="text-sky-400 text-sm font-bold [text-shadow:_1px_1px_0_black]">
                      {{
                        i18next.t('fight', {
                          ns: 'battle',
                        })
                      }}
                    </div>
                  </div>
                </button>

                <!-- 切换按钮 -->
                <button
                  class="group relative p-2 cursor-pointer overflow-visible"
                  @click="panelState = PanelState.PETS"
                >
                  <div
                    class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border border-sky-400/50 group-hover:shadow-[0_0_8px_2px_rgba(56,189,248,0.6)]"
                  >
                    <div class="bg-gray-900 w-full h-3"></div>
                    <div class="absolute bottom-1 right-1">
                      <div class="flex">
                        <div class="bg-sky-400 w-3 h-0.5 mt-3"></div>
                        <div class="bg-sky-400 w-0.5 h-3.5"></div>
                      </div>
                    </div>
                  </div>
                  <div class="relative flex items-center justify-center h-full pointer-events-none">
                    <div class="text-sky-400 text-sm font-bold [text-shadow:_1px_1px_0_black]">
                      {{
                        i18next.t('switch', {
                          ns: 'battle',
                        })
                      }}
                    </div>
                  </div>
                </button>

                <!-- 什么都不做按钮 -->
                <button
                  class="group relative p-2 cursor-pointer overflow-visible disabled:opacity-60 disabled:cursor-not-allowed"
                  :disabled="!store.availableActions.find(a => a.type === 'do-nothing')"
                  @click="store.sendplayerSelection(store.availableActions.find(a => a.type === 'do-nothing')!)"
                >
                  <div
                    class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border group-disabled:border-gray-500/50 group-disabled:hover:shadow-none"
                    :class="
                      store.availableActions.find(a => a.type === 'do-nothing')
                        ? 'border-sky-400/50 group-hover:shadow-[0_0_8px_2px_rgba(56,189,248,0.6)]'
                        : 'border-gray-500/50'
                    "
                  >
                    <div class="bg-gray-900 w-full h-3"></div>
                    <div class="absolute bottom-1 right-1">
                      <div class="flex">
                        <div
                          class="w-3 h-0.5 mt-3"
                          :class="
                            store.availableActions.find(a => a.type === 'do-nothing') ? 'bg-sky-400' : 'bg-gray-500'
                          "
                        ></div>
                        <div
                          class="w-0.5 h-3.5"
                          :class="
                            store.availableActions.find(a => a.type === 'do-nothing') ? 'bg-sky-400' : 'bg-gray-500'
                          "
                        ></div>
                      </div>
                    </div>
                  </div>
                  <div class="relative flex items-center justify-center h-full pointer-events-none">
                    <div
                      class="text-sm font-bold [text-shadow:_1px_1px_0_black]"
                      :class="
                        store.availableActions.find(a => a.type === 'do-nothing') ? 'text-sky-400' : 'text-gray-400'
                      "
                    >
                      {{ i18next.t('do-nothing', { ns: 'battle' }) }}
                    </div>
                  </div>
                </button>

                <!-- 投降按钮 -->
                <button
                  class="group relative p-2 cursor-pointer overflow-visible disabled:opacity-60 disabled:cursor-not-allowed"
                  :disabled="!store.availableActions.find(a => a.type === 'surrender')"
                  @click="handleEscape"
                >
                  <div
                    class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border group-disabled:border-gray-500/50 group-disabled:hover:shadow-none"
                    :class="
                      store.availableActions.find(a => a.type === 'surrender')
                        ? 'border-red-400/50 group-hover:shadow-[0_0_8px_2px_rgba(248,113,113,0.6)]'
                        : 'border-gray-500/50'
                    "
                  >
                    <div class="bg-gray-900 w-full h-3"></div>
                    <div class="absolute bottom-1 right-1">
                      <div class="flex">
                        <div
                          class="w-3 h-0.5 mt-3"
                          :class="
                            store.availableActions.find(a => a.type === 'surrender') ? 'bg-red-400' : 'bg-gray-500'
                          "
                        ></div>
                        <div
                          class="w-0.5 h-3.5"
                          :class="
                            store.availableActions.find(a => a.type === 'surrender') ? 'bg-red-400' : 'bg-gray-500'
                          "
                        ></div>
                      </div>
                    </div>
                  </div>
                  <div class="relative flex items-center justify-center h-full pointer-events-none">
                    <div
                      class="text-sm font-bold [text-shadow:_1px_1px_0_black]"
                      :class="
                        store.availableActions.find(a => a.type === 'surrender') ? 'text-red-400' : 'text-gray-400'
                      "
                    >
                      {{
                        i18next.t('surrunder', {
                          ns: 'battle',
                        })
                      }}
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Transition name="fade">
        <div
          v-if="showBattleEndUI"
          class="fixed inset-0 bg-black/80 flex items-center justify-center"
          :class="Z_INDEX_CLASS.BATTLE_END_UI"
        >
          <div
            class="bg-gradient-to-br from-[#2a2a4a] to-[#1a1a2e] p-8 rounded-2xl shadow-[0_0_30px_rgba(81,65,173,0.4)] text-center"
          >
            <h2 class="text-5xl mb-4 text-white [text-shadow:_0_0_20px_#fff]">{{ battleResult }}</h2>
            <div class="flex gap-4 mt-8">
              <button
                class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
                @click="$router.push({ name: 'Lobby', query: { startMatching: 'true' } })"
              >
                重新匹配
              </button>
              <button
                class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
                @click="$router.push('/')"
              >
                返回大厅
              </button>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 开发者面板 -->
      <DeveloperPanel :is-developer-mode="isDeveloperMode" v-model:is-open="isDeveloperPanelOpen" />
    </div>
  </div>
</template>

<style>
/* 过渡动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.5s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.bg-battle-gradient {
  background: linear-gradient(145deg, #2a2a4a 0%, #1a1a2e 100%);
}

/* 战斗结果浮动动画 */
@keyframes float {
  0%,
  100% {
    transform: translateY(-50%) translateY(0);
  }
  50% {
    transform: translateY(-50%) translateY(-20px);
  }
}

.float-animation {
  animation: float 2s ease-in-out infinite;
}

/* 时间轴样式 */
.timeline-container {
  position: relative;
  width: 100%;
  height: 20px;
  padding: 8px 0;
}

.timeline-track {
  position: relative;
  width: 100%;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
}

.timeline-fill {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(to right, #3b82f6 0%, #1d4ed8 50%, #1e40af 100%);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.timeline-tick {
  position: absolute;
  top: -2px;
  width: 8px;
  height: 8px;
  background: rgba(255, 255, 255, 0.4);
  border: 2px solid rgba(255, 255, 255, 0.6);
  border-radius: 50%;
  transform: translateX(-50%);
  transition: all 0.3s ease;
}

.timeline-tick.active {
  background: #3b82f6;
  border-color: #1d4ed8;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
}

.timeline-clickable {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: pointer;
}

.timeline-clickable:hover .timeline-track {
  background: rgba(255, 255, 255, 0.3);
}

.timeline-clickable.pointer-events-none {
  pointer-events: none;
}
</style>
