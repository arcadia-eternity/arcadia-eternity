<script setup lang="ts">
import { waitForSkillAnimation } from '@/composition/skillAnimationWait'
import '@/assets/battle-theme.css'
import BattleCommandDock from '@/components/battle/BattleCommandDock.vue'
import BattleLoading from '@/components/battle/BattleLoading.vue'
import BattleFrame from '@/components/battle/BattleFrame.vue'
import { useBattlePreparation, withDeadline } from '@/composition/useBattlePreparation'
import { usePreferredReducedMotion } from '@vueuse/core'
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import TrainingPanel from '@/components/battle/TrainingPanel.vue'
import TeamSelectionPanel from '@/components/battle/TeamSelectionPanel.vue'
import Mark from '@/components/battle/Mark.vue'
import PetButton from '@/components/battle/PetButton.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import ClimaxEffectAnimation from '@/components/ClimaxEffectAnimation.vue'
import SimpleBattleTimer from '@/components/SimpleBattleTimer.vue'
import koImage from '@/assets/images/battle-ko.svg'
import { useMusic } from '@/composition/music'
import { useSound } from '@/composition/sound'
import { useBattleAnimations } from '@/composition/useBattleAnimations'
import { waitForAnimationOperation } from '@/composition/animationTask'
import { planAnimationMessages } from '@/composition/animationMessageBatch'
import { AnimationController, type AnimationTask } from '@/composition/animationController'
import { petResourceCache } from '@/services/petResourceCache'
import { useScreenOrientation, useFullscreen } from '@vueuse/core'
import { Z_INDEX, Z_INDEX_CLASS } from '@/constants/zIndex'
import { useBattleStore } from '@/stores/battle'
import { useBattleClientStore } from '@/stores/battleClient'
import { useBattleReportStore } from '@/stores/battleReport'
import { useBattleViewStore } from '@/stores/battleView'
import { useGameDataStore } from '@/stores/gameData'
import { useGameSettingStore } from '@/stores/gameSetting'
import { useResourceStore } from '@/stores/resource'
import { resolveSpeciesSpriteAsset } from '@/utils/resourceResolver'
import { logMessagesKey } from '@/symbol/battlelog'
import {
  BattleMessageType,
  BattleStatus as BattleStatusEnum,
  Category,
  DamageType,
  ELEMENT_CHART,
  type BattleMessage,
  type BattleState,
  type BattleTeamSelection,
  type TeamSelectionAction,
  type TeamSelectionConfig,
  type TeamInfo,
  type petId,
  type playerId,
  type PetMessage,
  type PetSwitchMessage,
  type skillId,
  type baseSkillId,
  type SkillMessage,
  type SkillUseEndMessage,
} from '@arcadia-eternity/const'
import { DArrowLeft, DArrowRight, Film, VideoPause, VideoPlay, Warning } from '@element-plus/icons-vue'
import gsap from 'gsap'
import i18next from 'i18next'
import mitt from 'mitt'
import {
  catchError,
  concatMap,
  defer,
  filter,
  finalize,
  from,
  mergeMap,
  of,
  startWith,
  take,
  takeUntil,
  toArray,
} from 'rxjs'
import { ActionState } from 'seer2-pet-animator'
import type { Delta } from 'jsondiffpatch'
import {
  computed,
  h,
  nextTick,
  onMounted,
  onUnmounted,
  provide,
  ref,
  render,
  unref,
  useTemplateRef,
  watch,
  type Ref,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'

// Props 定义
interface Props {
  replayMode?: boolean
  battleRecordId?: string
  localReportId?: string
  enableDeveloperMode?: boolean
  spectatorMode?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  replayMode: false,
  battleRecordId: undefined,
  localReportId: undefined,
  enableDeveloperMode: false,
  spectatorMode: false,
})

enum PanelState {
  SKILLS = 'skills',
  PETS = 'pets',
}
const panelState = ref<PanelState>(PanelState.SKILLS)

// 定义一个更精确的类型，用于 handleCombatEventMessage，确保消息有 target
type CombatEventMessageWithTarget = Extract<
  BattleMessage,
  | { type: BattleMessageType.SkillMiss; data: { target: petId; [key: string]: unknown } }
  | { type: BattleMessageType.Damage; data: { target: petId; [key: string]: unknown } }
  | { type: BattleMessageType.DamageFail; data: { target: petId; [key: string]: unknown } }
  | { type: BattleMessageType.Heal; data: { target: petId; [key: string]: unknown } }
>

