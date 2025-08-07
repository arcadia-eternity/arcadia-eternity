<script setup lang="ts">
import BattleLogPanel from '@/components/battle/BattleLogPanel.vue'
import BattleStatus from '@/components/battle/BattleStatus.vue'
import TrainingPanel from '@/components/battle/TrainingPanel.vue'
import TeamSelectionPanel from '@/components/battle/TeamSelectionPanel.vue'
import Mark from '@/components/battle/Mark.vue'
import PetButton from '@/components/battle/PetButton.vue'
import PetSprite from '@/components/battle/PetSprite.vue'
import SkillButton from '@/components/battle/SkillButton.vue'
import ClimaxEffectAnimation from '@/components/ClimaxEffectAnimation.vue'
import SimpleBattleTimer from '@/components/SimpleBattleTimer.vue'
import koImage from '@/assets/images/ko.png'
import { useMusic } from '@/composition/music'
import { useSound } from '@/composition/sound'
import { useBattleAnimations } from '@/composition/useBattleAnimations'
import { useMobile } from '@/composition/useMobile'
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
import { logMessagesKey, markMapKey, petMapKey, playerMapKey, skillMapKey } from '@/symbol/battlelog'
import {
  BattleMessageType,
  BattlePhase,
  Category,
  ELEMENT_CHART,
  type BattleMessage,
  type BattleTeamSelection,
  type TeamSelectionAction,
  type TeamSelectionConfig,
  type TeamInfo,
  type petId,
  type playerId,
  type PetMessage,
  type PetSwitchMessage,
  type skillId,
  type SkillMessage,
  type SkillUseEndMessage,
} from '@arcadia-eternity/const'
import {
  Aim,
  Close,
  DArrowLeft,
  DArrowRight,
  Film,
  FullScreen,
  VideoPause,
  VideoPlay,
  Warning,
} from '@element-plus/icons-vue'
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

// 自适应缩放相关
const battleContainerRef = useTemplateRef('battleContainerRef')
let resizeObserver: ResizeObserver | null = null

// 移动端检测
const { isMobile, isPortrait } = useMobile()

// 屏幕方向控制
const { lockOrientation, unlockOrientation } = useScreenOrientation()

// 全屏相关（将在下面重新定义包装函数）

// 横屏提示相关
const orientationHintDismissed = ref(false)
const showOrientationHint = computed(
  () => isMobile.value && isPortrait.value && !isFullscreen.value && !orientationHintDismissed.value,
)

// 关闭横屏提示
const dismissOrientationHint = () => {
  orientationHintDismissed.value = true
}

// 自定义确认对话框（用于全屏模式）
const showCustomConfirm = ref(false)
const customConfirmTitle = ref('')
const customConfirmMessage = ref('')
const customConfirmResolve = ref<((value: boolean) => void) | null>(null)

// 掉线重连状态
const opponentDisconnected = ref(false)
const disconnectGraceTime = ref(0)
const disconnectTimer = ref<number | null>(null)

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
  toggle: vueUseToggleFullscreen,
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
const enterFullscreen = enterFullscreenWithOrientation
const exitFullscreen = exitFullscreenWithOrientation
const toggleFullscreen = toggleFullscreenWithOrientation

// VueUse的useFullscreen会自动处理全屏状态变化，无需手动监听

// 初始化音乐但不自动播放
const { startMusic, stopMusic } = useMusic(false)

provide(logMessagesKey, store.log)
provide(markMapKey, store.markMap)
provide(skillMapKey, store.skillMap)
provide(petMapKey, store.petMap)
provide(playerMapKey, store.playerMap)
const battleViewRef = useTemplateRef('battleViewRef')
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

// 团队选择相关计算属性
const currentPlayerTeam = computed(() => {
  const player = store.currentPlayer
  return player?.team || []
})

