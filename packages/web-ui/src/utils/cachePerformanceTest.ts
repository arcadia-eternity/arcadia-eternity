// 性能测试工具，用于验证 _updateMapCaches 优化效果
import { markRaw } from 'vue'

export interface MockBattleState {
  players: Array<{
    id: string
    name: string
    rage: number
    team: Array<{
      id: string
      name: string
      currentHp: number
      currentRage: number
      isUnknown?: boolean
      skills: Array<{
        id: string
        name: string
        isUnknown?: boolean
      }>
      marks: Array<{
        id: string
        level: number
        stacks: number
      }>
      modifierState?: {
        hasModifiers: boolean
      }
    }>
  }>
  marks: Array<{
    id: string
    level: number
    stacks: number
  }>
}

// 生成模拟的战斗状态数据
export function generateMockBattleState(
  playerCount = 2,
  petsPerPlayer = 6,
  skillsPerPet = 4,
  marksPerPet = 2,
  globalMarks = 3,
): MockBattleState {
  const players = []

  for (let p = 0; p < playerCount; p++) {
    const team = []

    for (let pet = 0; pet < petsPerPlayer; pet++) {
      const skills = []
      for (let s = 0; s < skillsPerPet; s++) {
        skills.push({
          id: `skill_${p}_${pet}_${s}`,
          name: `技能${s}`,
        })
      }

      const marks = []
      for (let m = 0; m < marksPerPet; m++) {
        marks.push({
          id: `mark_${p}_${pet}_${m}`,
          level: Math.floor(Math.random() * 5) + 1,
          stacks: Math.floor(Math.random() * 10) + 1,
        })
      }

      team.push({
        id: `pet_${p}_${pet}`,
        name: `宠物${pet}`,
        currentHp: Math.floor(Math.random() * 1000) + 100,
        currentRage: Math.floor(Math.random() * 100),
        skills,
        marks,
        modifierState: {
          hasModifiers: Math.random() > 0.5,
        },
      })
    }

    players.push({
      id: `player_${p}`,
      name: `玩家${p}`,
      rage: Math.floor(Math.random() * 100),
      team,
    })
  }

  const marks = []
  for (let m = 0; m < globalMarks; m++) {
    marks.push({
      id: `global_mark_${m}`,
      level: Math.floor(Math.random() * 5) + 1,
      stacks: Math.floor(Math.random() * 10) + 1,
    })
  }

  return { players, marks }
}

// 模拟旧版本的 _updateMapCaches 方法（用于性能对比）
export function oldUpdateMapCaches(battleState: MockBattleState) {
  const petMapCache = new Map()
  const skillMapCache = new Map()
  const playerMapCache = new Map()
  const markMapCache = new Map()

  // 旧版本：使用 flatMap 和 filter，每次都深拷贝所有对象
  const currentPets =
    battleState.players
      ?.map(p => p.team ?? [])
      .flat()
      .filter(p => p && !p.isUnknown) ?? []

  const currentSkills = currentPets.flatMap(p => p?.skills ?? []).filter(s => s && !s.isUnknown)
  const currentPlayers = battleState.players ?? []
  const petMarks = currentPets
    .map(p => p?.marks ?? [])
    .flat()
    .filter(m => m)
  const globalMarks = battleState.marks ?? []
  const allMarks = [...petMarks, ...globalMarks]

  // 旧版本：总是进行深拷贝
  for (const pet of currentPets) {
    if (pet) {
      petMapCache.set(pet.id, JSON.parse(JSON.stringify(pet)))
    }
  }

  for (const skill of currentSkills) {
    if (skill) {
      skillMapCache.set(skill.id, JSON.parse(JSON.stringify(skill)))
    }
  }

  for (const player of currentPlayers) {
    if (player) {
      playerMapCache.set(player.id, JSON.parse(JSON.stringify(player)))
    }
  }

  for (const mark of allMarks) {
    if (mark) {
      markMapCache.set(mark.id, JSON.parse(JSON.stringify(mark)))
    }
  }

  return { petMapCache, skillMapCache, playerMapCache, markMapCache }
}