type AnimationEvents = {
  'attack-hit': 'left' | 'right'
  'animation-complete': 'left' | 'right'
  'climax-effect-complete': void
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
const battleClientStore = useBattleClientStore()

// AnimationController - lazily instantiated in onMounted to avoid Vue reactive() issues
let animationController: AnimationController | null = null

// GSAP routing helpers - route through controller.gsapManager when available
let gsapIdCounter = 0
function gsapTo(target: gsap.TweenTarget, config: gsap.TweenVars): gsap.core.Tween {
  if (animationController?.gsapManager) {
    return animationController.gsapManager.createTween(target, { ...config, id: `tw-${++gsapIdCounter}` })
  }
  return gsap.to(target, config)
}
function gsapSet(target: gsap.TweenTarget, config: gsap.TweenVars): void {
  if (animationController?.gsapManager) {
    animationController.gsapManager.createTween(target, { ...config, duration: 0, id: `st-${++gsapIdCounter}` })
    return
  }
  gsap.set(target, config)
}
function gsapTimeline(config?: gsap.TimelineVars): gsap.core.Timeline {
  if (animationController?.gsapManager) {
    return animationController.gsapManager.createTimeline({
      ...config,
      id: `tl-${++gsapIdCounter}`,
    } as gsap.TimelineVars & { id: string })
  }
  return gsap.timeline(config)
}

// 自适应缩放相关
const battleContainerRef = useTemplateRef('battleContainerRef')
let resizeObserver: ResizeObserver | null = null

// 屏幕方向控制
const { lockOrientation, unlockOrientation } = useScreenOrientation()

// 全屏相关（将在下面重新定义包装函数）

// 自定义确认对话框（用于全屏模式）
const showCustomConfirm = ref(false)
const customConfirmTitle = ref('')
const customConfirmMessage = ref('')
const customConfirmResolve = ref<((value: boolean) => void) | null>(null)

// 掉线重连状态
const opponentDisconnected = ref(false)
const disconnectGraceTime = ref(0)
const disconnectTimer = ref<number | null>(null)

// 自己掉线状态
const selfDisconnected = ref(false)
const reconnecting = ref(false)
const exitingBecauseServerClosed = ref(false)
const skipSurrenderOnUnmount = ref(false)

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

// 包装VueUse的全屏函数，添加屏幕方向控制
const {
  isFullscreen: vueUseIsFullscreen,
  enter: vueUseEnterFullscreen,
  exit: vueUseExitFullscreen,
} = useFullscreen(battleContainerRef)

// 自定义进入全屏函数，包含屏幕方向锁定
const enterFullscreenWithOrientation = async () => {
  try {
    await vueUseEnterFullscreen()
    // 在全屏模式下尝试锁定屏幕方向为横屏
    try {
      await lockOrientation('landscape-primary')
    } catch (error) {
      console.warn('无法锁定屏幕方向:', error)
    }
  } catch (error) {
    console.error('进入全屏失败:', error)
  }
}

// 自定义退出全屏函数，包含屏幕方向解锁
const exitFullscreenWithOrientation = async () => {
  try {
    await vueUseExitFullscreen()
    // 退出全屏时解锁屏幕方向
    try {
      unlockOrientation()
    } catch (error) {
      console.warn('无法解锁屏幕方向:', error)
    }
  } catch (error) {
    console.error('退出全屏失败:', error)
  }
}

// 自定义切换全屏函数
const toggleFullscreenWithOrientation = () => {
  if (vueUseIsFullscreen.value) {
    exitFullscreenWithOrientation()
  } else {
    enterFullscreenWithOrientation()
  }
}

// 为了保持向后兼容性，创建别名
const isFullscreen = vueUseIsFullscreen
const exitFullscreen = exitFullscreenWithOrientation
const toggleFullscreen = toggleFullscreenWithOrientation

// VueUse的useFullscreen会自动处理全屏状态变化，无需手动监听

// 初始化音乐但不自动播放
const { startMusic, stopMusic } = useMusic(false)

provide(logMessagesKey, store.log)
const preferredMotion = usePreferredReducedMotion()
const effectiveMotion = computed(() => (preferredMotion.value === 'reduce' ? 'reduced' : gameSettingStore.battleMotion))
const battleViewRef = useTemplateRef('battleViewRef')
const battleCameraRef = useTemplateRef('battleCameraRef')
const backgroundContainerRef = useTemplateRef('backgroundContainerRef')
const leftPetRef = useTemplateRef('leftPetRef')
const rightPetRef = useTemplateRef('rightPetRef')
const leftStatusRef = useTemplateRef('leftStatusRef')
const rightStatusRef = useTemplateRef('rightStatusRef')
// 移除了 useElementBounding 相关代码，现在使用固定坐标系统
const showBattleEndUI = ref(false)
const showKoBanner = ref(false) // 新增：控制KO横幅显示
const koBannerRef = useTemplateRef('koBannerRef') // 新增：KO横幅的模板引用

// 等待对手响应状态 - 使用store中的waitingForResponse
const isWaitingForOpponent = computed(() => store.waitingForResponse)
const battleActionsReady = computed(
  () =>
    isFullyLoaded.value &&
    !isReplayMode.value &&
    !isSpectatorMode.value &&
    Array.isArray(store.availableActions) &&
    store.availableActions.length > 0,
)

// 团队选择相关计算属性
const currentPlayerTeam = computed(() => {
  const player = store.currentPlayer
  return player?.team || []
})

// 团队选择阶段的对手队伍数据
const teamSelectionOpponentTeam = computed(() => {
  if (!teamSelectionPlayerATeam.value || !teamSelectionPlayerBTeam.value) {
    return []
  }

  const currentPlayerId = store.playerId
  const players = store.battleState?.players || []

  // 根据当前玩家ID确定对手队伍
  if (players[0]?.id === currentPlayerId) {
    // 当前玩家是 playerA，对手是 playerB
    return teamSelectionPlayerBTeam.value?.pets || []
  } else {
    // 当前玩家是 playerB，对手是 playerA
    return teamSelectionPlayerATeam.value?.pets || []
  }
})

// Climax特效相关
const showClimaxEffect = ref(false) // 控制climax特效显示
const climaxEffectSide = ref<'left' | 'right' | null>(null) // 特效显示在哪一侧
const climaxEffectRef = useTemplateRef('climaxEffectRef') // climax特效组件引用

// 使用battleView store中的缩放
const battleViewScale = computed(() => battleViewStore.scale)

// 训练模式配置
const trainingModeConfig = computed(() => {
  return {
    // 基础条件检查
    isExplicitlyEnabled: props.enableDeveloperMode === true,

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

    // 检查是否应该启用训练模式（移除开发环境限制）
    get shouldEnable() {
      return this.isExplicitlyEnabled && this.isNotReplayMode && this.isNotBattleReport
    },
  }
})

// 训练模式检测
const isTrainingMode = computed(() => {
  const config = trainingModeConfig.value

  // 在开发环境下提供调试信息
  if (import.meta.env.DEV && props.enableDeveloperMode) {
    console.debug('Training mode check:', {
      mode: config.currentMode,
      enabled: config.shouldEnable,
      conditions: {
        isExplicitlyEnabled: config.isExplicitlyEnabled,
        isNotReplayMode: config.isNotReplayMode,
        isNotBattleReport: config.isNotBattleReport,
      },
    })
  }

  return config.shouldEnable
})

// 训练面板状态
const isTrainingPanelOpen = ref(false)

// 团队选择相关状态
const showTeamSelectionPanel = ref(false)
const teamSelectionConfig = ref<TeamSelectionConfig | null>(null)
const teamSelectionTimeLimit = ref<number | undefined>(undefined)
const currentTeamSelection = ref<BattleTeamSelection | null>(null)
const teamSelectionPlayerATeam = ref<TeamInfo | null>(null)
const teamSelectionPlayerBTeam = ref<TeamInfo | null>(null)

// 对手团队选择状态（目前为占位符，实际应从战斗状态中获取）
const opponentSelectionProgress = computed(() => {
  // TODO: 从战斗状态中获取对手的选择进度
  return 'not_started' as 'not_started' | 'in_progress' | 'completed'
})

const opponentTeamSelection = computed(() => {
  // TODO: 从战斗状态中获取对手的团队选择
  return null as BattleTeamSelection | null
})

// 空过按钮粒子效果相关
// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.battleState?.marks ?? [])
const currentTurn = computed(() => store.battleState?.currentTurn ?? 0)

// 当前正在使用的技能ID跟踪（用于连击伤害累计）
const currentActiveSkillId = ref<string | null>(null)

const backgroundChoice = Math.random()
const background = computed(() => {
  if (gameSettingStore.background === 'random') {
    return Object.values(resourceStore.background.byId)[
      Math.floor(backgroundChoice * resourceStore.background.allIds.length)
    ]
  }
  return (
    resourceStore.getBackGround(gameSettingStore.background) ??
    'https://seer2-resource.yuuinih.com/png/battleBackground/grass.png'
  )
})

const {
  showMissMessage,
  showAbsorbMessage,
  showDamageMessage,
  showHealMessage,
  showUseSkillMessage,
  playImageSkill,
  updateBackgroundAspectRatio,
  reset: resetBattleEffects,
  cleanup: cleanupBattleAnimations,
} = useBattleAnimations(
  battleViewRef as Ref<HTMLElement | null>,
  store,
  currentPlayer,
  opponentPlayer,
  battleViewScale,
  backgroundContainerRef as Ref<HTMLElement | null>,
  () => animationController?.gsapManager,
  effectiveMotion,
  battleCameraRef as Ref<HTMLElement | null>,
)

const leftActiveSpecies = computed(() => {
  const activePet = currentPlayer.value?.team?.find(p => p.id === currentPlayer.value?.activePet)
  return gameDataStore.getSpecies(activePet?.speciesID ?? '')
})
const rightActiveSpecies = computed(() => {
  const activePet = opponentPlayer.value?.team?.find(p => p.id === opponentPlayer.value?.activePet)
  return gameDataStore.getSpecies(activePet?.speciesID ?? '')
})

const leftPetSpriteAsset = computed(() => resolveSpeciesSpriteAsset(leftActiveSpecies.value, resourceStore.getPetSwf))
const rightPetSpriteAsset = computed(() => resolveSpeciesSpriteAsset(rightActiveSpecies.value, resourceStore.getPetSwf))

const leftPetSpeciesNum = computed(() => leftPetSpriteAsset.value.swfNum)
const rightPetSpeciesNum = computed(() => rightPetSpriteAsset.value.swfNum)

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

// 缓存技能的原始顺序，避免在技能变身时位置发生变化
const skillOrderCache = ref<
  Map<string, Map<string, { id: string; baseId: baseSkillId; originalCategory: Category; index: number }>>
>(new Map())

// 全局技能原始状态缓存，用于记录技能的初始状态
const globalSkillOriginalState = ref<Map<string, { baseId: baseSkillId; originalCategory: Category }>>(new Map())

// 监听战斗状态变化，在战斗开始时建立技能原始状态快照
watch(
  () => store.battleState,
  newBattleState => {
    if (newBattleState && newBattleState.players) {
      // 遍历所有玩家的所有宠物的所有技能，建立原始状态快照
      newBattleState.players.forEach(player => {
        if (player.team) {
          player.team.forEach(pet => {
            if (pet && pet.skills) {
              pet.skills.forEach(skill => {
                if (!skill.isUnknown && !globalSkillOriginalState.value.has(skill.id)) {
                  // 只有在首次遇到技能时才记录其原始状态
                  const skillData = gameDataStore.getSkill(skill.baseId)
                  globalSkillOriginalState.value.set(skill.id, {
                    baseId: skill.baseId,
                    originalCategory: skillData?.category || skill.category,
                  })
                }
              })
            }
          })
        }
      })
    }
  },
  { deep: true, immediate: true },
)

// 监听当前玩家的活跃宠物变化，清理不相关的缓存
watch(
  () => currentPlayer.value?.activePet,
  (newActivePet, oldActivePet) => {
    if (newActivePet !== oldActivePet) {
      // 当活跃宠物变化时，清理旧的缓存（保留当前宠物的缓存）
      const keysToDelete: string[] = []
      for (const [key] of skillOrderCache.value) {
        if (key !== newActivePet) {
          keysToDelete.push(key)
        }
      }
      keysToDelete.forEach(key => skillOrderCache.value.delete(key))
    }
  },
)

const availableSkills = computed<SkillMessage[]>(() => {
  if (!currentPlayer.value?.activePet) return []

  const petId = currentPlayer.value.activePet
  const skills = store.getPetById(petId)?.skills?.filter(skill => !skill.isUnknown) ?? []

  // 初始化或更新技能顺序缓存
  const cacheKey = petId
  const existingOrderMap = skillOrderCache.value.get(cacheKey)

  // 检查是否需要重新初始化缓存
  const needsReinit =
    !existingOrderMap ||
    existingOrderMap.size !== skills.length ||
    skills.some(skill => !existingOrderMap.has(skill.id))

  if (needsReinit) {
    const orderMap = new Map<string, { id: string; baseId: baseSkillId; originalCategory: Category; index: number }>()

    skills.forEach((skill, index) => {
      // 泛用化逻辑：获取技能的原始属性
      let originalBaseId = skill.baseId
      let originalCategory = skill.category

      // 检查是否已经缓存了这个技能的原始信息
      const existingCache = existingOrderMap?.get(skill.id)
      if (existingCache) {
        // 如果已经缓存，使用缓存的原始信息（这是最可靠的）
        originalBaseId = existingCache.baseId
        originalCategory = existingCache.originalCategory
      } else {
        // 首次在当前宠物中遇到这个技能，尝试从全局原始状态缓存获取
        const globalOriginalState = globalSkillOriginalState.value.get(skill.id)
        if (globalOriginalState) {
          // 使用全局缓存的原始状态
          originalBaseId = globalOriginalState.baseId
          originalCategory = globalOriginalState.originalCategory
        } else {
          // 如果全局缓存中也没有，说明这是一个新技能
          // 记录当前状态作为原始状态
          const currentSkillData = gameDataStore.getSkill(skill.baseId)
          if (currentSkillData) {
            originalBaseId = skill.baseId
            originalCategory = currentSkillData.category
            // 同时更新全局缓存
            globalSkillOriginalState.value.set(skill.id, {
              baseId: skill.baseId,
              originalCategory: currentSkillData.category,
            })
          } else {
            // 最后的回退方案
            originalBaseId = skill.baseId
            originalCategory = skill.category
            globalSkillOriginalState.value.set(skill.id, {
              baseId: skill.baseId,
              originalCategory: skill.category,
            })
          }
        }
      }

      orderMap.set(skill.id, {
        id: skill.id,
        baseId: originalBaseId,
        originalCategory: originalCategory,
        index: index,
      })
    })

    skillOrderCache.value.set(cacheKey, orderMap)
  }

  const orderMap = skillOrderCache.value.get(cacheKey)!

  // 创建稳定的技能数组，按照缓存的顺序排列
  const stableSkills = skills
    .map(skill => {
      const cachedInfo = orderMap.get(skill.id)
      if (!cachedInfo) return null

      // 创建一个新的技能对象，避免直接引用store中可能变化的对象
      return {
        // 复制所有技能属性，但使用稳定的标识符
        id: skill.id,
        baseId: skill.baseId,
        category: skill.category,
        element: skill.element,
        target: skill.target,
        multihit: skill.multihit,
        sureHit: skill.sureHit,
        tag: skill.tag || [],
        power: skill.power,
        accuracy: skill.accuracy,
        rage: skill.rage,
        priority: skill.priority,
        isUnknown: skill.isUnknown,
        modifierState: skill.modifierState,

        // 添加稳定的UI标识符
        _originalBaseId: cachedInfo.baseId,
        _originalCategory: cachedInfo.originalCategory,
        _stableIndex: cachedInfo.index,
        _stableId: `${petId}-skill-${cachedInfo.index}`,
      }
    })
    .filter(skill => skill !== null)
    .sort((a, b) => a!._stableIndex - b!._stableIndex) // 按照原始顺序排序

  return stableSkills as SkillMessage[]
})

// 获取技能的 modifier 信息
const getSkillModifierInfo = (skill: SkillMessage, attributeName: string) => {
  // 技能的 modifier 信息直接从技能的 modifierState 中获取
  if (!skill.modifierState) return undefined

  // 在技能的 modifierState 中查找对应的属性
  return skill.modifierState.attributes.find(attr => attr.attributeName === attributeName)
}

// 计算技能对敌方精灵的属性克制倍率
const getTypeEffectiveness = (skill: SkillMessage) => {
  // 获取敌方当前出战精灵
  const opponentActivePet = opponentPlayer.value?.team?.find(pet => pet.id === opponentPlayer.value?.activePet)
  if (!opponentActivePet || !skill.element) return 1

  // 从ELEMENT_CHART获取克制倍率
  const effectiveness = ELEMENT_CHART[skill.element]?.[opponentActivePet.element]
  return effectiveness !== undefined ? effectiveness : 1
}

const handleSkillClick = (skillId: string) => {
  if (isWaitingForOpponent.value || isSpectatorMode.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handlePetSelect = (petId: string) => {
  if (isWaitingForOpponent.value || isSpectatorMode.value) return

  // 优先尝试正常的精灵切换
  const switchAction = store.availableActions.find(a => a.type === 'switch-pet' && a.pet === petId)
  if (switchAction) {
    store.sendplayerSelection(switchAction)
    panelState.value = PanelState.SKILLS
    return
  }

  // 击破奖励回合时，如果点击的是当前在场精灵，则执行空过操作
  if (isInFaintSwitchPhase.value && petId === currentPlayer.value?.activePet) {
    const doNothingAction = store.availableActions.find(a => a.type === 'do-nothing')
    if (doNothingAction) {
      store.sendplayerSelection(doNothingAction)
      panelState.value = PanelState.SKILLS
    }
  }
}

const handleEscape = async () => {
  if (isWaitingForOpponent.value || isSpectatorMode.value) return
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

// 团队选择事件处理
const onTeamSelectionChange = (selection: BattleTeamSelection) => {
  currentTeamSelection.value = selection
}

const onTeamSelectionConfirm = async (selection: BattleTeamSelection) => {
  try {
    const teamSelectionAction: TeamSelectionAction = {
      type: 'team-selection' as const,
      player: store.playerId as playerId,
      selectedPets: selection.selectedPets,
      starterPetId: selection.starterPetId,
    }

    await store.sendplayerSelection(teamSelectionAction)
    showTeamSelectionPanel.value = false
  } catch (error) {
    console.error('团队选择提交失败:', error)
  }
}

const onTeamSelectionTimeout = () => {
  // 超时时使用默认选择
  if (currentPlayerTeam.value.length > 0) {
    const defaultSelection: BattleTeamSelection = {
      selectedPets: currentPlayerTeam.value
        .slice(0, teamSelectionConfig.value?.maxTeamSize || 6)
        .map((pet: PetMessage) => pet.id),
      starterPetId: currentPlayerTeam.value[0]?.id || ('' as petId),
    }
    onTeamSelectionConfirm(defaultSelection)
  }
}

// 断线事件处理器引用，用于防止重复注册和清理
let opponentDisconnectedHandler: ((data: { disconnectedPlayerId: string; graceTimeRemaining: number }) => void) | null =
  null
let opponentReconnectedHandler: ((data: { reconnectedPlayerId: string }) => void) | null = null

// 设置掉线重连事件处理
const setupDisconnectHandlers = () => {
  if (props.replayMode) return // 回放模式不需要处理掉线

  // 防止重复注册
  if (opponentDisconnectedHandler || opponentReconnectedHandler) {
    return
  }

  // 监听对手掉线事件
  opponentDisconnectedHandler = (data: { disconnectedPlayerId: string; graceTimeRemaining: number }) => {
    opponentDisconnected.value = true
    disconnectGraceTime.value = Math.ceil(data.graceTimeRemaining / 1000) // 转换为秒

    // 启动倒计时
    if (disconnectTimer.value) {
      clearInterval(disconnectTimer.value)
    }

    disconnectTimer.value = window.setInterval(() => {
      disconnectGraceTime.value--
      if (disconnectGraceTime.value <= 0) {
        clearInterval(disconnectTimer.value!)
        disconnectTimer.value = null
        // 倒计时结束，等待服务器通知战斗结果
      }
    }, 1000)
  }

  // 监听对手重连事件
  opponentReconnectedHandler = () => {
    opponentDisconnected.value = false

    if (disconnectTimer.value) {
      clearInterval(disconnectTimer.value)
      disconnectTimer.value = null
    }
  }

  battleClientStore.on('opponentDisconnected', opponentDisconnectedHandler)
  battleClientStore.on('opponentReconnected', opponentReconnectedHandler)
}

// 清理断线事件处理器
const cleanupDisconnectHandlers = () => {
  if (opponentDisconnectedHandler) {
    battleClientStore.off('opponentDisconnected', opponentDisconnectedHandler)
    opponentDisconnectedHandler = null
  }
  if (opponentReconnectedHandler) {
    battleClientStore.off('opponentReconnected', opponentReconnectedHandler)
    opponentReconnectedHandler = null
  }
}

const exitBattleBecauseServerClosed = async (reason: string) => {
  if (props.replayMode || exitingBecauseServerClosed.value) return
  if (router.currentRoute.value.name !== 'Battle') return

  exitingBecauseServerClosed.value = true
  skipSurrenderOnUnmount.value = true
  store.isBattleEnd = true
  store.availableActions = []
  store.waitingForResponse = false

  console.warn('Battle ended on server, leaving battle page', { reason })
  await router.replace({ path: '/' })
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

// 检查是否处于击破奖励回合
const isInFaintSwitchPhase = computed(() => {
  return store.availableActions?.some(a => a.type === 'do-nothing') ?? false
})

// 检查精灵是否可以被选择（包括击破奖励回合的当前在场精灵）
const isPetSelectable = (petId: petId) => {
  // 正常情况下，检查是否可以切换
  if (isPetSwitchable(petId)) {
    return true
  }

  // 击破奖励回合时，当前在场精灵也可以被选择（用于空过）
  if (isInFaintSwitchPhase.value && petId === currentPlayer.value?.activePet) {
    return true
  }

  return false
}

// 回放模式相关
const isReplayMode = computed(() => props.replayMode)

// 观战模式相关
const isSpectatorMode = computed(() => {
  // 检查props中的观战模式设置
  if (props.spectatorMode) return true

  // 检查URL查询参数中的观战标记
  const spectateParam = route.query.spectate
  if (spectateParam === 'true') return true

  return false
})

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
let battleDisposed = false
let releasePreparationWait: (() => void) | undefined
let releaseBattleStartWait: (() => void) | undefined
let playerReadySent = false
const preparation = useBattlePreparation()
const {
  tasks: loadingTasks,
  error: loadingError,
  ready: isFullyLoaded,
  progress: overallProgress,
  degraded: degradedResources,
} = preparation
const isReplayFullyLoaded = ref(false)
const resourceAttempt = ref(0)

async function loadReplayData() {
  let record
  if (props.localReportId) {
    record = battleReportStore.loadLocalBattleReport(props.localReportId)?.battleRecord
  } else {
    const id = props.battleRecordId || String(route.params.id || '')
    if (!id) throw new Error('缺少战报 ID')
    await battleReportStore.fetchBattleRecord(id)
    record = battleReportStore.currentBattleRecord
  }
  if (!record) throw new Error('战报加载失败，请重试或返回战报列表')
  if (battleDisposed) return
  store.initReplayMode(record.battle_messages, record.final_state as BattleState, record.player_a_id)
}

async function checkPetSpritesReady(): Promise<void> {
  await nextTick()
  const sides = [
    { player: currentPlayer.value, sprite: leftPetRef.value },
    { player: opponentPlayer.value, sprite: rightPetRef.value },
  ]
  for (const { player, sprite } of sides) {
    const activePet = player?.team?.find(pet => pet.id === player.activePet)
    // Hidden opponents are revealed after the player-ready handshake.
    if (activePet && !activePet.isUnknown && !sprite) throw new Error('首发精灵资源尚未初始化')
  }
  await Promise.all(sides.filter(side => side.sprite).map(side => side.sprite!.ready))
}

const initializeBattleResources = async () => {
  resourceAttempt.value++
  await preparation.prepare([
    { id: 'resources', label: '界面资源', required: true, run: () => resourceStore.initialize() },
    { id: 'data', label: '游戏数据', required: true, run: () => gameDataStore.initialize() },
    {
      id: 'battle',
      label: '对局数据',
      required: true,
      run: async () => {
        if (props.replayMode) await loadReplayData()
        else if (!store.battleState) throw new Error('没有可用的对局数据，请返回大厅')
      },
    },
    {
      id: 'background',
      label: '战斗场景',
      required: true,
      run: async () => {
        if (!background.value) throw new Error('没有可用的战斗场景')
        await new Promise<void>((resolve, reject) => {
          const image = new Image()
          image.onload = () => {
            updateBackgroundAspectRatio(image.naturalWidth, image.naturalHeight)
            resolve()
          }
          image.onerror = () => reject(new Error('场景图片不可用'))
          image.src = background.value!
        })
      },
    },
    {
      id: 'pets',
      label: '首发精灵',
      required: false,
      run: checkPetSpritesReady,
    },
    ...(!props.replayMode
      ? [
          {
            id: 'connection',
            label: '对战连接',
            required: true,
            run: async () => {
              if (!messageSubscription) {
                await setupMessageSubscription()
                setupDisconnectHandlers()
              }
              const isPlayer = store.battleState?.players.some(player => player.id === store.playerId)
              if (isPlayer && !playerReadySent) {
                await store.ready()
                playerReadySent = true
              }
              // The handshake can reveal the opposing starter. Keep the loading screen
              // until that state (or the team-selection phase) has reached the page.
              const started = () =>
                store.battleState?.status !== BattleStatusEnum.Unstarted || store.teamSelectionActive
              if (!started()) {
                await new Promise<void>(resolve => {
                  const stop = watch(started, value => {
                    if (value) finish()
                  })
                  const finish = () => {
                    stop()
                    resolve()
                  }
                  releaseBattleStartWait?.()
                  releaseBattleStartWait = finish
                })
              }
            },
          },
          { id: 'scene-pets', label: '场上精灵', required: false, run: checkPetSpritesReady },
        ]
      : []),
  ])
  if (isFullyLoaded.value) {
    isReplayFullyLoaded.value = props.replayMode && store.replaySnapshots.length > 0
    startMusic()
    // Reserve assets load after the first scene is usable.
    void preloadPetSprites()
  }
}

const checkReplayLoadingStatus = async () => {
  isReplayFullyLoaded.value = isFullyLoaded.value && store.replaySnapshots.length > 0
}
const retryReplayLoading = async () => {
  await initializeBattleResources()
}

const goBackFromReplay = async () => {
  stopPlayback()
  store.exitReplayMode()

  // 先退出全屏再跳转路由
  if (isFullscreen.value) {
    await exitFullscreen()
  }

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

// 战斗结束后的导航函数 - 先退出全屏再跳转
const navigateToLobbyWithMatching = async () => {
  if (isFullscreen.value) {
    await exitFullscreen()
  }
  router.push({ name: 'Lobby', query: { startMatching: 'true' } })
}

const navigateToHome = async () => {
  if (isFullscreen.value) {
    await exitFullscreen()
  }
  router.push('/')
}

const nextTurn = () => {
  cancelSpriteWaits()
  resetBattleEffects()
  store.nextReplayTurn()
}

const previousTurn = () => {
  cancelSpriteWaits()
  resetBattleEffects()
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
  resetBattleEffects()
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
    const config = {
      x: targetX,
      opacity: targetOpacity,
      duration,
      ease,
      onComplete: onCompleteCallback,
    }
    if (animationController) {
      return animationController.gsapManager.createTweenPlayback(petSprite.$el, {
        ...config,
        id: `move-${++gsapIdCounter}`,
      }).finished
    }
    return new Promise<void>(resolve => {
      gsap.to(petSprite.$el, {
        ...config,
        onComplete: () => {
          onCompleteCallback?.()
          resolve()
        },
        onInterrupt: resolve,
      })
    })
  }
  return Promise.resolve()
}

async function switchPetAnimate(toPetId: petId, side: 'left' | 'right', petSwitchMessage: PetSwitchMessage) {
  const execution = runningExecution
  assertExecution(execution)
  const oldPetSprite = petSprites.value[side]
  const battleViewWidth = 1600 // 固定的战斗视图宽度
  const isLeft = side === 'left'
  const offScreenX = isLeft ? -battleViewWidth / 2 - 100 : battleViewWidth / 2 + 100
  const animationDuration = 1

  // 开始动画追踪（仅在非回放模式下）
  let animationId: string | null = null
  const trackingInterface = props.replayMode ? null : store.battleInterface
  try {
    if (trackingInterface) {
      try {
        const ownerId = currentPlayer.value?.id
        if (!ownerId) {
          console.warn('No current player ID available for animation tracking')
        }
        if (ownerId)
          animationId = await waitForAnimationOperation(
            trackingInterface.startAnimation(toPetId, animationDuration * 1000 * 2, ownerId),
            execution.signal,
            3000,
          ) // 切换动画预期时长
      } catch (error) {
        console.warn('Failed to start switch animation tracking:', error)
      }
    }

    assertExecution(execution)
    await animatePetTransition(oldPetSprite, offScreenX, 0, animationDuration, 'power2.in')

    await applyAnimationDelta(petSwitchMessage, execution)
    await nextTick()
    assertExecution(execution)

    const newPetSprite = petSprites.value[side]
    if (!newPetSprite || !newPetSprite.$el) {
      console.warn(`New PetSprite on side ${side} not found after state update for pet ${toPetId}`)
      return
    }

    const newPetReadyPromise = newPetSprite.ready
    if (newPetReadyPromise) {
      await withDeadline(newPetReadyPromise, 7000).catch(() => {})
      assertExecution(execution)
    }

    gsapSet(newPetSprite.$el, { x: offScreenX, opacity: 0 })
    const newPetInfo = store.getPetById(toPetId)
    const newPetSpeciesNum = gameDataStore.getSpecies(newPetInfo?.speciesID ?? '')?.num ?? 0
    if (newPetSpeciesNum !== 0) {
      playPetSound(newPetSpeciesNum)
    }
    await animatePetTransition(newPetSprite, 0, 1, animationDuration, 'power2.out')
    assertExecution(execution)
  } finally {
    // 结束动画追踪（仅在非回放模式下）
    if (trackingInterface && animationId) {
      try {
        await withDeadline(trackingInterface.endAnimation(animationId), 3000).catch(() => {})
      } catch (error) {
        console.warn('Failed to end switch animation tracking:', error)
      }
    }
  }
}

const petSprites = computed(() => {
  return {
    left: leftPetRef.value!,
    right: rightPetRef.value!,
  }
})

const spriteWaits = new Set<() => void>()
function cancelSpriteWaits() {
  for (const finish of [...spriteWaits]) finish()
}
async function useSkillAnimate(messages: BattleMessage[]): Promise<void> {
  const execution = runningExecution
  assertExecution(execution)
  const useSkill = messages.filter(m => m.type === BattleMessageType.SkillUse)[0]
  if (!useSkill) return

  // 设置当前活跃技能ID用于连击伤害跟踪
  currentActiveSkillId.value = useSkill.data.skill

  await applyAnimationDelta(useSkill, execution)

  const baseSkillId = useSkill.data.baseSkill
  const baseSkillData = gameDataStore.getSkill(baseSkillId)
  const category = baseSkillData?.category || Category.Physical
  const side = getTargetSide(useSkill.data.user)
  let source = petSprites.value[side]

  if (!source) {
    for (const message of messages) {
      if (message !== useSkill) await applyAnimationDelta(message, execution)
    }
    return
  }

  // 根据技能类别设置预期动画时长：climax技能20秒，其他技能5秒
  const expectedDuration = category === Category.Climax ? 20000 : 5000

  // A loading renderer stays on the image path for this entire skill.
  // Do not repeatedly stall the queue while a degraded SWF is still loading.
  await nextTick()
  assertExecution(execution)
  source = petSprites.value[side]
  const availableState = source ? unref(source.availableState) : []
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

  const useImageEffect = !source || !availableState.includes(state)

  // 开始动画追踪（仅在非回放模式下）
  let animationId: string | null = null
  const trackingInterface = props.replayMode ? null : store.battleInterface
  if (trackingInterface) {
    try {
      const ownerId = currentPlayer.value?.id
      if (!ownerId) {
        console.warn('No current player ID available for animation tracking')
      }
      if (ownerId)
        animationId = await waitForAnimationOperation(
          trackingInterface.startAnimation(baseSkillId, expectedDuration, ownerId),
          execution.signal,
          3000,
        )
    } catch (error) {
      console.warn('Failed to start animation tracking:', error)
    }
  }

  animationController?.onAnimationPlaying(execution)
  assertExecution(execution)
  showUseSkillMessage(side, baseSkillId)
  if (source) source.$el.style.zIndex = Z_INDEX.DYNAMIC_ANIMATION.toString()

  try {
    // 如果是climax技能，触发特效并等待播放完成
    if (category === Category.Climax && !useImageEffect) {
      // 显示climax特效
      climaxEffectSide.value = side
      showClimaxEffect.value = true

      // 创建黑屏遮罩和启动全屏震动效果
      createClimaxBlackScreen()
      startClimaxScreenShake()

      // 播放特效动画并等待完成
      if (climaxEffectRef.value) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(() => handleClimaxComplete(), 8000)
          // 创建一个临时的完成处理器
          const handleClimaxComplete = () => {
            // 移除事件监听器
            clearTimeout(timer)
            spriteWaits.delete(handleClimaxComplete)
            emitter.off('climax-effect-complete', handleClimaxComplete)
            resolve()
          }

          // 监听特效完成事件
          spriteWaits.add(handleClimaxComplete)
          emitter.on('climax-effect-complete', handleClimaxComplete)

          // 播放特效
          climaxEffectRef.value!.play()
        })
      }
      playSkillSound(baseSkillId)
    }
    assertExecution(execution)
    // Register before playback. Missing hit markers fall back to completion, never an early timer.
    const animationWait = useImageEffect
      ? playImageSkill(side, category)
      : waitForSkillAnimation(emitter, side, expectedDuration)
    void animationWait.complete.then(() => spriteWaits.delete(animationWait.cancel))
    spriteWaits.add(animationWait.cancel)
    execution?.signal.addEventListener('abort', animationWait.cancel, { once: true })
    void animationWait.complete.then(() => execution?.signal.removeEventListener('abort', animationWait.cancel))
    const hitPromise = animationWait.hit
    const animateCompletePromise = animationWait.complete
    if (!useImageEffect && source) await withDeadline(source.setState(state), expectedDuration).catch(() => {})

    await hitPromise
    assertExecution(execution)
    if (
      (category !== Category.Climax || useImageEffect) &&
      !messages.some(msg => msg.type === BattleMessageType.SkillMiss)
    )
      playSkillSound(baseSkillId)

    for (const msg of messages) {
      const combatEventTypes: BattleMessageType[] = [
        BattleMessageType.SkillMiss,
        BattleMessageType.Damage,
        BattleMessageType.DamageFail,
        BattleMessageType.Heal,
      ]
      if (combatEventTypes.includes(msg.type as BattleMessageType)) {
        await handleCombatEventMessage(msg as CombatEventMessageWithTarget, true)
      } else {
        await applyAnimationDelta(msg, execution)
        // Check if the delta contains a transform for the active pet
        if (animationController && msg.data) {
          const activePetId = side === 'left' ? currentPlayer.value?.activePet : opponentPlayer.value?.activePet
          if (activePetId) {
            animationController.checkDeltaForTransform(msg.data as Delta, activePetId)
          }
        }
      }
    }

    await animateCompletePromise
    assertExecution(execution)
  } finally {
    if (runningExecution === execution && source) source.$el.style.zIndex = ''

    // 结束动画追踪（仅在非回放模式下）
    if (trackingInterface && animationId) {
      try {
        await withDeadline(trackingInterface.endAnimation(animationId), 3000).catch(() => {})
      } catch (error) {
        console.warn('Failed to end animation tracking:', error)
      }
    }

    // 清除当前活跃技能ID
    if (runningExecution === execution) currentActiveSkillId.value = null
  }
}

async function handleCombatEventMessage(message: CombatEventMessageWithTarget, isFromSkillSequenceContext: boolean) {
  const execution = runningExecution
  assertExecution(execution)
  if (store.isApplied(message)) return
  const targetPetId = message.data.target
  const targetSide = getTargetSide(targetPetId)
  const targetPetSprite = petSprites.value[targetSide]

  if (!targetPetSprite) {
    await applyAnimationDelta(message, execution)
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
            currentActiveSkillId.value || undefined,
          )
          break
        }
        const { currentHp, maxHp } = damageData
        const { availableState } = targetPetSprite
        const isDead = currentHp <= 0
        const isCriticalHealth = currentHp < maxHp * 0.25
        const isFromSelf = damageData.source === targetPetId
        const shouldSetPetAnimationState =
          (!isFromSkillSequenceContext ||
            (isFromSkillSequenceContext && (damageData as { damageType: string }).damageType !== DamageType.Effect)) &&
          !isFromSelf

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
          currentActiveSkillId.value || undefined,
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
  await applyAnimationDelta(message, execution)
}

const handleAttackHit = (side: 'left' | 'right') => {
  emitter.emit('attack-hit', side)
}

const handleAnimationComplete = (side: 'left' | 'right') => {
  emitter.emit('animation-complete', side)
}

// Climax全屏黑屏遮罩
let climaxBlackScreenElement: HTMLElement | null = null

const createClimaxBlackScreen = () => {
  if (!battleViewRef.value || climaxBlackScreenElement) return

  // 使用渲染函数创建黑屏遮罩
  const blackScreenVNode = h('div', {
    style: {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      backgroundColor: 'black',
      pointerEvents: 'none',
      zIndex: Z_INDEX.CLIMAX_BLACK_SCREEN.toString(),
    },
  })

  const tempHost = document.createElement('div')
  battleViewRef.value.appendChild(tempHost)
  render(blackScreenVNode, tempHost)

  climaxBlackScreenElement = tempHost.firstChild as HTMLElement
  if (!climaxBlackScreenElement) {
    battleViewRef.value?.removeChild(tempHost)
  }
}

const removeClimaxBlackScreen = () => {
  if (!battleViewRef.value || !climaxBlackScreenElement) return

  const tempHost = climaxBlackScreenElement.parentElement
  if (tempHost) {
    render(null, tempHost)
    if (battleViewRef.value.contains(tempHost)) {
      battleViewRef.value.removeChild(tempHost)
    }
  }
  climaxBlackScreenElement = null
}

// Climax全屏震动效果
const startClimaxScreenShake = () => {
  if (!battleCameraRef.value || effectiveMotion.value !== 'standard') return

  const shakeIntensity = (20 + Math.random() * 30) * battleViewScale.value
  const shakeAngle = Math.random() * Math.PI * 2
  const shakeX = Math.cos(shakeAngle) * shakeIntensity
  const shakeY = Math.sin(shakeAngle) * shakeIntensity

  const shakeAnimation = gsapTo(battleCameraRef.value, {
    x: shakeX,
    y: shakeY,
    duration: 0.05,
    repeat: -1,
    yoyo: true,
    ease: 'power1.inOut',
  })

  ;(battleCameraRef.value as unknown as HTMLElement & Record<string, unknown>)._climaxShakeAnimation = shakeAnimation
}

const stopClimaxScreenShake = () => {
  if (!battleCameraRef.value) return

  const el = battleCameraRef.value as unknown as HTMLElement & Record<string, unknown>
  const shakeAnimation = el._climaxShakeAnimation as gsap.core.Tween | undefined
  if (shakeAnimation) {
    shakeAnimation.kill()
    delete el._climaxShakeAnimation
  }

  // 恢复到正确的状态
  gsapSet(battleCameraRef.value, {
    x: 0,
    y: 0,
  })

  // 移除黑屏遮罩
  removeClimaxBlackScreen()
}

watch(effectiveMotion, () => {
  resetBattleEffects()
  stopClimaxScreenShake()
})

// 处理climax特效完成
const handleClimaxEffectComplete = () => {
  showClimaxEffect.value = false
  climaxEffectSide.value = null

  // 停止震动效果和移除黑屏遮罩
  stopClimaxScreenShake()

  // 发出特效完成事件
  emitter.emit('climax-effect-complete')
}

// 计算特效位置
const getClimaxEffectStyle = () => {
  if (!climaxEffectSide.value) return {}

  // 根据精灵位置计算特效位置
  const isLeft = climaxEffectSide.value === 'left'

  return {
    // 设置特效容器大小 - 大一倍
    width: '1600px',
    height: '1600px',
    // 定位到1/3位置
    left: isLeft ? '33.33%' : '66.67%',
    top: '50%',
    // 居中对齐
    transform: 'translate(-50%, -50%)',
  }
}

const getTargetSide = (targetPetId: string): 'left' | 'right' => {
  const isCurrentPlayerPet = currentPlayer.value?.team?.some(p => p.id === targetPetId)
  return isCurrentPlayerPet ? 'left' : 'right'
}

let messageSubscription: { unsubscribe: () => void } | null = null
type MessageAnimationTask = (() => Promise<void>) & { messages?: BattleMessage[] }
const animationQueue = store.animateQueue
const animating = ref(false)
const battleRenderer = ref(gameSettingStore.battleRenderer)
// A preference change and recovered SWF become visible between queue tasks.
watch(
  [() => gameSettingStore.battleRenderer, animating],
  ([renderer, playing]) => {
    if (!playing) battleRenderer.value = renderer
  },
  { flush: 'sync' },
)

function restorePetContainers() {
  for (const sprite of [leftPetRef.value, rightPetRef.value]) {
    if (sprite?.$el) gsapSet(sprite.$el, { x: 0, opacity: 1, zIndex: '' })
  }
}
let runningExecution: AnimationTask | null = null
function assertExecution(execution: AnimationTask | null): asserts execution is AnimationTask {
  if (battleDisposed || !animationController?.isTaskCurrent(execution))
    throw new DOMException('动画任务已取消', 'AbortError')
}
async function applyAnimationDelta(message: BattleMessage, execution: AnimationTask | null) {
  assertExecution(execution)
  await store.applyStateDelta(message, () => !battleDisposed && !!animationController?.isTaskCurrent(execution))
  assertExecution(execution)
}

// Subscribe to animation queue - tracks animation state via controller when available
const animatesubscribe = animationQueue
  .pipe(
    concatMap(task =>
      defer(() => {
        if (battleDisposed || !animationController) return of(null)
        const controller = animationController
        const execute = (): ReturnType<typeof of> | ReturnType<typeof from> =>
          from(controller.waitUntilReady()).pipe(
            concatMap(ready => {
              if (!ready || battleDisposed) return of(null)
              const firstMessage = (task as MessageAnimationTask).messages?.[0]
              const skill = firstMessage?.type === BattleMessageType.SkillUse ? firstMessage : undefined
              const switchMessage = firstMessage?.type === BattleMessageType.PetSwitch ? firstMessage : undefined
              const petId = skill?.data.user ?? switchMessage?.data.toPet
              const category = skill ? gameDataStore.getSkill(skill.data.baseSkill)?.category : undefined
              const execution = controller.beginAnimation({
                messageType: firstMessage?.type ?? BattleMessageType.TurnAction,
                side: petId ? getTargetSide(petId) : 'left',
                petId,
                skillId: skill?.data.skill,
                sequenceId: firstMessage?.sequenceId ?? store.lastProcessedSequenceId,
                expectedDuration: skill ? (category === Category.Climax ? 20000 : 5000) : 10000,
              })
              if (!execution) return execute()
              runningExecution = execution
              animating.value = true
              execution.signal.addEventListener(
                'abort',
                () => {
                  if (runningExecution !== execution) return
                  cancelSpriteWaits()
                  resetBattleEffects()
                  stopClimaxScreenShake()
                  restorePetContainers()
                  currentActiveSkillId.value = null
                },
                { once: true },
              )
              controller.onAnimationPlaying(execution)
              return from(waitForAnimationOperation(Promise.resolve().then(task), execution.signal, 60000)).pipe(
                catchError(async err => {
                  if (!(err instanceof DOMException && err.name === 'AbortError')) {
                    console.error('动画执行失败:', err)
                    if (controller.isTaskCurrent(execution)) controller.healthMonitor.forceRecovery()
                  }
                  // Connection recovery owns its snapshot. For local animation failures,
                  // finish remaining message deltas without replaying effects before advancing the queue.
                  if (battleDisposed || !controller.stateMachine.canAcceptNewTask) return null
                  const recovery = controller.beginAnimation({
                    messageType: BattleMessageType.TurnAction,
                    side: 'left',
                    sequenceId: store.lastProcessedSequenceId,
                    expectedDuration: 10000,
                  })
                  if (!recovery) return null
                  try {
                    const messages = (task as MessageAnimationTask).messages ?? []
                    await waitForAnimationOperation(
                      (async () => {
                        for (const message of messages) await applyAnimationDelta(message, recovery)
                      })(),
                      recovery.signal,
                      15000,
                    )
                  } catch (error) {
                    if (controller.isTaskCurrent(recovery))
                      controller.stateMachine.markStuck('animation-delta-recovery-failed')
                    console.warn('动画状态同步失败:', error)
                  } finally {
                    controller.onAnimationComplete(recovery)
                    controller.onAnimationCleanupDone(recovery)
                  }
                  return null
                }),
                finalize(() => {
                  if (runningExecution === execution) {
                    restorePetContainers()
                    currentActiveSkillId.value = null
                    runningExecution = null
                    animating.value = false
                  }
                  controller.onAnimationComplete(execution)
                  controller.onAnimationCleanupDone(execution)
                }),
              )
            }),
          )
        return execute()
      }),
    ),
  )
  .subscribe()

const preloadPetSprites = async () => {
  const imageMode = () => gameSettingStore.battleRenderer === 'image'
  if (imageMode()) return
  const pets = [...(currentPlayer.value?.team || []), ...(opponentPlayer.value?.team || [])].filter(
    pet => !pet.isUnknown,
  )
  const assets = pets.map(pet =>
    resolveSpeciesSpriteAsset(gameDataStore.getSpecies(pet.speciesID), resourceStore.getPetSwf),
  )
  const urls = [
    ...new Set(
      assets
        .filter(asset => !asset.customImageUrl)
        .map(asset => asset.customSwfUrl || (asset.swfNum ? petResourceCache.getRemotePetUrl(asset.swfNum) : ''))
        .filter(Boolean),
    ),
  ]
  // Limit requests so optional reserves do not compete with first-scene resources.
  for (let index = 0; index < urls.length; index += 3) {
    if (battleDisposed || imageMode()) return
    await Promise.allSettled(urls.slice(index, index + 3).map(url => petResourceCache.preloadUrl(url)))
  }
}

async function animatePetEntry(
  petSprite: InstanceType<typeof PetSprite> | null,
  initialX: number,
  targetX: number,
  duration: number,
  onCompleteCallback?: () => void,
) {
  if (petSprite && petSprite.$el) {
    gsapSet(petSprite.$el, { x: initialX, opacity: 0 })
    return animatePetTransition(petSprite, targetX, 1, duration, 'power2.out', onCompleteCallback)
  }
  return Promise.resolve()
}

async function initialPetEntryAnimation() {
  const leftPet = petSprites.value.left
  const rightPet = petSprites.value.right
  const battleViewWidth = 1600 // 固定的战斗视图宽度
  const animationDuration = 1
  const entryTimeout = 5
  const animations = []
  for (const [pet, speciesNum, initialX, side] of [
    [leftPet, leftPetSpeciesNum.value, -battleViewWidth / 2 - 100, 'left'],
    [rightPet, rightPetSpeciesNum.value, battleViewWidth / 2 + 100, 'right'],
  ] as const) {
    if (pet && pet.$el && speciesNum !== 0) {
      playPetSound(speciesNum)
      if (pet.availableState.includes(ActionState.PRESENT)) {
        animations.push(
          new Promise<void>(resolve => {
            const handler = (completeSide: 'left' | 'right') => {
              if (completeSide === side) {
                emitter.off('animation-complete', handler)
                resolve()
              }
            }
            emitter.on('animation-complete', handler)
            setTimeout(async () => {
              if (pet && pet.$el && (await pet.getState()) !== ActionState.PRESENT) {
                resolve()
              }
            }, entryTimeout * 1000)
          }),
          pet.setState(ActionState.PRESENT),
        )
      } else {
        animations.push(animatePetEntry(pet, initialX, 0, animationDuration))
      }
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

  // Lazily create AnimationController after DOM is ready
  animationController = new AnimationController(store as never)
  animationController.start()

  // VueUse的useFullscreen会自动处理全屏状态监听，无需手动添加事件监听器

  // 开始加载所有资源
  await initializeBattleResources()
  if (battleDisposed) return

  // 等待加载完成后再进行后续初始化
  await new Promise<void>(resolve => {
    let unwatch: (() => void) | null = null
    releasePreparationWait = resolve
    unwatch = watch(
      isFullyLoaded,
      loaded => {
        if (loaded) {
          unwatch?.()
          resolve()
        }
      },
      { immediate: true },
    )
  })

  if (battleDisposed) return
  // 检查是否是回放模式
  if (props.replayMode) {
    // 回放模式也需要消息订阅来处理动画
    try {
      await setupMessageSubscription()
    } catch (error) {
      console.error('Failed to setup message subscription for replay mode:', error)
    }

    // 等待一小段时间确保订阅完全设置好
    await new Promise(resolve => setTimeout(resolve, 100))

    // 检查加载状态
    try {
      await checkReplayLoadingStatus()
    } catch (error) {
      console.error('Failed to check replay loading status:', error)
    }

    // 在回放模式下，不自动播放第0回合动画，保持初始状态
    // 用户可以手动点击播放按钮来开始回放
    return
  }

  await initialPetEntryAnimation()
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
                const execution = runningExecution
                assertExecution(execution)
                const batch = planAnimationMessages(messages, store.lastProcessedSequenceId)
                if (!batch.pending.length) return
                // A snapshot inside a skill group covers only its prefix.
                if (!batch.animate || animationController?.stateMachine.shouldSkipAnimation) {
                  for (const m of batch.pending) {
                    await applyAnimationDelta(m, execution)
                  }
                } else {
                  await useSkillAnimate(messages)
                }
                assertExecution(execution)
                // 更新 store 的 lastProcessedSequenceId
                const lastMessage = messages[messages.length - 1]
                if (lastMessage.sequenceId !== undefined) {
                  store.lastProcessedSequenceId = Math.max(store.lastProcessedSequenceId, lastMessage.sequenceId)
                }
              }
              return of(Object.assign(task, { messages }))
            }),
          )
        }
        const task = async () => {
          const execution = runningExecution
          assertExecution(execution)
          if (store.isApplied(msg)) return
          try {
            // Skip animation if state machine is catching up or recovering
            const shouldSkip = animationController?.stateMachine.shouldSkipAnimation ?? false

            if (msg.type === BattleMessageType.PetSwitch) {
              if (shouldSkip) {
                // Apply state delta directly without animation
                await applyAnimationDelta(msg, execution)
              } else {
                // 对于 PetSwitch，状态更新由 switchPetAnimate 内部精确控制时机
                await switchPetAnimate(msg.data.toPet, getTargetSide(msg.data.toPet), msg as PetSwitchMessage)
              }
            } else {
              const combatEventTypes: BattleMessageType[] = [
                BattleMessageType.SkillMiss,
                BattleMessageType.Damage,
                BattleMessageType.DamageFail,
                BattleMessageType.Heal,
              ]

              if (combatEventTypes.includes(msg.type as BattleMessageType)) {
                if (!shouldSkip) {
                  await handleCombatEventMessage(msg as CombatEventMessageWithTarget, false)
                } else {
                  await applyAnimationDelta(msg, execution)
                }
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
                  case BattleMessageType.TeamSelectionStart:
                    // 处理团队选择开始消息
                    if (!props.replayMode && msg.data) {
                      teamSelectionConfig.value = msg.data.config
                      teamSelectionTimeLimit.value = msg.data.config.timeLimit
                      teamSelectionPlayerATeam.value = msg.data.playerATeam
                      teamSelectionPlayerBTeam.value = msg.data.playerBTeam
                      showTeamSelectionPanel.value = true
                    }
                    break
                  case BattleMessageType.TeamSelectionComplete:
                    // 处理团队选择完成消息
                    showTeamSelectionPanel.value = false
                    // 清理团队选择数据
                    teamSelectionPlayerATeam.value = null
                    teamSelectionPlayerBTeam.value = null
                    break
                  // PetSwitch 类型的消息已在外部 if 条件中处理
                  default:
                    // 其他消息类型，如果它们不直接触发战斗动画或UI，则仅应用状态
                    break
                }
                await applyAnimationDelta(msg, execution)
              }
            }
          } catch (error) {
            console.error('Error executing message task for:', msg.type, error)
            throw error
          }
        }
        return of(Object.assign(task, { messages: [msg] }))
      }),
    )
    .subscribe(task => animationQueue.next(task))
}