const opponentPlayerTeam = computed(() => {
  const opponent = store.opponent
  return opponent?.team || []
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

// 检查是否处于团队选择阶段
const isTeamSelectionPhase = computed(() => {
  return store.battleState?.currentPhase === BattlePhase.TeamSelectionPhase
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
const doNothingParticlesId = ref(`do-nothing-particles-${Math.random().toString(36).substring(2, 11)}`)
const isDoNothingHovered = ref(false)

// 空过按钮基础粒子配置
const doNothingBaseParticlesOptions = {
  background: {
    color: {
      value: 'transparent',
    },
  },
  fpsLimit: 60,
  fullScreen: {
    enable: false,
  },
  particles: {
    color: {
      value: ['#fbbf24', '#f59e0b', '#d97706', '#92400e'],
    },
    move: {
      direction: 'none',
      enable: true,
      outModes: {
        default: 'out',
        top: 'out',
        bottom: 'out',
        left: 'out',
        right: 'out',
      },
      random: true,
      speed: { min: 0.8, max: 2.0 },
      straight: false,
    },
    number: {
      density: {
        enable: false,
      },
      value: 15,
    },
    opacity: {
      value: { min: 0.5, max: 0.9 },
      animation: {
        enable: true,
        speed: 1.5,
        minimumValue: 0.3,
      },
    },
    shape: {
      type: 'circle',
    },
    size: {
      value: { min: 1.5, max: 3.0 },
      animation: {
        enable: true,
        speed: 2.0,
        minimumValue: 0.8,
      },
    },
  },
  detectRetina: true,
}

// hover状态的粒子配置 - 更多、更亮、更活跃
const doNothingHoverParticlesOptions = {
  ...doNothingBaseParticlesOptions,
  particles: {
    ...doNothingBaseParticlesOptions.particles,
    number: {
      density: { enable: false },
      value: 25,
    },
    opacity: {
      value: { min: 0.8, max: 1.0 },
      animation: {
        enable: true,
        speed: 3.0,
        minimumValue: 0.5,
      },
    },
    size: {
      value: { min: 2.0, max: 4.0 },
      animation: {
        enable: true,
        speed: 3.5,
        minimumValue: 1.0,
      },
    },
    move: {
      ...doNothingBaseParticlesOptions.particles.move,
      speed: { min: 1.5, max: 3.5 },
      random: true,
      outModes: {
        default: 'out',
        top: 'out',
        bottom: 'out',
        left: 'out',
        right: 'out',
      },
    },
    color: {
      value: ['#fbbf24', '#f59e0b', '#d97706', '#eab308', '#facc15'],
    },
  },
}

// 响应式粒子配置
const doNothingParticlesOptions = computed(() => {
  return isDoNothingHovered.value ? doNothingHoverParticlesOptions : doNothingBaseParticlesOptions
})

const doNothingParticlesLoaded = async () => {
  // 粒子系统加载完成
}

// 战斗数据计算属性
const currentPlayer = computed(() => store.currentPlayer)
const opponentPlayer = computed(() => store.opponent)
const globalMarks = computed(() => store.battleState?.marks ?? [])
const currentTurn = computed(() => store.battleState?.currentTurn ?? 0)

// 当前正在使用的技能ID跟踪（用于连击伤害累计）
const currentActiveSkillId = ref<string | null>(null)

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

const {
  showMissMessage,
  showAbsorbMessage,
  showDamageMessage,
  showHealMessage,
  showUseSkillMessage,
  moveBackgroundFocus,
  updateBackgroundAspectRatio,
  cleanup: cleanupBattleAnimations,
} = useBattleAnimations(
  battleViewRef as Ref<HTMLElement | null>,
  store,
  currentPlayer,
  opponentPlayer,
  battleViewScale,
  backgroundContainerRef as Ref<HTMLElement | null>,
)

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

// 缓存技能的原始顺序，避免在技能变身时位置发生变化
const skillOrderCache = ref<
  Map<string, Map<string, { id: string; baseId: any; originalCategory: any; index: number }>>
>(new Map())

// 全局技能原始状态缓存，用于记录技能的初始状态
const globalSkillOriginalState = ref<Map<string, { baseId: any; originalCategory: any }>>(new Map())

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
    const orderMap = new Map<string, { id: string; baseId: any; originalCategory: any; index: number }>()

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
  if (isWaitingForOpponent.value) return
  const action = store.availableActions.find(a => a.type === 'use-skill' && a.skill === skillId)
  if (action) store.sendplayerSelection(action)
  panelState.value = PanelState.SKILLS
}

const handlePetSelect = (petId: string) => {
  if (isWaitingForOpponent.value) return

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
  if (isWaitingForOpponent.value) return
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
  console.log('team selection confirm:', selection)
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
    console.log('🔄 Disconnect handlers already registered, skipping')
    return
  }

  // 监听对手掉线事件
  opponentDisconnectedHandler = (data: { disconnectedPlayerId: string; graceTimeRemaining: number }) => {
    console.log('对手掉线:', data)
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
  opponentReconnectedHandler = (data: { reconnectedPlayerId: string }) => {
    console.log('对手重连:', data)
    opponentDisconnected.value = false

    if (disconnectTimer.value) {
      clearInterval(disconnectTimer.value)
      disconnectTimer.value = null
    }
  }

  battleClientStore.on('opponentDisconnected', opponentDisconnectedHandler)
  battleClientStore.on('opponentReconnected', opponentReconnectedHandler)
  console.log('🔄 Disconnect handlers registered')
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
  console.log('🔄 Disconnect handlers cleaned up')
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

// 加载进度管理
interface LoadingProgress {
  resourceStore: boolean
  gameDataStore: boolean
  backgroundImage: boolean
  petSprites: boolean
  battleData: boolean
}

const loadingProgress = ref<LoadingProgress>({
  resourceStore: false,
  gameDataStore: false,
  backgroundImage: false,
  petSprites: false,
  battleData: false,
})

const loadingStatus = ref<string>('初始化中...')
const isFullyLoaded = ref(false)
const loadingError = ref<string | null>(null)

// 计算总体加载进度
const overallProgress = computed(() => {
  const progress = loadingProgress.value
  const completed = Object.values(progress).filter(Boolean).length
  const total = Object.keys(progress).length
  return Math.round((completed / total) * 100)
})

// 检查所有资源是否加载完成
const checkAllResourcesLoaded = () => {
  const progress = loadingProgress.value
  const allLoaded = Object.values(progress).every(Boolean)

  if (allLoaded && !isFullyLoaded.value) {
    isFullyLoaded.value = true
    loadingStatus.value = '加载完成！'
    console.debug('All battle resources loaded successfully')
  }

  return allLoaded
}

// 检查资源存储是否加载完成
const checkResourceStoreLoaded = async () => {
  try {
    loadingStatus.value = '加载游戏资源...'
    await resourceStore.initialize()
    loadingProgress.value.resourceStore = true
    console.debug('Resource store loaded')
  } catch (error) {
    console.error('Failed to load resource store:', error)
    loadingProgress.value.resourceStore = true // 即使失败也继续
  }
}

// 检查游戏数据是否加载完成
const checkGameDataStoreLoaded = async () => {
  try {
    loadingStatus.value = '加载游戏数据...'
    await gameDataStore.initialize()
    loadingProgress.value.gameDataStore = true
    console.debug('Game data store loaded')
  } catch (error) {
    console.error('Failed to load game data store:', error)
    loadingProgress.value.gameDataStore = true // 即使失败也继续
  }
}

// 检查背景图片是否加载完成并预设置到DOM
const checkBackgroundImageLoaded = async () => {
  try {
    loadingStatus.value = '加载背景图片...'
    const bgUrl = background.value

    if (bgUrl) {
      // 预加载背景图片
      await new Promise<void>(resolve => {
        const img = new Image()
        img.onload = () => {
          console.debug('Background image preloaded successfully')

          // 获取图片的实际尺寸并更新宽高比
          const imageWidth = img.naturalWidth
          const imageHeight = img.naturalHeight
          console.debug(`Background image dimensions: ${imageWidth}x${imageHeight}`)

          // 更新动画系统中的背景宽高比
          updateBackgroundAspectRatio(imageWidth, imageHeight)

          // 直接使用模板引用设置背景
          const setBgToDOM = () => {
            if (backgroundContainerRef.value) {
              const container = backgroundContainerRef.value as HTMLElement
              container.style.backgroundImage = `url(${bgUrl})`
              container.style.backgroundSize = 'auto 100%'
              container.style.backgroundPosition = 'center'
              container.style.backgroundRepeat = 'no-repeat'
              console.debug('Background image applied to DOM via template ref')
            }
          }

          // 如果DOM已经准备好，立即设置；否则稍后设置
          if (backgroundContainerRef.value) {
            setBgToDOM()
          } else {
            // 延迟设置，给DOM一些时间渲染
            setTimeout(setBgToDOM, 100)
          }

          resolve()
        }
        img.onerror = () => {
          console.warn('Background image failed to preload, but continuing...')
          resolve() // 即使失败也继续
        }
        img.src = bgUrl

        // 设置超时，避免永远等待
        setTimeout(() => {
          console.warn('Background image loading timeout, continuing...')
          resolve()
        }, 5000)
      })
    } else {
      console.debug('No background image to load')
    }

    loadingProgress.value.backgroundImage = true
    console.debug('Background image check completed')
  } catch (error) {
    console.error('Failed to load background image:', error)
    loadingProgress.value.backgroundImage = true // 即使失败也继续
  }
}

// 检查精灵是否加载完成
const checkPetSpritesLoaded = async () => {
  try {
    loadingStatus.value = '加载精灵资源...'

    // 预加载精灵资源
    await preloadPetSprites()

    // 等待PetSprite组件准备完成
    if (isReplayMode.value) {
      // 回放模式需要等待petSprite的ready promise
      const spritesReady = await checkPetSpritesReady()
      if (!spritesReady) {
        console.warn('Pet sprites not ready, but continuing...')
      }
    } else {
      // 正常模式也需要等待PetSprite组件的ready状态
      loadingStatus.value = '等待精灵组件初始化...'

      // 等待组件被创建并获取ready promise
      let retryCount = 0
      const maxRetries = 50 // 增加重试次数，给组件更多时间初始化

      while (retryCount < maxRetries) {
        const leftReadyPromise = leftPetRef.value?.ready
        const rightReadyPromise = rightPetRef.value?.ready

        if (leftReadyPromise && rightReadyPromise) {
          // 两个组件都已创建，等待它们的ready状态
          const promisesToWaitFor: Promise<void>[] = [
            leftReadyPromise.catch(() => {}),
            rightReadyPromise.catch(() => {}),
          ]

          await Promise.all(promisesToWaitFor)
          console.debug('Pet sprites ready in normal mode')
          break
        }

        // 如果组件还没有创建，等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 100))
        retryCount++
      }

      if (retryCount >= maxRetries) {
        console.warn('Pet sprites not ready after maximum retries, but continuing...')
      }
    }

    loadingProgress.value.petSprites = true
    console.debug('Pet sprites loaded')
  } catch (error) {
    console.error('Failed to load pet sprites:', error)
    loadingProgress.value.petSprites = true // 即使失败也继续
  }
}

// 检查战斗数据是否加载完成
const checkBattleDataLoaded = async () => {
  try {
    loadingStatus.value = '初始化战斗数据...'

    if (isReplayMode.value) {
      // 回放模式等待回放数据加载
      console.debug('Waiting for replay data to load...')
      if (!isReplayDataLoaded.value) {
        await new Promise<void>(resolve => {
          let unwatch: (() => void) | undefined
          let timeoutId: ReturnType<typeof setTimeout> | undefined

          // 设置超时机制，避免无限等待
          timeoutId = setTimeout(() => {
            console.warn('Replay data loading timeout, continuing anyway...')
            unwatch?.()
            resolve()
          }, 10000) // 10秒超时

          unwatch = watch(
            isReplayDataLoaded,
            loaded => {
              if (loaded) {
                console.debug('Replay data loaded successfully')
                if (timeoutId) clearTimeout(timeoutId)
                unwatch?.()
                resolve()
              }
            },
            { immediate: true },
          )
        })
      } else {
        console.debug('Replay data already loaded')
      }
    }
    // 注意：正常模式下不在这里调用store.ready()，而是在消息订阅设置完成后调用

    loadingProgress.value.battleData = true
    console.debug('Battle data loaded')
  } catch (error) {
    console.error('Failed to load battle data:', error)
    loadingProgress.value.battleData = true // 即使失败也继续
  }
}

// 主要的加载初始化函数
const initializeBattleResources = async () => {
  try {
    console.debug('Starting battle resources initialization...')

    // 并行加载基础资源
    await Promise.all([checkResourceStoreLoaded(), checkGameDataStoreLoaded()])

    // 加载背景图片（依赖于resourceStore）
    await checkBackgroundImageLoaded()

    // 加载战斗数据
    await checkBattleDataLoaded()

    // 最后加载精灵（依赖于战斗数据）
    await checkPetSpritesLoaded()

    // 检查是否全部加载完成
    checkAllResourcesLoaded()

    // 所有资源加载完成后启动音乐
    startMusic()
    console.debug('Battle resources initialization completed')
  } catch (error) {
    console.error('Error during battle resources initialization:', error)
    // 即使出错也要标记为完成，避免永远卡在加载界面
    isFullyLoaded.value = true
    loadingStatus.value = '加载完成（部分资源可能未加载）'
  }
}

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
    console.debug('Checking replay loading status...')

    // 等待数据加载完成
    if (!isReplayDataLoaded.value) {
      console.debug('Replay data not loaded yet')
      isReplayFullyLoaded.value = false
      return
    }

    // 等待petSprite准备完成
    console.debug('Checking pet sprites readiness...')
    const spritesReady = await checkPetSpritesReady()
    if (!spritesReady) {
      console.debug('Pet sprites not ready yet')
      isReplayFullyLoaded.value = false
      return
    }

    // 等待store初始化完成
    console.debug('Checking replay snapshots...', store.replaySnapshots.length)
    if (store.replaySnapshots.length === 0) {
      console.debug('Replay snapshots not generated yet')
      isReplayFullyLoaded.value = false
      return
    }

    isReplayFullyLoaded.value = true
    console.debug('Replay fully loaded!', {
      dataLoaded: isReplayDataLoaded.value,
      spritesReady,
      snapshotsCount: store.replaySnapshots.length,
      currentSnapshot: store.currentSnapshotIndex,
      totalSnapshots: store.totalSnapshots,
    })

    // 清除加载错误状态
    if (loadingError.value) {
      loadingError.value = null
      loadingStatus.value = '回放加载完成'
    }
  } catch (error) {
    console.error('Error checking replay loading status:', error)
    isReplayFullyLoaded.value = false
  }
}

const retryReplayLoading = async () => {
  console.debug('Retrying replay loading...')
  loadingError.value = null
  loadingStatus.value = '重新加载中...'
  isFullyLoaded.value = false

  // 重置加载进度
  Object.keys(loadingProgress.value).forEach(key => {
    loadingProgress.value[key as keyof LoadingProgress] = false
  })

  // 重新开始加载流程
  try {
    await initializeBattleResources()
  } catch (error) {
    console.error('Retry failed:', error)
    loadingError.value = `重试失败: ${error instanceof Error ? error.message : String(error)}`
    loadingStatus.value = '重试失败'
  }
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

  // 设置当前活跃技能ID用于连击伤害跟踪
  currentActiveSkillId.value = useSkill.data.skill

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

  // 如果是climax技能，触发特效并等待播放完成
  if (category === Category.Climax) {
    // 显示climax特效
    climaxEffectSide.value = side
    showClimaxEffect.value = true

    // 创建黑屏遮罩和启动全屏震动效果
    createClimaxBlackScreen()
    startClimaxScreenShake()

    // 播放特效动画并等待完成
    if (climaxEffectRef.value) {
      await new Promise<void>(resolve => {
        // 创建一个临时的完成处理器
        const handleClimaxComplete = () => {
          // 移除事件监听器
          emitter.off('climax-effect-complete', handleClimaxComplete)
          resolve()
        }

        // 监听特效完成事件
        emitter.on('climax-effect-complete', handleClimaxComplete)

        // 播放特效
        climaxEffectRef.value!.play()
      })
    }
    playSkillSound(baseSkillId)
  }
  source.setState(state)

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

  // 清除当前活跃技能ID
  currentActiveSkillId.value = null
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
            currentActiveSkillId.value || undefined,
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
  if (!battleViewRef.value) return

  // 捕获当前的缩放值，避免在动画过程中发生变化
  const currentScale = battleViewScale.value

  // 创建强烈的震动效果，参考 useBattleAnimations.ts 的实现
  const shakeIntensity = 20 + Math.random() * 30 // 强震动强度 (20-50px)
  const shakeAngle = Math.random() * Math.PI * 2
  const shakeX = Math.cos(shakeAngle) * shakeIntensity
  const shakeY = Math.sin(shakeAngle) * shakeIntensity

  const shakeAnimation = gsap.to(battleViewRef.value, {
    x: shakeX,
    y: shakeY,
    scale: currentScale, // 保持当前的缩放比例
    duration: 0.05,
    repeat: -1, // 无限重复直到手动停止
    yoyo: true,
    ease: 'power1.inOut',
  })

  // 存储动画引用以便后续停止
  ;(battleViewRef.value as any)._climaxShakeAnimation = shakeAnimation
}

const stopClimaxScreenShake = () => {
  if (!battleViewRef.value) return

  // 停止震动动画
  const shakeAnimation = (battleViewRef.value as any)._climaxShakeAnimation
  if (shakeAnimation) {
    shakeAnimation.kill()
    delete (battleViewRef.value as any)._climaxShakeAnimation
  }

  // 恢复到正确的状态
  gsap.set(battleViewRef.value, {
    x: 0,
    y: 0,
    scale: battleViewScale.value,
  })

  // 移除黑屏遮罩
  removeClimaxBlackScreen()
}

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

const preloadPetSprites = async () => {
  const spriteNums = allTeamMemberSpritesNum.value
  if (!spriteNums || !Array.isArray(spriteNums)) {
    console.debug('Skipping sprite preload: sprite numbers not available yet')
    return
  }

  // 使用 petResourceCache 来预加载，避免重复加载
  const uniqueNums = [...new Set(spriteNums.filter(num => num && num > 0))]
  console.debug('Preloading pet sprites:', uniqueNums)

  // 使用 petResourceCache 的预加载方法，它会检查是否已经缓存
  await Promise.allSettled(uniqueNums.map(num => petResourceCache.preloadPetSwf(num)))
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

  // VueUse的useFullscreen会自动处理全屏状态监听，无需手动添加事件监听器

  // 开始加载所有资源
  await initializeBattleResources()

  // 等待加载完成后再进行后续初始化
  await new Promise<void>(resolve => {
    let unwatch: (() => void) | undefined
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

  // 检查是否是回放模式
  if (props.replayMode) {
    let battleRecord = null
    let loadError = null

    try {
      if (props.localReportId) {
        // 本地战报回放模式
        console.debug('Loading local battle report:', props.localReportId)
        const localReport = battleReportStore.loadLocalBattleReport(props.localReportId)
        if (localReport) {
          battleRecord = localReport.battleRecord
          console.debug('Local battle record loaded successfully')
        } else {
          loadError = `本地战报未找到: ${props.localReportId}`
          console.error(loadError)
        }
      } else {
        // 在线战报回放模式
        const battleId = props.battleRecordId || (route.params.id as string)
        if (battleId) {
          console.debug('Fetching online battle record:', battleId)
          await battleReportStore.fetchBattleRecord(battleId)
          battleRecord = battleReportStore.currentBattleRecord

          if (battleRecord) {
            console.debug('Online battle record loaded successfully')
          } else {
            loadError = `在线战报加载失败: ${battleId}`
            console.error(loadError)
          }
        } else {
          loadError = '缺少战报ID参数'
          console.error(loadError)
        }
      }
    } catch (error) {
      loadError = `战报加载异常: ${error instanceof Error ? error.message : String(error)}`
      console.error('Battle record loading error:', error)
    }

    // 如果加载失败，显示错误信息但仍然继续初始化流程
    if (loadError) {
      console.warn('Battle record loading failed, but continuing with replay mode setup:', loadError)
      loadingError.value = loadError
      loadingStatus.value = `加载失败: ${loadError}`
    }

    if (battleRecord) {
      console.debug('Initializing replay mode with battle record')
      try {
        store.initReplayMode(
          battleRecord.battle_messages,
          battleRecord.final_state as any,
          battleRecord.player_a_id, // 默认从玩家A视角观看
        )
        console.debug('Replay mode initialized successfully')
      } catch (error) {
        console.error('Failed to initialize replay mode:', error)
        loadingError.value = `回放初始化失败: ${error instanceof Error ? error.message : String(error)}`
        loadingStatus.value = '回放初始化失败，但继续运行'
      }
    } else {
      console.warn('No battle record available for replay mode')
      // 即使没有战报数据，也要初始化一个空的回放模式，确保UI能正常显示
      try {
        store.initReplayMode([], {} as any, '')
        console.debug('Empty replay mode initialized as fallback')
      } catch (error) {
        console.error('Failed to initialize empty replay mode:', error)
        loadingError.value = `回放模式初始化失败: ${error instanceof Error ? error.message : String(error)}`
      }
    }

    // 回放模式也需要消息订阅来处理动画
    try {
      await setupMessageSubscription()
      console.debug('Message subscription setup completed for replay mode')
    } catch (error) {
      console.error('Failed to setup message subscription for replay mode:', error)
    }

    // 等待一小段时间确保订阅完全设置好
    await new Promise(resolve => setTimeout(resolve, 100))

    // 检查加载状态
    try {
      await checkReplayLoadingStatus()
      console.debug('Replay loading status check completed')
    } catch (error) {
      console.error('Failed to check replay loading status:', error)
    }

    // 在回放模式下，不自动播放第0回合动画，保持初始状态
    // 用户可以手动点击播放按钮来开始回放
    console.debug('Replay mode setup completed')
    return
  }

  // 正常战斗模式
  await setupMessageSubscription()

  // 设置掉线重连事件监听（在 ready 之前设置，确保能接收到重连状态）
  setupDisconnectHandlers()

  const isPlayer = store.battleState?.players.some(p => p.id === store.playerId)
  if (isPlayer) {
    await store.ready()
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
          try {
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

              // 检查是否已经处理过这个消息（在 applyStateDelta 之后检查）
              // 注意：applyStateDelta 会更新 lastProcessedSequenceId，所以我们需要检查是否应该跳过 UI 处理
              const wasAlreadyProcessed = msg.sequenceId !== undefined && msg.sequenceId < store.lastProcessedSequenceId
              if (wasAlreadyProcessed) {
                return
              }

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
                    // 其他消息类型，如果它们不直接触发战斗动画或UI，则仅应用状态（已在上方完成）
                    break
                }
              }
            }
          } catch (error) {
            console.error('Error executing message task for:', msg.type, error)
            throw error
          }
        }
        return of(task)
      }),
    )
    .subscribe(task => animationQueue.next(task))
}

