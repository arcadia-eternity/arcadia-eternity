import { BaseSelector } from '../src/selector'

// 简单的测试函数来验证新的团队选择器
export function testTeamSelectors() {
  console.log('🧪 Testing team selectors...')

  try {
    // 验证 selfTeam 和 opponentTeam 选择器存在
    if (!BaseSelector.selfTeam) {
      throw new Error('selfTeam selector not found')
    }
    if (!BaseSelector.opponentTeam) {
      throw new Error('opponentTeam selector not found')
    }

    console.log('✅ selfTeam selector exists')
    console.log('✅ opponentTeam selector exists')

    // 验证选择器类型
    if (typeof BaseSelector.selfTeam.build !== 'function') {
      throw new Error('selfTeam is not a ChainableSelector')
    }
    if (typeof BaseSelector.opponentTeam.build !== 'function') {
      throw new Error('opponentTeam is not a ChainableSelector')
    }

    console.log('✅ Both selectors are ChainableSelector instances')

    // 验证选择器可以与其他方法链式调用
    const chainMethods = ['where', 'select', 'flat', 'limit', 'randomPick', 'shuffled']

    chainMethods.forEach(method => {
      if (typeof (BaseSelector.selfTeam as any)[method] === 'function') {
        console.log(`✅ selfTeam.${method} is available`)
      } else {
        console.log(`❌ selfTeam.${method} is not available`)
      }

      if (typeof (BaseSelector.opponentTeam as any)[method] === 'function') {
        console.log(`✅ opponentTeam.${method} is available`)
      } else {
        console.log(`❌ opponentTeam.${method} is not available`)
      }
    })

    console.log('✅ Team selector test passed')
    return true
  } catch (error) {
    console.log('❌ Team selector test failed:', (error as Error).message)
    return false
  }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  testTeamSelectors()
}
