import { useBattleStore } from '@/stores/battle'
import { type petId } from '@arcadia-eternity/const'
import gsap from 'gsap'
import i18next from 'i18next'
import { h, render, type Ref, type ComputedRef, ref } from 'vue'
import { Subject, concatMap, delay, tap, timestamp, scan, of } from 'rxjs'
import { useElementBounding } from '@vueuse/core'
import DamageDisplay from '@/components/battle/DamageDisplay.vue'
import HealDisplay from '@/components/battle/HealDisplay.vue'
// import type { Player } from '@arcadia-eternity/battle' // Assuming Player type is exported from battle package - replaced with MinimalPlayerForAnimations

interface MinimalPlayerForAnimations {
  activePet?: petId
  // id: string // Add other properties if needed from the player object itself
}

export function useBattleAnimations(
  battleViewRef: Ref<HTMLElement | null>,
  store: ReturnType<typeof useBattleStore>,
  currentPlayer: ComputedRef<MinimalPlayerForAnimations | null | undefined>,
  opponentPlayer: ComputedRef<MinimalPlayerForAnimations | null | undefined>,
  battleViewScale: ComputedRef<number>,
  backgroundContainerRef?: Ref<HTMLElement | null>,
) {
  // 使用 VueUse 的 useElementBounding 来获取容器尺寸
  const { width: containerWidth, height: containerHeight } = useElementBounding(backgroundContainerRef)

  // 背景图片的动态宽高比，默认值为 1200x660
  const backgroundAspectRatio = ref(1200 / 660) // ≈ 1.818

  // 提供方法来更新背景图片宽高比（从外部调用）
  const updateBackgroundAspectRatio = (width: number, height: number) => {
    if (width > 0 && height > 0) {
      backgroundAspectRatio.value = width / height
      console.debug(`Background aspect ratio updated to: ${backgroundAspectRatio.value} (${width}x${height})`)
    }
  }
  // 战斗视图固定坐标系统 (1600x900)
  // 基于battlePage.vue中的实际布局结构计算固定位置
  const getBattleViewPosition = (side: 'left' | 'right', offsetY: number = 120) => {
    // 分析布局:
    // - 外层容器: flex justify-between p-5 (左右各20px padding)
    // - 左侧状态栏: w-1/3 (533px), left-5 (20px from left)
    // - 右侧状态栏: w-1/3 (533px), right-5 (20px from right)
    // - 状态栏内容: PetIcon(128px) + 状态条，总高度约150px

    // 左侧状态栏: 从x=20开始，宽度533px，中心在x=20+533/2=286.5
    // 右侧状态栏: 从x=1600-20-533=1047开始，中心在x=1047+533/2=1313.5
    // 状态栏底部: y=20(padding) + 150(状态栏高度) = 170

    const leftStatusCenter = { x: 287, y: 170 } // 左侧状态栏中心底部
    const rightStatusCenter = { x: 1314, y: 170 } // 右侧状态栏中心底部

    const basePosition = side === 'left' ? leftStatusCenter : rightStatusCenter

    return {
      x: basePosition.x,
      y: basePosition.y + offsetY,
    }
  }
  const showMissMessage = (side: 'left' | 'right') => {
    if (!battleViewRef.value) return

    const { x: startX, y: startY } = getBattleViewPosition(side, 120)

    const containerVNode = h(
      'div',
      {
        style: {
          position: 'absolute',
          left: `${startX}px`,
          top: `${startY}px`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
          opacity: 0,
          zIndex: '1002',
        },
      },
      [
        h('img', {
          src: 'https://seer2-resource.yuuinih.com/png/damage/miss.png',
          class: 'h-20',
        }),
      ],
    )

    const tempHost = document.createElement('div')
    battleViewRef.value.appendChild(tempHost)
    render(containerVNode, tempHost)

    const containerElement = tempHost.firstChild as HTMLElement
    if (!containerElement) {
      battleViewRef.value?.removeChild(tempHost)
      return
    }

    const tl = gsap.timeline({
      onComplete: () => {
        render(null, tempHost)
        if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
          battleViewRef.value.removeChild(tempHost)
        }
      },
    })

    tl.to(containerElement, {
      y: -125,
      opacity: 1,
      duration: 0.3,
      ease: 'power2.out',
    })
      .to({}, { duration: 0.5 })
      .to(containerElement, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.out',
      })
  }

  const showAbsorbMessage = (side: 'left' | 'right') => {
    if (!battleViewRef.value) return

    const { x: startX, y: startY } = getBattleViewPosition(side, 120)

    const containerVNode = h(
      'div',
      {
        style: {
          position: 'absolute',
          left: `${startX}px`,
          top: `${startY}px`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
          opacity: 0,
          zIndex: '1002',
        },
      },
      [
        h('img', {
          src: 'https://seer2-resource.yuuinih.com/png/damage/absorb.png',
          class: 'h-20',
        }),
      ],
    )

    const tempHost = document.createElement('div')
    battleViewRef.value.appendChild(tempHost)
    render(containerVNode, tempHost)

    const containerElement = tempHost.firstChild as HTMLElement
    if (!containerElement) {
      battleViewRef.value?.removeChild(tempHost)
      return
    }

    const tl = gsap.timeline({
      onComplete: () => {
        render(null, tempHost)
        if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
          battleViewRef.value.removeChild(tempHost)
        }
      },
    })

    tl.to(containerElement, {
      y: -125,
      opacity: 1,
      duration: 0.3,
      ease: 'power2.out',
    })
      .to({}, { duration: 0.5 })
      .to(containerElement, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.out',
      })
  }

  const flashAndShake = () => {
    if (!battleViewRef.value) return

    const flashVNode = h('div', {
      style: {
        position: 'absolute',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'white',
        opacity: '0',
        pointerEvents: 'none',
        zIndex: '100',
      },
    })

    const tempHost = document.createElement('div')
    battleViewRef.value.appendChild(tempHost)
    render(flashVNode, tempHost)

    const flashElement = tempHost.firstChild as HTMLElement
    if (!flashElement) {
      if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
        battleViewRef.value.removeChild(tempHost)
      }
      return
    }

    gsap.to(flashElement, {
      opacity: 0.7,
      duration: 0.1,
      ease: 'power2.out',
      onComplete: () => {
        gsap.to(flashElement, {
          opacity: 0,
          duration: 0.3,
          ease: 'power2.in',
          onComplete: () => {
            render(null, tempHost)
            if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
              battleViewRef.value.removeChild(tempHost)
            }
          },
        })
      },
    })
  }

  // 背景焦点移动效果
  let currentBackgroundOffset = 0 // 记录当前背景偏移量

  const moveBackgroundFocus = (targetSide: 'left' | 'right', intensity: number = 1) => {
    if (!backgroundContainerRef?.value) return

    const container = backgroundContainerRef.value

    // 使用 VueUse 的响应式尺寸数据
    const currentWidth = containerWidth.value
    const currentHeight = containerHeight.value

    if (!currentWidth || !currentHeight) return

    // 计算背景图片的实际宽度（基于 backgroundSize: 'auto 100%' 和动态宽高比）
    const aspectRatio = backgroundAspectRatio.value
    const backgroundWidth = currentHeight * aspectRatio

    // 计算可移动的最大距离（确保图片左边界不超过容器左边界）
    const maxMoveDistance = Math.max(0, (backgroundWidth - currentWidth) / 2)

    // 如果背景图片宽度小于等于容器宽度，则不移动
    if (maxMoveDistance <= 0) return

    // 计算本次移动的增量距离
    const baseMove = Math.min(currentWidth * 0.3, maxMoveDistance * 0.4)
    const deltaMove = baseMove * intensity

    // 当左侧精灵受攻击时，背景向右移动（正值）；右侧精灵受攻击时，背景向左移动（负值）
    const deltaX = targetSide === 'left' ? deltaMove : -deltaMove

    // 计算新的目标位置（基于当前位置的累积移动）
    const newTargetX = currentBackgroundOffset + deltaX

    // 确保移动距离不会超出边界
    const clampedTargetX = Math.max(-maxMoveDistance, Math.min(maxMoveDistance, newTargetX))

    // 更新当前偏移量记录
    currentBackgroundOffset = clampedTargetX

    // 使用backgroundPosition的百分比+像素组合
    gsap.to(container, {
      backgroundPosition: `calc(50% + ${clampedTargetX}px) center`,
      duration: 0.3,
      ease: 'power2.out',
      overwrite: true,
    })
  }

  const healSubject = new Subject<{
    side: 'left' | 'right'
    value: number
  }>()

  const healSubscription = healSubject
    .pipe(
      timestamp(),
      scan(
        (acc, { value }) => {
          const lastTimestamp = acc.timestamp || 0
          const now = Date.now()
          const delayTime = lastTimestamp === 0 ? 0 : Math.max(0, 150 - (now - lastTimestamp))
          return { timestamp: now + delayTime, value }
        },
        { timestamp: 0, value: null } as { timestamp: number; value: any },
      ),
      concatMap(({ value, timestamp }) =>
        of(value).pipe(
          delay(Math.max(0, timestamp - Date.now())),
          tap(({ side, value }) => {
            if (!battleViewRef.value) return

            const { x: baseX, y: baseY } = getBattleViewPosition(side, 80)
            const randomOffsetX = (Math.random() - 0.5) * 100
            const randomOffsetY = (Math.random() - 0.5) * 50
            const startX = baseX + randomOffsetX
            const startY = baseY + randomOffsetY

            const tempHost = document.createElement('div')
            battleViewRef.value.appendChild(tempHost)

            const healVNode = h(HealDisplay, { value })
            const containerVNode = h(
              'div',
              {
                style: {
                  position: 'absolute',
                  left: `${startX}px`,
                  top: `${startY}px`,
                  transformOrigin: 'center center',
                  pointerEvents: 'none',
                  zIndex: '1001',
                  opacity: 1,
                },
              },
              [healVNode],
            )
            render(containerVNode, tempHost)
            const containerElement = tempHost.firstChild as HTMLElement
            if (!containerElement) {
              battleViewRef.value?.removeChild(tempHost)
              return
            }

            const tl = gsap.timeline({
              onComplete: () => {
                render(null, tempHost)
                if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
                  battleViewRef.value.removeChild(tempHost)
                }
              },
            })

            tl.to(containerElement, {
              y: -125,
              scale: 1.2,
              duration: 0.5,
              ease: 'power1.out',
            })
              .to({}, { duration: 0.5 })
              .to(containerElement, {
                opacity: 0,
                duration: 0.5,
                ease: 'power1.in',
              })
          }),
        ),
      ),
    )
    .subscribe()

  const damageSubject = new Subject<{
    side: 'left' | 'right'
    value: number
    effectiveness: 'up' | 'normal' | 'down'
    crit: boolean
  }>()

  const damageSubscription = damageSubject
    .pipe(
      timestamp(),
      scan(
        (acc, { value }) => {
          const lastTimestamp = acc.timestamp || 0
          const now = Date.now()
          const delayTime = lastTimestamp === 0 ? 0 : Math.max(0, 150 - (now - lastTimestamp))
          return { timestamp: now + delayTime, value }
        },
        { timestamp: 0, value: null } as { timestamp: number; value: any },
      ),
      concatMap(({ value, timestamp }) =>
        of(value).pipe(
          delay(Math.max(0, timestamp - Date.now())),
          tap(({ side, value, effectiveness, crit }) => {
            const activePetId = side === 'left' ? currentPlayer.value?.activePet : opponentPlayer.value?.activePet
            if (typeof activePetId !== 'string') return
            const currentPet = store.getPetById(activePetId)
            if (!currentPet) return

            const { x: baseX, y: baseY } = getBattleViewPosition(side, 120)
            const randomOffsetX = (Math.random() - 0.5) * 200
            const randomOffsetY = (Math.random() - 0.5) * 200
            const startX = baseX + randomOffsetX
            const startY = baseY + randomOffsetY

            const hpRatio = value / currentPet.maxHp

            if ((hpRatio > 0.25 || crit) && battleViewRef.value) {
              const shakeIntensity = 20 + Math.random() * 30
              const shakeAngle = Math.random() * Math.PI * 2
              const shakeX = Math.cos(shakeAngle) * shakeIntensity
              const shakeY = Math.sin(shakeAngle) * shakeIntensity

              // 捕获当前的缩放值，避免在动画过程中发生变化
              const currentScale = battleViewScale.value

              gsap.to(battleViewRef.value, {
                x: shakeX,
                y: shakeY,
                scale: currentScale, // 保持当前的缩放比例
                duration: 0.05,
                repeat: 5,
                yoyo: true,
                ease: 'power1.inOut',
                onComplete: () => {
                  // 动画结束后确保恢复到正确的状态
                  gsap.set(battleViewRef.value, {
                    x: 0,
                    y: 0,
                    scale: currentScale,
                  })
                },
              })

              // 触发背景焦点移动效果
              // 计算移动强度：暴击时强度更高，伤害比例越高强度越高
              const moveIntensity = Math.min(1.5, (crit ? 1.2 : 0.8) * Math.min(hpRatio * 2, 1))
              moveBackgroundFocus(side, moveIntensity)
            }

            if (hpRatio > 0.5 && battleViewRef.value) {
              flashAndShake()
            }

            if (!battleViewRef.value) return

            const tempHost = document.createElement('div')
            battleViewRef.value.appendChild(tempHost)

            const damageVNode = h(DamageDisplay, {
              value,
              type: effectiveness === 'up' ? 'red' : effectiveness === 'down' ? 'blue' : '',
              class: 'overflow-visible',
            })

            const moveX = side === 'left' ? 300 : -300
            const baseScale = crit ? 1.5 : 1
            const targetScale = crit ? 2.5 : 1.8

            const containerVNode = h(
              'div',
              {
                style: {
                  position: 'absolute',
                  left: `${startX}px`,
                  top: `${startY}px`,
                  transformOrigin: 'center center',
                  pointerEvents: 'none',
                  opacity: 1,
                  scale: baseScale,
                  zIndex: '1002',
                },
              },
              [damageVNode],
            )
            render(containerVNode, tempHost)
            const containerElement = tempHost.firstChild as HTMLElement
            if (!containerElement) {
              battleViewRef.value?.removeChild(tempHost)
              return
            }

            const tl = gsap.timeline({
              onComplete: () => {
                render(null, tempHost)
                if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
                  battleViewRef.value.removeChild(tempHost)
                }
              },
            })

            tl.to(containerElement, {
              x: moveX,
              y: -150,
              scale: targetScale,
              duration: 0.25,
              ease: 'power2.out',
            })
              .to({}, { duration: 0.5 })
              .to(containerElement, {
                opacity: 0,
                duration: 0.5,
                ease: 'power2.out',
              })
          }),
        ),
      ),
    )
    .subscribe()

  const showDamageMessage = (
    side: 'left' | 'right',
    value: number,
    effectiveness: 'up' | 'normal' | 'down' = 'normal',
    crit: boolean = false,
  ) => {
    damageSubject.next({ side, value, effectiveness, crit })
  }

  const showHealMessage = (side: 'left' | 'right', value: number) => {
    healSubject.next({ side, value })
  }

  const showUseSkillMessage = (side: 'left' | 'right', baseSkillId: string) => {
    if (!battleViewRef.value) return

    const targetX = side === 'left' ? 0 : 1200 // 左侧从左边缘开始，右侧从右边缘开始
    const targetY = 200
    const skillName = i18next.t(`${baseSkillId}.name`, { ns: 'skill' }) || baseSkillId

    const boxVNode = h(
      'div',
      {
        class: 'h-[60px] flex justify-center items-center font-bold text-lg text-white',
        style: {
          backgroundImage:
            side === 'left'
              ? 'linear-gradient(to right, rgba(0,0,0,0.8), rgba(0,0,0,0.3))'
              : 'linear-gradient(to left, rgba(0,0,0,0.8), rgba(0,0,0,0.3))',
          padding: '15px 0',
          left: '0',
          width: '400px', // 状态栏宽度533px的75% ≈ 400px
        },
      },
      skillName,
    )

    const containerVNode = h(
      'div',
      {
        class: 'absolute pointer-events-none',
        style: {
          left: `${targetX}px`,
          top: `${targetY}px`,
          transformOrigin: 'center center',
          opacity: 0,
          scale: 0.8,
        },
      },
      [boxVNode],
    )

    const tempHost = document.createElement('div')
    battleViewRef.value.appendChild(tempHost)
    render(containerVNode, tempHost)

    const containerElement = tempHost.firstChild as HTMLElement
    if (!containerElement) {
      battleViewRef.value?.removeChild(tempHost)
      return
    }

    const startXPosition = side === 'left' ? -200 : 200
    gsap.set(containerElement, {
      x: startXPosition,
      opacity: 0,
      scale: 0.8,
    })

    const tl = gsap.timeline({
      onComplete: () => {
        render(null, tempHost)
        if (battleViewRef.value && battleViewRef.value.contains(tempHost)) {
          battleViewRef.value.removeChild(tempHost)
        }
      },
    })

    tl.to(containerElement, {
      x: 0,
      opacity: 1,
      scale: 1,
      duration: 0.3,
      ease: 'back.out(1.7)',
    })
      .to({}, { duration: 1.5 })
      .to(containerElement, {
        x: startXPosition,
        opacity: 0,
        scale: 0.8,
        duration: 0.5,
        ease: 'power2.in',
      })
  }

  const cleanup = () => {
    damageSubscription.unsubscribe()
    healSubscription.unsubscribe()
    // 重置背景偏移量
    currentBackgroundOffset = 0
  }

  return {
    showMissMessage,
    showAbsorbMessage,
    flashAndShake,
    moveBackgroundFocus,
    showDamageMessage,
    showHealMessage,
    showUseSkillMessage,
    updateBackgroundAspectRatio,
    cleanup,
  }
}