onUnmounted(() => {
  // 清理播放定时器
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
    >
      <!-- 加载遮罩 -->
      <Transition name="fade">
        <div
          v-if="!isFullyLoaded"
          class="absolute inset-0 bg-gradient-to-br from-[#1a1a2e] via-[#2a2a4a] to-[#1a1a2e] flex items-center justify-center"
          :class="Z_INDEX_CLASS.LOADING_OVERLAY"
        >
          <div class="text-center">
            <!-- 加载动画 -->
            <div class="mb-8">
              <div class="relative w-32 h-32 mx-auto">
                <!-- 外圈旋转动画 -->
                <div
                  class="absolute inset-0 border-4 border-blue-500/30 rounded-full animate-spin border-t-blue-500"
                ></div>
                <!-- 内圈反向旋转动画 -->
                <div
                  class="absolute inset-4 border-4 border-purple-500/30 rounded-full animate-spin-reverse border-b-purple-500"
                ></div>
                <!-- 中心图标 -->
                <div class="absolute inset-0 flex items-center justify-center">
                  <div class="text-4xl">⚔️</div>
                </div>
              </div>
            </div>

            <!-- 加载进度 -->
            <div class="mb-6">
              <div class="text-2xl font-bold text-white mb-2">{{ overallProgress }}%</div>
              <div class="w-80 h-2 bg-gray-700 rounded-full overflow-hidden mx-auto">
                <div
                  class="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
                  :style="{ width: `${overallProgress}%` }"
                ></div>
              </div>
            </div>

            <!-- 加载状态文本 -->
            <div class="text-gray-300 text-lg">{{ loadingStatus }}</div>

            <!-- 错误信息显示 -->
            <div v-if="loadingError" class="mt-4 p-4 bg-red-900/50 border border-red-500/50 rounded-lg">
              <div class="text-red-400 text-sm font-bold mb-2">⚠️ 加载错误</div>
              <div class="text-red-300 text-sm">{{ loadingError }}</div>
              <div class="text-red-200 text-xs mt-2">回放模式将以有限功能继续运行</div>
              <button
                @click="retryReplayLoading"
                class="mt-3 px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-white text-sm font-bold transition-colors"
              >
                重试加载
              </button>
            </div>

            <!-- 加载提示 -->
            <div v-if="!loadingError" class="mt-4 text-gray-400 text-sm">正在加载...</div>
          </div>
        </div>
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

      <!-- 移动端横屏提示 -->
      <div
        v-if="showOrientationHint"
        class="absolute inset-0 bg-black/60 flex items-center justify-center"
        :class="Z_INDEX_CLASS.MOBILE_ORIENTATION_HINT"
        @click="dismissOrientationHint"
      >
        <div class="bg-white/90 backdrop-blur-sm rounded-lg p-6 mx-4 text-center max-w-sm relative" @click.stop>
          <!-- 关闭按钮 -->
          <button
            @click="dismissOrientationHint"
            class="absolute top-2 right-2 w-8 h-8 bg-gray-200 hover:bg-gray-300 rounded-full flex items-center justify-center text-gray-600 transition-colors duration-200"
            title="关闭提示"
          >
            <el-icon :size="16">
              <Close />
            </el-icon>
          </button>

          <div class="text-2xl mb-4">📱 ➡️ 📱</div>
          <h3 class="text-lg font-bold text-gray-800 mb-2">建议横屏游戏</h3>
          <p class="text-gray-600 text-sm mb-4">为了获得最佳游戏体验，建议将设备旋转至横屏模式</p>
          <p class="text-gray-500 text-xs mb-4">或点击右上角的全屏按钮进入全屏模式</p>

          <!-- 操作按钮 -->
          <div class="flex gap-2 justify-center">
            <button
              @click="toggleFullscreen"
              class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors duration-200"
            >
              进入全屏
            </button>
            <button
              @click="dismissOrientationHint"
              class="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors duration-200"
            >
              继续游戏
            </button>
          </div>
        </div>
      </div>

      <!-- 移动端全屏按钮 -->
      <button
        v-if="isMobile"
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
          transform: `scale(${battleViewScale}) translateZ(0)`,
          transformOrigin: 'center center',
          opacity: isFullyLoaded ? 1 : 0,
          transition: 'opacity 0.5s ease-in-out',
        }"
      >
        <!-- Team Selection Panel -->
        <Transition name="fade">
          <div
            v-if="showTeamSelectionPanel"
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
        <div
          ref="backgroundContainerRef"
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

            <!-- 等待对手提示 -->
            <Transition name="fade">
              <div
                v-if="isWaitingForOpponent && !isReplayMode"
                class="flex items-center justify-center gap-2 text-blue-300 text-lg font-medium"
              >
                <!-- 简单的旋转加载图标 -->
                <div class="w-4 h-4 border-2 border-blue-300/30 border-t-blue-300 rounded-full animate-spin"></div>
                <span>
                  {{
                    i18next.t('waiting-for-opponent-message', {
                      ns: 'battle',
                      defaultValue: '等待对手操作中...',
                    })
                  }}
                </span>
              </div>
            </Transition>

            <!-- 对手掉线提示 -->
            <Transition name="fade">
              <div
                v-if="opponentDisconnected && !isReplayMode"
                class="flex items-center justify-center gap-2 text-orange-300 text-lg font-medium bg-orange-900/30 px-4 py-2 rounded-lg border border-orange-500/50"
              >
                <!-- 警告图标 -->
                <div class="w-5 h-5 text-orange-400">⚠️</div>
                <span>
                  对手已掉线，等待重连中...
                  <span v-if="disconnectGraceTime > 0" class="text-orange-200"> ({{ disconnectGraceTime }}秒) </span>
                </span>
              </div>
            </Transition>
          </div>

          <!-- 精灵容器 - 绝对定位相对于整个battleView，不受其他元素挤压 -->
          <div class="absolute inset-0 pointer-events-none">
            <!-- 左侧精灵侧栏 - 绝对定位 -->
            <div
              class="absolute left-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-auto"
              :class="Z_INDEX_CLASS.PET_BUTTON_CONTAINER"
            >
              <PetButton
                v-for="pet in leftPlayerPets"
                :key="pet.id"
                :pet="pet"
                :disabled="!isPetSelectable(pet.id) || isWaitingForOpponent"
                :is-active="pet.id === currentPlayer?.activePet"
                position="left"
                @click="handlePetSelect"
              />
            </div>

            <!-- 右侧精灵侧栏 - 绝对定位 -->
            <div
              class="absolute right-1 top-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-auto"
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

          <!-- 占位元素 - 保持原有的flex布局空间分配 -->
          <div class="flex-grow"></div>

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

          <!-- 显示日志按钮（浮动在左下角） -->
          <div v-if="!isReplayMode && !battleViewStore.showLogPanel" class="absolute bottom-4 left-4 z-50">
            <button
              class="group relative w-8 h-8 cursor-pointer bg-black/70 rounded-r-lg border border-gray-400/50 hover:border-green-400/70 hover:bg-black/90 transition-all duration-200"
              @click="battleViewStore.toggleLogPanel()"
              title="显示日志面板"
            >
              <div class="flex items-center justify-center h-full">
                <!-- 向右箭头 -->
                <div
                  class="text-sm font-bold text-gray-400 group-hover:text-green-400 transform group-hover:translate-x-0.5 transition-transform duration-200"
                >
                  ▶
                </div>
              </div>
            </button>
          </div>

          <!-- 控制面板（移动端和桌面端完全一样） -->
          <div v-if="!isReplayMode" class="flex h-1/5 flex-none overflow-visible">
            <div v-if="battleViewStore.showLogPanel" class="w-1/5 h-full p-2 max-h-full overflow-hidden">
              <BattleLogPanel />
            </div>

            <div class="h-full max-h-full overflow-visible" :class="battleViewStore.showLogPanel ? 'flex-1' : 'w-full'">
              <div
                class="h-full max-h-full grid grid-cols-5 gap-4 p-2 overflow-visible"
                v-show="panelState === PanelState.SKILLS"
              >
                <template v-for="skill in availableSkills" :key="skill._stableId">
                  <SkillButton
                    :skill="skill"
                    @click="handleSkillClick(skill.id)"
                    :disabled="!isSkillAvailable(skill.id) || isWaitingForOpponent"
                    :power-modifier-info="getSkillModifierInfo(skill, 'power')"
                    :accuracy-modifier-info="getSkillModifierInfo(skill, 'accuracy')"
                    :rage-modifier-info="getSkillModifierInfo(skill, 'rage')"
                    :type-effectiveness="getTypeEffectiveness(skill)"
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
                  :disabled="!isPetSelectable(pet.id) || isWaitingForOpponent"
                  @click="handlePetSelect"
                  position="bottom"
                />
              </div>
            </div>

            <div class="flex flex-col gap-2 p-2 w-1/5 flex-none h-full">
              <!-- 训练面板按钮 -->
              <button
                v-if="isTrainingMode"
                class="group relative h-10 p-2 cursor-pointer overflow-visible flex-none"
                @click="isTrainingPanelOpen = !isTrainingPanelOpen"
              >
                <div
                  class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border border-green-400/50 group-hover:shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]"
                  :class="
                    isTrainingPanelOpen
                      ? 'border-green-400/50 group-hover:shadow-[0_0_8px_2px_rgba(34,197,94,0.6)]'
                      : 'border-green-400/50'
                  "
                >
                  <div class="bg-gray-900 w-full h-2"></div>
                  <div class="absolute bottom-1 right-1">
                    <div class="flex">
                      <div class="w-2 h-0.5 mt-1" :class="isTrainingPanelOpen ? 'bg-green-400' : 'bg-green-400'"></div>
                      <div class="w-0.5 h-2" :class="isTrainingPanelOpen ? 'bg-green-400' : 'bg-green-400'"></div>
                    </div>
                  </div>
                </div>
                <div class="relative flex items-center justify-center h-full pointer-events-none">
                  <div
                    class="text-xs font-bold [text-shadow:_1px_1px_0_black]"
                    :class="isTrainingPanelOpen ? 'text-green-400' : 'text-green-400'"
                  >
                    🎯 训练
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
                  @mouseenter="isDoNothingHovered = true"
                  @mouseleave="isDoNothingHovered = false"
                >
                  <!-- 粒子效果容器 - 围绕光效区域 -->
                  <div
                    v-if="store.availableActions.find(a => a.type === 'do-nothing')"
                    class="absolute pointer-events-none overflow-visible"
                    style="top: -8px; left: -8px; right: -8px; bottom: -8px"
                  >
                    <vue-particles
                      :id="doNothingParticlesId"
                      :options="doNothingParticlesOptions"
                      @particles-loaded="doNothingParticlesLoaded"
                      class="w-full h-full"
                    />
                  </div>

                  <div
                    class="background bg-black w-full h-full absolute top-0 left-0 -skew-x-6 transition-all duration-300 border group-disabled:border-gray-500/50 group-disabled:hover:shadow-none"
                    :class="
                      store.availableActions.find(a => a.type === 'do-nothing')
                        ? 'border-sky-400/50 do-nothing-glow-available'
                        : 'border-gray-500/50'
                    "
                  >
                    <div class="bg-gray-900 w-full h-3"></div>
                    <div class="absolute bottom-1 right-1">
                      <div class="flex">
                        <div
                          class="w-3 h-0.5 mt-3"
                          :class="
                            store.availableActions.find(a => a.type === 'do-nothing') ? 'bg-yellow-400' : 'bg-gray-500'
                          "
                        ></div>
                        <div
                          class="w-0.5 h-3.5"
                          :class="
                            store.availableActions.find(a => a.type === 'do-nothing') ? 'bg-yellow-400' : 'bg-gray-500'
                          "
                        ></div>
                      </div>
                    </div>
                  </div>
                  <div class="relative flex items-center justify-center h-full pointer-events-none">
                    <div
                      class="text-sm font-bold [text-shadow:_1px_1px_0_black] transition-colors duration-300"
                      :class="
                        store.availableActions.find(a => a.type === 'do-nothing')
                          ? 'text-yellow-400 group-hover:text-yellow-300'
                          : 'text-gray-400'
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