onUnmounted(async () => {
  battleDisposed = true
  cancelSpriteWaits()
  releasePreparationWait?.()
  preparation.cancel()
  releaseBattleStartWait?.()
  // Destroy AnimationController
  if (animationController) {
    animationController.destroy()
    animationController = null
  }

  // 清理播放定时器
  emitter.all.clear()

  stopPlayback()

  // 清理订阅和动画
  messageSubscription?.unsubscribe()
  animatesubscribe.unsubscribe()
  cleanupBattleAnimations()
  emitter.all.clear()

  // 清理 Climax 震动动画
  stopClimaxScreenShake()

  // 清理自适应缩放
  cleanupAdaptiveScaling()

  // VueUse的useFullscreen会自动清理事件监听器，无需手动清理

  // 停止音乐
  stopMusic()

  // 清理掉线计时器
  if (disconnectTimer.value) {
    clearInterval(disconnectTimer.value)
    disconnectTimer.value = null
  }

  // 清理断线事件处理器
  cleanupDisconnectHandlers()

  // 如果是观战模式，主动通知后端离开观战
  if (isSpectatorMode.value && !props.replayMode) {
    try {
      await battleClientStore.leaveSpectateBattle()
    } catch (err) {
      console.warn('⚠️ Failed to leave spectate battle:', err)
    }
  }

  // 清理战斗状态 - 观战者不发送surrender
  if (isSpectatorMode.value || skipSurrenderOnUnmount.value) {
    await store.resetBattleWithoutSurrender()
  } else {
    await store.resetBattle()
  }

  battleClientStore.resetState()
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

// 监听自己的连接状态变化
watch(
  () => battleClientStore.currentState.status,
  async (newStatus, oldStatus) => {
    if (props.replayMode || isSpectatorMode.value) return // 回放模式和观战模式不需要处理掉线

    if (newStatus === 'disconnected' && oldStatus === 'connected') {
      // 从连接状态变为断线状态
      selfDisconnected.value = true
      reconnecting.value = false
      // Notify animation controller of disconnect
      cancelSpriteWaits()
      resetBattleEffects()
      stopClimaxScreenShake()
      animationController?.onDisconnect()
    } else if (newStatus === 'connecting' && oldStatus === 'disconnected') {
      // 开始重连
      reconnecting.value = true
    } else if (newStatus === 'connected' && (oldStatus === 'disconnected' || oldStatus === 'connecting')) {
      // 重连成功
      selfDisconnected.value = false
      reconnecting.value = false
      // Notify animation controller of reconnect
      if (animationController) {
        const restored = await animationController.onReconnect(store as never)
        if (
          !restored ||
          battleDisposed ||
          battleClientStore.currentState.status !== 'connected' ||
          !animationController?.stateMachine.canAcceptNewTask
        )
          return
        store.errorMessage = null
        restorePetContainers()
        const client = battleClientStore._instance
        if (client?.refreshTimerSnapshotsFromServer) {
          await withDeadline(client.refreshTimerSnapshotsFromServer(), 3000).catch(() => {})
        }
      }
    }
  },
  { immediate: true },
)

watch(
  () => battleClientStore.currentState.battle,
  async newBattleState => {
    if (props.replayMode || isSpectatorMode.value) return

    if (newBattleState === 'ended') {
      await exitBattleBecauseServerClosed('state-ended')
    }
  },
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
        const tl = gsapTimeline({
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
        gsapSet(koBannerRef.value, { opacity: 0, scale: 0.8, xPercent: -50, yPercent: -50 })
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
  <div ref="battleContainerRef" class="battle-viewport">
    <div data-testid="battle-actions-ready" :data-ready="battleActionsReady ? 'true' : 'false'" class="sr-only">
      {{ battleActionsReady ? 'ready' : 'pending' }}
    </div>
    <div ref="battleCameraRef" class="battle-camera">
      <div
        class="battle-shell"
        :data-motion="effectiveMotion"
        :style="{ transform: `translate(-50%, -50%) scale(${battleViewScale})` }"
      >
        <Transition name="fade">
          <BattleLoading
            v-if="!isFullyLoaded"
            :left="currentPlayer"
            :right="opponentPlayer"
            :background="background"
            :tasks="loadingTasks"
            :progress="overallProgress"
            :error="loadingError"
            :replay="isReplayMode"
            @retry="retryReplayLoading"
            @exit="isReplayMode ? goBackFromReplay() : navigateToHome()"
          />
        </Transition>

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

        <div class="battle-stage" data-testid="battle-stage">
          <div
            ref="backgroundContainerRef"
            class="battle-stage__backdrop"
            :style="{
              backgroundImage: degradedResources.includes('战斗场景')
                ? 'none'
                : background
                  ? `url(${background})`
                  : 'none',
            }"
          ></div>
          <div class="battle-hud" :style="{ opacity: isFullyLoaded ? 1 : 0 }">
            <BattleStatus v-if="currentPlayer" ref="leftStatusRef" :player="currentPlayer" side="left" />
            <div class="battle-hud__center">
              <BattleFrame />
              <div class="relative">
                <div class="battle-hud__round">{{ i18next.t('turn', { ns: 'battle' }) }} {{ currentTurn || 1 }}</div>
                <div v-if="!isReplayMode && !isSpectatorMode" class="battle-hud__timers">
                  <SimpleBattleTimer type="turn" :player-id="currentPlayer?.id" /><SimpleBattleTimer
                    type="total"
                    :player-id="currentPlayer?.id"
                  />
                </div>
                <div v-if="globalMarks.length" class="battle-hud__marks">
                  <Mark v-for="mark in globalMarks" :key="mark.id" :mark="mark" />
                </div>
              </div>
            </div>
            <BattleStatus v-if="opponentPlayer" ref="rightStatusRef" :player="opponentPlayer" side="right" />
          </div>
          <div v-if="selfDisconnected" class="battle-notice battle-notice--error" role="status">
            {{ reconnecting ? '连接中断，正在重连…' : '连接已断开，请检查网络连接' }}
          </div>
          <div v-else-if="opponentDisconnected" class="battle-notice battle-notice--warning" role="status">
            对手已掉线，等待重连 {{ disconnectGraceTime > 0 ? `· ${disconnectGraceTime} 秒` : '' }}
          </div>
          <div
            v-else-if="isWaitingForOpponent && !isReplayMode && !isSpectatorMode"
            class="battle-notice"
            role="status"
          >
            已提交行动 · 等待对手
          </div>
          <div class="battle-roster battle-roster--left">
            <div class="battle-roster__list">
              <PetButton
                v-for="pet in leftPlayerPets"
                :key="pet.id"
                :pet="pet"
                :disabled="!isPetSelectable(pet.id) || isWaitingForOpponent || isSpectatorMode || isReplayMode"
                :is-active="pet.id === currentPlayer?.activePet"
                position="left"
                @click="handlePetSelect"
              />
            </div>
          </div>
          <div class="battle-roster battle-roster--right">
            <div class="battle-roster__list">
              <PetButton
                v-for="pet in rightPlayerPets"
                :key="pet.id"
                :pet="pet"
                :disabled="true"
                :is-active="pet.id === opponentPlayer?.activePet"
                position="right"
              />
            </div>
          </div>
          <div v-if="isFullyLoaded && degradedResources.length" class="battle-degraded" role="status">
            {{ degradedResources.join('、') }} · 简化显示
          </div>
          <div
            ref="battleViewRef"
            class="battle-scene"
            :style="{
              transformOrigin: 'center center',
              opacity: isFullyLoaded ? 1 : 0,
              transition: 'opacity 0.5s ease-in-out',
            }"
          >
            <!-- Team Selection Panel -->
            <Transition name="fade">
              <div
                v-if="showTeamSelectionPanel && !isSpectatorMode"
                class="absolute inset-0 bg-black/80 flex items-center justify-center"
                :class="Z_INDEX_CLASS.TEAM_SELECTION_PANEL"
              >
                <TeamSelectionPanel
                  v-if="teamSelectionConfig"
                  :fullTeam="currentPlayerTeam"
                  :opponentTeam="teamSelectionOpponentTeam"
                  :config="teamSelectionConfig"
                  :timeLimit="teamSelectionTimeLimit"
                  :initialSelection="currentTeamSelection || undefined"
                  :opponentProgress="opponentSelectionProgress"
                  :opponentSelection="opponentTeamSelection || undefined"
                  @selectionChange="onTeamSelectionChange"
                  @confirm="onTeamSelectionConfirm"
                  @timeout="onTeamSelectionTimeout"
                />
              </div>
            </Transition>

            <img
              v-show="showKoBanner"
              ref="koBannerRef"
              :src="koImage"
              alt="KO Banner"
              class="absolute left-1/2 top-1/2 max-w-[80%] max-h-[80%] object-contain"
              :class="Z_INDEX_CLASS.KO_BANNER"
            />
            <div class="battle-scenery">
              <!-- 精灵容器 - 绝对定位相对于整个battleView，不受其他元素挤压 -->
              <div class="absolute inset-0 pointer-events-none">
                <!-- 左侧精灵 - 绝对定位在画面左侧 -->
                <PetSprite
                  v-if="
                    leftPetSpeciesNum !== 0 || !!leftPetSpriteAsset.customSwfUrl || !!leftPetSpriteAsset.customImageUrl
                  "
                  :key="`left-${resourceAttempt}`"
                  ref="leftPetRef"
                  :num="leftPetSpeciesNum"
                  :image-only="battleRenderer === 'image'"
                  :allow-recovery="!animating"
                  :swf-url="leftPetSpriteAsset.customSwfUrl"
                  :image-url="leftPetSpriteAsset.customImageUrl"
                  class="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none"
                  :class="Z_INDEX_CLASS.PET_SPRITE"
                  @hit="handleAttackHit('left')"
                  @animate-complete="handleAnimationComplete('left')"
                />
                <!-- 右侧精灵 - 绝对定位在画面右侧 -->
                <PetSprite
                  v-if="
                    rightPetSpeciesNum !== 0 ||
                    !!rightPetSpriteAsset.customSwfUrl ||
                    !!rightPetSpriteAsset.customImageUrl
                  "
                  :key="`right-${resourceAttempt}`"
                  ref="rightPetRef"
                  :num="rightPetSpeciesNum"
                  :image-only="battleRenderer === 'image'"
                  :allow-recovery="!animating"
                  :swf-url="rightPetSpriteAsset.customSwfUrl"
                  :image-url="rightPetSpriteAsset.customImageUrl"
                  :reverse="true"
                  class="absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none"
                  :class="Z_INDEX_CLASS.PET_SPRITE"
                  @hit="handleAttackHit('right')"
                  @animate-complete="handleAnimationComplete('right')"
                />

                <!-- Climax特效 - 绝对定位在对应精灵位置 -->
                <div
                  v-show="showClimaxEffect"
                  class="absolute pointer-events-none"
                  :class="Z_INDEX_CLASS.CLIMAX_EFFECT"
                  :style="getClimaxEffectStyle()"
                >
                  <div class="relative w-full h-full">
                    <ClimaxEffectAnimation
                      ref="climaxEffectRef"
                      :auto-play="false"
                      :loop="false"
                      :frame-duration="30"
                      :flip-horizontal="climaxEffectSide === 'right'"
                      :on-complete="handleClimaxEffectComplete"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 回放模式控制界面 -->
        <div v-if="isReplayMode" class="battle-replay-dock flex">
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
                  {{ !isReplayFullyLoaded ? '加载中...' : isPlaying ? (pendingPause ? '暂停中...' : '暂停') : '播放' }}
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

            <label class="battle-motion self-center mb-2">
              <span>精灵表现</span>
              <select v-model="gameSettingStore.battleRenderer" aria-label="精灵表现">
                <option value="swf">SWF 动画</option>
                <option value="image">纯图片战斗</option>
              </select>
            </label>

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

        <BattleCommandDock
          v-if="isFullyLoaded && !isReplayMode"
          :panel="panelState"
          :skills="availableSkills"
          :pets="currentPlayer?.team || []"
          :waiting="isWaitingForOpponent"
          :spectator="isSpectatorMode"
          :training="isTrainingMode"
          :can-wait="!!store.availableActions.find(a => a.type === 'do-nothing')"
          :can-surrender="!!store.availableActions.find(a => a.type === 'surrender')"
          :skill-available="isSkillAvailable"
          :pet-selectable="isPetSelectable"
          :modifier="getSkillModifierInfo"
          :effectiveness="getTypeEffectiveness"
          @panel="panelState = $event === 'skills' ? PanelState.SKILLS : PanelState.PETS"
          @skill="handleSkillClick"
          @pet="handlePetSelect"
          @wait="store.sendplayerSelection(store.availableActions.find(a => a.type === 'do-nothing')!)"
          @surrender="handleEscape"
          @training="isTrainingPanelOpen = !isTrainingPanelOpen"
          @fullscreen="toggleFullscreen"
          @exit="navigateToHome"
        />

        <Transition name="fade">
          <div
            v-if="showBattleEndUI"
            class="fixed inset-0 bg-black/80 flex items-center justify-center"
            :class="Z_INDEX_CLASS.BATTLE_END_UI"
          >
            <div class="battle-result">
              <BattleFrame accent="gold" />
              <div class="battle-loading__eyebrow">对战结束</div>
              <h2>{{ battleResult }}</h2>
              <div class="flex gap-4 mt-8">
                <button
                  class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
                  @click="navigateToLobbyWithMatching"
                >
                  重新匹配
                </button>
                <button
                  class="px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-sky-400 font-bold transition-colors"
                  @click="navigateToHome"
                >
                  返回大厅
                </button>
              </div>
            </div>
          </div>
        </Transition>

        <!-- 训练面板 -->
        <TrainingPanel :is-developer-mode="isTrainingMode" v-model:is-open="isTrainingPanelOpen" />
      </div>
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

/* 加载动画 */
@keyframes spin-reverse {
  from {
    transform: rotate(360deg);
  }
  to {
    transform: rotate(0deg);
  }
}

.animate-spin-reverse {
  animation: spin-reverse 1s linear infinite;
}

/* 空过按钮呼吸光效动画 */
@keyframes do-nothing-breathing {
  0%,
  100% {
    box-shadow: 0 0 8px 2px rgba(245, 158, 11, 0.4);
    border-color: rgba(245, 158, 11, 0.5);
  }
  50% {
    box-shadow: 0 0 16px 4px rgba(245, 158, 11, 0.8);
    border-color: rgba(245, 158, 11, 0.9);
  }
}

/* 可用状态的空过按钮 - 持续呼吸光效 */
.do-nothing-glow-available {
  animation: do-nothing-breathing 2.5s ease-in-out infinite;
  border-color: rgba(245, 158, 11, 0.8) !important;
}

/* hover状态的呼吸动画 - 更快更亮 */
@keyframes do-nothing-breathing-hover {
  0%,
  100% {
    box-shadow: 0 0 12px 3px rgba(245, 158, 11, 0.7);
    border-color: rgba(245, 158, 11, 0.9);
  }
  50% {
    box-shadow: 0 0 20px 5px rgba(245, 158, 11, 1);
    border-color: rgba(245, 158, 11, 1);
  }
}

/* hover状态 - 保持呼吸并增强高亮 */
.group:hover .background.do-nothing-glow-available {
  animation: do-nothing-breathing-hover 1.8s ease-in-out infinite !important;
}
</style>
