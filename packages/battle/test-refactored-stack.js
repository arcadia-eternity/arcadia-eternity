import { BaseMark, CreateStatStageMark } from './dist/index.js'
import { StackStrategy } from '@arcadia-eternity/const'

console.log('=== 测试重构后的印记叠加功能 ===')

// 测试1: 普通印记的创建
console.log('\n1. 测试普通印记创建')
const regularMark = new BaseMark('test-regular-mark', [], {
  duration: 3,
  persistent: false,
  maxStacks: 5,
  stackable: true,
  stackStrategy: StackStrategy.stack,
  destroyable: true,
  isShield: false,
  keepOnSwitchOut: false,
  transferOnSwitch: false,
  inheritOnFaint: false,
})

const regularInstance = regularMark.createInstance({ stack: 2, duration: 3 })
console.log(`   - 普通印记实例创建成功`)
console.log(`   - 层数: ${regularInstance.stack}`)
console.log(`   - 持续时间: ${regularInstance.duration}`)
console.log(`   - 叠加策略: ${regularInstance.config.stackStrategy}`)

// 测试2: StatLevel印记的创建
console.log('\n2. 测试StatLevel印记创建')
const attackUpMark = CreateStatStageMark('attack', 2)
const attackUpInstance = attackUpMark.createInstance()
console.log(`   - StatLevel印记实例创建成功`)
console.log(`   - 等级: ${attackUpInstance.level}`)
console.log(`   - 层数: ${attackUpInstance.stack}`)
console.log(`   - 持续时间: ${attackUpInstance.duration}`)
console.log(`   - 叠加策略: ${attackUpInstance.config.stackStrategy}`)

// 测试3: 相反StatLevel印记的创建
console.log('\n3. 测试相反StatLevel印记创建')
const attackDownMark = CreateStatStageMark('attack', -1)
const attackDownInstance = attackDownMark.createInstance()
console.log(`   - 相反StatLevel印记实例创建成功`)
console.log(`   - 等级: ${attackDownInstance.level}`)
console.log(`   - 层数: ${attackDownInstance.stack}`)
console.log(`   - 持续时间: ${attackDownInstance.duration}`)

console.log('\n=== 测试完成 ===')
console.log('重构后的印记叠加系统架构:')
console.log('1. executeAddMarkOperation: 负责识别和分发叠加任务')
console.log('2. MarkStackPhase: 统一处理所有叠加逻辑的Phase')
console.log('3. executeMarkStackOperation: 核心叠加逻辑实现')
console.log('4. executeStatLevelMarkStacking: StatLevel印记的特殊叠加逻辑')
console.log('5. 所有叠加计算都在MarkStackPhase中完成，保持架构一致性')