// 模拟新版本的 _updateMapCaches 方法（优化版本，使用 markRaw）
export function newUpdateMapCaches(
  battleState: MockBattleState,
  existingCaches?: {
    petMapCache: Map<string, any>
    skillMapCache: Map<string, any>
    playerMapCache: Map<string, any>
    markMapCache: Map<string, any>
  },
) {
  const petMapCache = existingCaches?.petMapCache || markRaw(new Map())
  const skillMapCache = existingCaches?.skillMapCache || markRaw(new Map())
  const playerMapCache = existingCaches?.playerMapCache || markRaw(new Map())
  const markMapCache = existingCaches?.markMapCache || markRaw(new Map())

  // 新版本：一次性收集，减少数组操作
  const currentPets: any[] = []
  const currentSkills: any[] = []
  const currentPlayers = battleState.players ?? []
  const allMarks: any[] = []

  // 收集玩家数据
  for (const player of currentPlayers) {
    if (player) {
      // 收集宠物数据
      if (player.team) {
        for (const pet of player.team) {
          if (pet && !pet.isUnknown) {
            currentPets.push(pet)

            // 收集技能数据
            if (pet.skills) {
              for (const skill of pet.skills) {
                if (skill && !skill.isUnknown) {
                  currentSkills.push(skill)
                }
              }
            }

            // 收集宠物标记
            if (pet.marks) {
              for (const mark of pet.marks) {
                if (mark) {
                  allMarks.push(mark)
                }
              }
            }
          }
        }
      }
    }
  }

  // 收集全局标记
  if (battleState.marks) {
    for (const mark of battleState.marks) {
      if (mark) {
        allMarks.push(mark)
      }
    }
  }

  // 新版本：智能更新，只在需要时深拷贝
  function shouldUpdateCacheEntry(cached: any, current: any): boolean {
    if (cached === current) return false
    if (current.currentHp !== undefined && cached.currentHp !== current.currentHp) return true
    if (current.currentRage !== undefined && cached.currentRage !== current.currentRage) return true
    if (current.marks && cached.marks?.length !== current.marks?.length) return true
    if (current.rage !== undefined && cached.rage !== current.rage) return true
    if (current.team && cached.team?.length !== current.team?.length) return true
    if (current.modifierState?.hasModifiers !== cached.modifierState?.hasModifiers) return true
    if (current.level !== undefined && cached.level !== current.level) return true
    if (current.stacks !== undefined && cached.stacks !== current.stacks) return true
    return true
  }

  function cloneObject(obj: any): any {
    if (typeof structuredClone !== 'undefined') {
      try {
        return structuredClone(obj)
      } catch {
        // 降级到 JSON 克隆
      }
    }
    return JSON.parse(JSON.stringify(obj))
  }

  function batchUpdateCache(cache: Map<string, any>, objects: any[]) {
    for (const obj of objects) {
      if (obj) {
        const cached = cache.get(obj.id)
        if (!cached || shouldUpdateCacheEntry(cached, obj)) {
          cache.set(obj.id, cloneObject(obj))
        }
      }
    }
  }

  batchUpdateCache(petMapCache, currentPets)
  batchUpdateCache(skillMapCache, currentSkills)
  batchUpdateCache(playerMapCache, currentPlayers)
  batchUpdateCache(markMapCache, allMarks)

  return { petMapCache, skillMapCache, playerMapCache, markMapCache }
}

// 性能测试函数
export function runPerformanceTest(iterations = 1000) {
  console.log('开始性能测试...')

  const battleState = generateMockBattleState()
  console.log('生成的测试数据:', {
    players: battleState.players.length,
    totalPets: battleState.players.reduce((sum, p) => sum + p.team.length, 0),
    totalSkills: battleState.players.reduce(
      (sum, p) => sum + p.team.reduce((petSum, pet) => petSum + pet.skills.length, 0),
      0,
    ),
    totalMarks:
      battleState.players.reduce((sum, p) => sum + p.team.reduce((petSum, pet) => petSum + pet.marks.length, 0), 0) +
      battleState.marks.length,
  })

  // 测试旧版本
  const oldStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    oldUpdateMapCaches(battleState)
  }
  const oldEnd = performance.now()
  const oldTime = oldEnd - oldStart

  // 测试新版本（首次运行）
  const newStart = performance.now()
  let caches = newUpdateMapCaches(battleState)
  for (let i = 1; i < iterations; i++) {
    caches = newUpdateMapCaches(battleState, caches)
  }
  const newEnd = performance.now()
  const newTime = newEnd - newStart

  console.log('性能测试结果:')
  console.log(`旧版本: ${oldTime.toFixed(2)}ms (${iterations} 次迭代)`)
  console.log(`新版本: ${newTime.toFixed(2)}ms (${iterations} 次迭代)`)
  console.log(`性能提升: ${(((oldTime - newTime) / oldTime) * 100).toFixed(1)}%`)
  console.log(`平均每次调用:`)
  console.log(`  旧版本: ${(oldTime / iterations).toFixed(3)}ms`)
  console.log(`  新版本: ${(newTime / iterations).toFixed(3)}ms`)

  return {
    oldTime,
    newTime,
    improvement: ((oldTime - newTime) / oldTime) * 100,
    avgOldTime: oldTime / iterations,
    avgNewTime: newTime / iterations,
  }
}

// 专门测试 Vue 响应式性能影响的函数
export function testVueReactivityImpact(iterations = 1000) {
  console.log('开始 Vue 响应式性能影响测试...')

  const battleState = generateMockBattleState()

  // 测试普通 Map（会被 Vue 响应式跟踪）
  const reactiveStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    const reactiveCache = new Map()
    // 模拟大量 set 操作
    for (let j = 0; j < 100; j++) {
      reactiveCache.set(`key_${j}`, { data: `value_${j}`, timestamp: Date.now() })
    }
  }
  const reactiveEnd = performance.now()
  const reactiveTime = reactiveEnd - reactiveStart

  // 测试 markRaw Map（不被 Vue 响应式跟踪）
  const markRawStart = performance.now()
  for (let i = 0; i < iterations; i++) {
    const markRawCache = markRaw(new Map())
    // 模拟大量 set 操作
    for (let j = 0; j < 100; j++) {
      markRawCache.set(`key_${j}`, { data: `value_${j}`, timestamp: Date.now() })
    }
  }
  const markRawEnd = performance.now()
  const markRawTime = markRawEnd - markRawStart

  console.log('Vue 响应式性能影响测试结果:')
  console.log(`响应式 Map: ${reactiveTime.toFixed(2)}ms (${iterations} 次迭代)`)
  console.log(`markRaw Map: ${markRawTime.toFixed(2)}ms (${iterations} 次迭代)`)
  console.log(`性能提升: ${(((reactiveTime - markRawTime) / reactiveTime) * 100).toFixed(1)}%`)
  console.log(`速度倍数: ${(reactiveTime / markRawTime).toFixed(2)}x`)

  return {
    reactiveTime,
    markRawTime,
    improvement: ((reactiveTime - markRawTime) / reactiveTime) * 100,
    speedMultiplier: reactiveTime / markRawTime,
  }
}
